import express from "express";
import { runAgent } from "./agents/executor";
import { getAgent, initRegistry, listAgents } from "./agents/registry";
import { getAuditLog, logEvent } from "./audit";
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
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace } from "./workspace";

const app = express();
app.use(express.json({ limit: "1mb" }));

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
    phase: 6,
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

app.get("/api/agents/:id", (req, res) => {
  const agent = getAgent(req.params.id);
  if (agent === undefined) {
    res.status(404).json({ error: `unknown agent "${req.params.id}"` });
    return;
  }
  res.json(agent);
});

app.post("/api/agents/:id/run", (req, res) => {
  const instruction: unknown = req.body?.instruction;
  if (typeof instruction !== "string" || instruction.trim() === "") {
    res.status(400).json({ error: 'body must be { "instruction": string }' });
    return;
  }
  runAgent(req.params.id, instruction, { workspaceId: DEFAULT_WORKSPACE_ID })
    .then((result) => res.json(result))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith("unknown agent") ? 404 : 502;
      res.status(status).json({ error: message });
    });
});

// ── Company Brain ─────────────────────────────────────────────────────

app.post("/api/documents", (req, res) => {
  const title: unknown = req.body?.title;
  const content: unknown = req.body?.content;
  if (typeof title !== "string" || typeof content !== "string" || content.trim() === "") {
    res.status(400).json({ error: 'body must be { "title": string, "content": string }' });
    return;
  }
  addDocument({ workspaceId: DEFAULT_WORKSPACE_ID, title, content, source: "owner" })
    .then((result) => res.status(201).json(result))
    .catch((err: unknown) =>
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    );
});

app.get("/api/documents", (_req, res) => {
  res.json(listDocuments(DEFAULT_WORKSPACE_ID));
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
  const query: unknown = req.body?.query;
  if (typeof query !== "string" || query.trim() === "") {
    res.status(400).json({ error: 'body must be { "query": string }' });
    return;
  }
  search(DEFAULT_WORKSPACE_ID, query)
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
  const description: unknown = req.body?.description;
  if (typeof description !== "string" || description.trim() === "") {
    res.status(400).json({ error: 'body must be { "description": string }' });
    return;
  }
  const goalId = createGoal(DEFAULT_WORKSPACE_ID, description.trim());
  executeGoal(goalId).catch((err: unknown) => {
    console.error(`goal ${goalId} failed:`, err instanceof Error ? err.message : err);
  });
  res.status(202).json({ goalId, status: "planning", poll: `/api/goals/${goalId}` });
});

app.get("/api/goals", (_req, res) => {
  res.json(listGoals(DEFAULT_WORKSPACE_ID));
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
  const status = typeof req.query.status === "string" ? req.query.status : "open";
  res.json(listEscalations(DEFAULT_WORKSPACE_ID, status));
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

getDb(); // open DB + run migrations before accepting traffic
ensureDefaultWorkspace();
initRegistry();
initHandbook();
logEvent({ workspaceId: DEFAULT_WORKSPACE_ID, eventType: "server_started", detail: { phase: 6 } });

app.listen(env.PORT, () => {
  console.log(`AgentCorp (Phase 6) listening on http://localhost:${env.PORT}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/status`);
  console.log(`  GET  /api/agents            list the registry`);
  console.log(`  GET  /api/agents/:id        full agent config`);
  console.log(`  POST /api/agents/:id/run    { "instruction": "..." }`);
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
});
