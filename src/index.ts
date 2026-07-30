import fs from "node:fs";
import path from "node:path";
import express from "express";
import { runAgent } from "./agents/executor";
import { getAgent, initRegistry, listAgents } from "./agents/registry";
import { listAgentStatuses } from "./agents/status";
import { ChatTurn, chatWithCeo } from "./chat";
import { decideApproval, getApproval, listApprovals } from "./approvals";
import { getAuditLog, logEvent } from "./audit";
import { getKpis } from "./kpis";
import { listMemory } from "./memory";
import { getSpendSnapshot } from "./safety/budget";
import {
  listRoutineRuns,
  listRoutines,
  startScheduler,
  triggerRoutine,
} from "./scheduler";
import { isKillSwitchOn, setKillSwitch } from "./safety/killswitch";
import {
  addDocument,
  approveDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  search,
} from "./brain";
import { getHandbook, initHandbook } from "./brain/handbook";
import { env } from "./config/env";
import { getDb, isVecAvailable } from "./db";
import { generateText } from "./llm/provider";
import { LlmError } from "./llm/types";
import {
  getReviews,
  listEscalations,
  resolveEscalation,
} from "./orchestration/critic";
import { createGoal, executeGoal, getGoal, listGoals } from "./orchestration/goals";
import { listTools } from "./tools/registry";
import { commandWhitelist, workspaceRoot } from "./tools/sandbox";
import {
  DEFAULT_WORKSPACE_ID,
  createWorkspace,
  ensureDefaultWorkspace,
  listWorkspaces,
  updateWorkspace,
  workspaceExists,
} from "./workspace";
import { getIntegration, listIntegrations } from "./integrations";
import { AgentWriteError, deleteAgent, listOverrides, writeAgent } from "./agents/store";

const app = express();
app.use(express.json({ limit: "1mb" }));

// The Vite dev server runs on a different port; in production the frontend is
// served from this process, so same-origin. Hand-rolled to avoid a dependency.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/status", (_req, res) => {
  const db = getDb();
  const migrations = db
    .prepare("SELECT name FROM schema_migrations ORDER BY name")
    .all() as { name: string }[];
  const llmCalls = db.prepare("SELECT COUNT(*) AS n FROM llm_calls").get() as { n: number };
  const spend = db
    .prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= strftime('%Y-%m-%dT00:00:00Z', 'now')"
    )
    .get() as { usd: number };
  res.json({
    phase: 9,
    database: env.DATABASE_PATH,
    migrations: migrations.map((m) => m.name),
    vectorSearch: isVecAvailable(),
    model: env.GEMINI_MODEL,
    geminiKeyConfigured: env.GEMINI_API_KEY !== "",
    agentsLoaded: listAgents().length,
    documentsIndexed: (
      db.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }
    ).n,
    chunksIndexed: (
      db.prepare("SELECT COUNT(*) AS n FROM document_chunks").get() as { n: number }
    ).n,
    handbookLoaded: getHandbook().length > 0,
    llmCallsLogged: llmCalls.n,
    todaySpendUsd: spend.usd,
    killSwitchEngaged: isKillSwitchOn(),
    pendingApprovals: listApprovals(DEFAULT_WORKSPACE_ID).length,
  });
});

// ── Agents ────────────────────────────────────────────────────────────

app.get("/api/agents", (_req, res) => {
  res.json(
    listAgents().map((a) => ({
      id: a.id,
      name: a.name,
      department: a.department,
      role: a.role,
      reportsTo: a.reportsTo,
      canDelegateTo: a.canDelegateTo,
      model: a.model,
      tools: a.tools,
      requiresApproval: a.requiresApproval,
    }))
  );
});

/** Live activity per agent, for the org chart. */
app.get("/api/agents/status", (_req, res) => {
  res.json(listAgentStatuses());
});

/** Which agents this workspace overrides. Must precede /api/agents/:id. */
app.get("/api/agents/overrides", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  res.json({ workspaceId, overrides: listOverrides(workspaceId) });
});

app.get("/api/agents/:id", (req, res) => {
  const agent = getAgent(req.params.id);
  if (agent === undefined) {
    res.status(404).json({ error: `unknown agent "${req.params.id}"` });
    return;
  }
  res.json(agent);
});

// ── Agent builder: create / edit / delete agent JSON files ────────────

/** Create a new agent in the shared roster. */
app.post("/api/agents", (req, res) => {
  try {
    res.status(201).json(writeAgent(req.body));
  } catch (err) {
    const status = err instanceof AgentWriteError ? 400 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Save an agent. Without ?workspace= this edits the shared roster; with it,
 * the change is written as an override for that workspace only.
 */
app.put("/api/agents/:id", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const scoped = req.query.workspace !== undefined || req.headers["x-workspace-id"] !== undefined;
  try {
    res.json(
      writeAgent(req.body, {
        expectId: req.params.id,
        ...(scoped && workspaceId !== DEFAULT_WORKSPACE_ID ? { workspaceId } : {}),
      })
    );
  } catch (err) {
    const status = err instanceof AgentWriteError ? 400 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/agents/:id", (req, res) => {
  const scopedWorkspace =
    typeof req.query.workspace === "string" && req.query.workspace !== DEFAULT_WORKSPACE_ID
      ? req.query.workspace
      : undefined;
  try {
    if (!deleteAgent(req.params.id, scopedWorkspace)) {
      res.status(404).json({ error: `no such agent file for "${req.params.id}"` });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/agents/:id/run", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const instruction: unknown = req.body?.instruction;
  if (typeof instruction !== "string" || instruction.trim() === "") {
    res.status(400).json({ error: 'body must be { "instruction": string }' });
    return;
  }
  runAgent(req.params.id, instruction, { workspaceId })
    .then((result) => res.json(result))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith("unknown agent") ? 404 : 502;
      res.status(status).json({ error: message });
    });
});

// ── Workspaces ────────────────────────────────────────────────────────

/**
 * Every request resolves a workspace from ?workspace= or the X-Workspace-Id
 * header, defaulting to "default". Unknown ids are rejected rather than
 * silently falling back, so one client's data can't leak into another's view.
 */
function resolveWorkspace(req: express.Request): string {
  const raw =
    (typeof req.query.workspace === "string" ? req.query.workspace : undefined) ??
    (typeof req.headers["x-workspace-id"] === "string"
      ? req.headers["x-workspace-id"]
      : undefined);
  if (raw === undefined || raw === "") return DEFAULT_WORKSPACE_ID;
  if (!workspaceExists(raw)) throw new Error(`unknown workspace "${raw}"`);
  return raw;
}

function ws(req: express.Request, res: express.Response): string | null {
  try {
    return resolveWorkspace(req);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

app.get("/api/workspaces", (_req, res) => {
  res.json(listWorkspaces(true));
});

app.post("/api/workspaces", (req, res) => {
  const { id, name, description, dailyBudgetUsd } = req.body ?? {};
  if (typeof id !== "string" || typeof name !== "string") {
    res.status(400).json({ error: 'body must be { "id": string, "name": string, ... }' });
    return;
  }
  try {
    res.status(201).json(
      createWorkspace({
        id,
        name,
        ...(typeof description === "string" ? { description } : {}),
        ...(typeof dailyBudgetUsd === "number" ? { dailyBudgetUsd } : {}),
      })
    );
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/workspaces/:id", (req, res) => {
  const { name, description, dailyBudgetUsd, archived } = req.body ?? {};
  const updated = updateWorkspace(req.params.id, {
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof description === "string" ? { description } : {}),
    ...(dailyBudgetUsd === null || typeof dailyBudgetUsd === "number" ? { dailyBudgetUsd } : {}),
    ...(typeof archived === "boolean" ? { archived } : {}),
  });
  if (updated === undefined) {
    res.status(404).json({ error: `unknown workspace "${req.params.id}"` });
    return;
  }
  res.json(updated);
});

// ── Integrations ──────────────────────────────────────────────────────

app.get("/api/integrations", (_req, res) => {
  res.json(listIntegrations());
});

app.post("/api/integrations/:id/test", (req, res) => {
  const adapter = getIntegration(req.params.id);
  if (adapter === undefined) {
    res.status(404).json({ error: `unknown integration "${req.params.id}"` });
    return;
  }
  adapter
    .connect()
    .then((result) => res.json(result))
    .catch((err: unknown) =>
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    );
});

// ── Dashboard KPIs, scheduler & memory ────────────────────────────────

app.get("/api/kpis", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const days = typeof req.query.days === "string" ? Number(req.query.days) : 7;
  res.json(getKpis(workspaceId, Number.isFinite(days) && days > 0 ? days : 7));
});

app.get("/api/routines", (_req, res) => {
  res.json(listRoutines());
});

app.get("/api/routines/runs", (_req, res) => {
  res.json(listRoutineRuns());
});

/** Fire a routine now, outside its schedule. */
app.post("/api/routines/:id/run", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  triggerRoutine(req.params.id, workspaceId)
    .then((result) => res.json(result))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.startsWith("unknown routine") ? 404 : 409).json({ error: message });
    });
});

app.get("/api/memory", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  res.json(
    listMemory(
      workspaceId,
      typeof req.query.agentId === "string" ? req.query.agentId : undefined
    )
  );
});

// ── Chat with the CEO ─────────────────────────────────────────────────

app.post("/api/chat", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const message: unknown = req.body?.message;
  const history: unknown = req.body?.history;
  if (typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: 'body must be { "message": string, "history"?: ChatTurn[] }' });
    return;
  }
  const turns: ChatTurn[] = Array.isArray(history)
    ? (history.filter(
        (t): t is ChatTurn =>
          typeof t === "object" &&
          t !== null &&
          (t as ChatTurn).role !== undefined &&
          typeof (t as ChatTurn).content === "string"
      ) as ChatTurn[])
    : [];
  chatWithCeo(workspaceId, message.trim(), turns)
    .then((reply) => res.json(reply))
    .catch((err: unknown) =>
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
    );
});

// ── Approval queue, budget guard, kill switch ─────────────────────────

app.get("/api/approvals", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  res.json(
    listApprovals(workspaceId, status).map((a) => ({
      ...a,
      payload: JSON.parse(a.payload) as unknown,
      legal_flags: JSON.parse(a.legal_flags) as unknown,
    }))
  );
});

app.get("/api/approvals/:id", (req, res) => {
  const card = getApproval(req.params.id);
  if (card === undefined) {
    res.status(404).json({ error: `unknown approval "${req.params.id}"` });
    return;
  }
  res.json({
    ...card,
    payload: JSON.parse(card.payload) as unknown,
    legal_flags: JSON.parse(card.legal_flags) as unknown,
  });
});

/** The human's click. Nothing external happens until this is called. */
app.post("/api/approvals/:id/decide", (req, res) => {
  const decision: unknown = req.body?.decision;
  const note: unknown = req.body?.note;
  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: 'body must be { "decision": "approved" | "rejected", "note"?: string }' });
    return;
  }
  if (!decideApproval(req.params.id, decision, typeof note === "string" ? note : "")) {
    res.status(404).json({ error: "no pending approval with that id" });
    return;
  }
  res.json({ ok: true, decision });
});

app.get("/api/budget", (_req, res) => {
  res.json(getSpendSnapshot());
});

app.get("/api/kill-switch", (_req, res) => {
  res.json({ engaged: isKillSwitchOn() });
});

app.post("/api/kill-switch", (req, res) => {
  const engaged: unknown = req.body?.engaged;
  if (typeof engaged !== "boolean") {
    res.status(400).json({ error: 'body must be { "engaged": boolean, "reason"?: string }' });
    return;
  }
  const reason: unknown = req.body?.reason;
  setKillSwitch(engaged, typeof reason === "string" ? reason : "");
  res.json({ engaged });
});

// ── Company Brain ─────────────────────────────────────────────────────

app.post("/api/documents", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const title: unknown = req.body?.title;
  const content: unknown = req.body?.content;
  if (typeof title !== "string" || typeof content !== "string" || content.trim() === "") {
    res.status(400).json({ error: 'body must be { "title": string, "content": string }' });
    return;
  }
  addDocument({ workspaceId, title, content, source: "owner" })
    .then((result) => res.status(201).json(result))
    .catch((err: unknown) =>
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    );
});

app.get("/api/documents", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  res.json(listDocuments(workspaceId));
});

app.get("/api/documents/:id", (req, res) => {
  const doc = getDocument(req.params.id);
  if (doc === undefined) {
    res.status(404).json({ error: `unknown document "${req.params.id}"` });
    return;
  }
  res.json(doc);
});

/** Approve an agent-written learning so it is no longer flagged unreviewed. */
app.post("/api/documents/:id/approve", (req, res) => {
  if (!approveDocument(req.params.id)) {
    res.status(404).json({ error: "no unreviewed document with that id" });
    return;
  }
  res.json({ ok: true });
});

app.delete("/api/documents/:id", (req, res) => {
  if (!deleteDocument(req.params.id)) {
    res.status(404).json({ error: `unknown document "${req.params.id}"` });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/brain/search", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const query: unknown = req.body?.query;
  if (typeof query !== "string" || query.trim() === "") {
    res.status(400).json({ error: 'body must be { "query": string }' });
    return;
  }
  search(workspaceId, query)
    .then((hits) => res.json(hits))
    .catch((err: unknown) =>
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    );
});

app.get("/api/handbook", (_req, res) => {
  res.json({ content: getHandbook() });
});

// ── Tools ─────────────────────────────────────────────────────────────

app.get("/api/tools", (_req, res) => {
  res.json({
    tools: listTools(),
    sandboxRoot: workspaceRoot(),
    shellWhitelist: commandWhitelist(),
  });
});

// ── Goals & orchestration ─────────────────────────────────────────────

// Creates a goal and kicks off plan+run in the background; poll GET /api/goals/:id.
app.post("/api/goals", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const description: unknown = req.body?.description;
  if (typeof description !== "string" || description.trim() === "") {
    res.status(400).json({ error: 'body must be { "description": string }' });
    return;
  }
  const goalId = createGoal(workspaceId, description.trim());
  executeGoal(goalId).catch((err: unknown) => {
    console.error(`goal ${goalId} failed:`, err instanceof Error ? err.message : err);
  });
  res.status(202).json({ goalId, status: "planning", poll: `/api/goals/${goalId}` });
});

app.get("/api/goals", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  res.json(listGoals(workspaceId));
});

app.get("/api/goals/:id", (req, res) => {
  const goal = getGoal(req.params.id);
  if (goal === undefined) {
    res.status(404).json({ error: `unknown goal "${req.params.id}"` });
    return;
  }
  res.json(goal);
});

// ── Escalations (critic loop ran out of revision rounds) ──────────────

app.get("/api/escalations", (req, res) => {
  const workspaceId = ws(req, res);
  if (workspaceId === null) return;
  const status = typeof req.query.status === "string" ? req.query.status : "open";
  res.json(listEscalations(workspaceId, status));
});

app.post("/api/escalations/:id/resolve", (req, res) => {
  const status: unknown = req.body?.status;
  const resolution: unknown = req.body?.resolution;
  if (status !== "resolved" && status !== "dismissed") {
    res.status(400).json({ error: 'body must be { "status": "resolved" | "dismissed", "resolution": string }' });
    return;
  }
  const ok = resolveEscalation(
    req.params.id,
    status,
    typeof resolution === "string" ? resolution : ""
  );
  if (!ok) {
    res.status(404).json({ error: `no open escalation "${req.params.id}"` });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/tasks/:id/reviews", (req, res) => {
  res.json(getReviews(req.params.id));
});

// ── Audit log ─────────────────────────────────────────────────────────

app.get("/api/audit", (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  res.json(
    getAuditLog({
      ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
      ...(typeof req.query.agentId === "string" ? { agentId: req.query.agentId } : {}),
      ...(typeof req.query.eventType === "string" ? { eventType: req.query.eventType } : {}),
    }).map((row) => ({ ...row, detail: JSON.parse(row.detail) as unknown }))
  );
});

// Phase 1 endpoint kept for raw provider access.
app.post("/api/llm/test", (req, res) => {
  const prompt: unknown = req.body?.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    res.status(400).json({ error: "body must be { \"prompt\": string }" });
    return;
  }
  generateText(prompt, { purpose: "llm-test-endpoint" })
    .then((result) => res.json({ text: result.text, usage: result.usage }))
    .catch((err: unknown) => {
      const status = err instanceof LlmError && err.status === 401 ? 401 : 502;
      res
        .status(status)
        .json({ error: err instanceof Error ? err.message : String(err) });
    });
});

// Serve the built frontend when it exists, so web and Electron load the same
// bundle. Must come after the API routes; unknown non-API paths fall back to
// index.html for client-side routing.
const FRONTEND_DIST = path.resolve(__dirname, "../frontend/dist");
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res
      .status(200)
      .type("text/plain")
      .send(
        "AgentCorp API is running. The frontend is not built yet:\n" +
          "  cd frontend && npm install && npm run build\n" +
          "Then reload this page. API routes are under /api."
      );
  });
}

getDb(); // open DB + run migrations before accepting traffic
ensureDefaultWorkspace();
initRegistry();
initHandbook();
startScheduler(DEFAULT_WORKSPACE_ID);
logEvent({ workspaceId: DEFAULT_WORKSPACE_ID, eventType: "server_started", detail: { phase: 11 } });
if (isKillSwitchOn()) {
  console.warn("NOTE: the kill switch is ENGAGED — agents will refuse to run until it is released.");
}

/**
 * Start listening. Exported so the Electron main process can boot the same
 * server in-process; running this file directly starts it too.
 * `port: 0` asks the OS for a free port, which the desktop app uses to avoid
 * clashing with a web instance already on 3000.
 */
export function startServer(port: number = env.PORT): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address !== null ? address.port : port;
      printRoutes(actualPort);
      resolve({ port: actualPort, close: () => server.close() });
    });
    server.on("error", reject);
  });
}

export { app };

function printRoutes(port: number): void {
  console.log(`AgentCorp listening on http://localhost:${port}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/status`);
  console.log(`  GET  /api/agents            list the registry`);
  console.log(`  GET  /api/agents/:id        full agent config`);
  console.log(`  POST /api/agents/:id/run    { "instruction": "..." }`);
  console.log(`  GET  /api/kpis              dashboard KPIs (?days=7)`);
  console.log(`  GET  /api/routines          scheduled routines + next run`);
  console.log(`  POST /api/routines/:id/run  fire a routine now`);
  console.log(`  GET  /api/approvals         pending outbound actions`);
  console.log(`  POST /api/approvals/:id/decide  { "decision": "approved"|"rejected" }`);
  console.log(`  GET  /api/budget            spend vs caps, per agent`);
  console.log(`  GET  /api/kill-switch       current state`);
  console.log(`  POST /api/kill-switch       { "engaged": boolean } halts all agents`);
  console.log(`  POST /api/documents         { "title", "content" } -> index into the Brain`);
  console.log(`  GET  /api/documents         list knowledge base documents`);
  console.log(`  POST /api/documents/:id/approve   approve an agent learning`);
  console.log(`  POST /api/brain/search      { "query": "..." } semantic search`);
  console.log(`  GET  /api/handbook          the company handbook text`);
  console.log(`  GET  /api/tools             tools, sandbox root, shell whitelist`);
  console.log(`  POST /api/goals             { "description": "..." } -> CEO plans + runs DAG`);
  console.log(`  GET  /api/goals             list goals`);
  console.log(`  GET  /api/goals/:id         goal + its task DAG`);
  console.log(`  GET  /api/escalations       deliverables needing your decision`);
  console.log(`  POST /api/escalations/:id/resolve  { "status": "resolved"|"dismissed" }`);
  console.log(`  GET  /api/tasks/:id/reviews review history for a task`);
  console.log(`  GET  /api/audit             ?limit=&agentId=&eventType=`);
  console.log(`  POST /api/llm/test          { "prompt": "..." }`);
}

// Auto-start only when this file is the entrypoint, so `require()` from the
// Electron main process can control startup itself.
if (require.main === module) {
  startServer().catch((err: unknown) => {
    console.error("failed to start server:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
