/**
 * Owner ↔ CEO chat. The CEO answers conversationally with company context and
 * the handbook applied, and flags when a message is really a goal worth
 * running through the orchestrator.
 */
import { z } from "zod";
import { getAgent } from "./agents/registry";
import { setAgentStatus } from "./agents/status";
import { logEvent } from "./audit";
import { formatContext, search } from "./brain";
import { withHandbook } from "./brain/handbook";
import { getDb } from "./db";
import { generateJson } from "./llm/provider";

const replySchema = z.object({
  reply: z.string().min(1),
  /** True when the owner is asking for work the company should execute. */
  isGoal: z.boolean(),
  /** A crisp restatement of that goal, ready for the orchestrator. */
  suggestedGoal: z.string().default(""),
});
export type ChatReply = z.infer<typeof replySchema>;

export interface ChatTurn {
  role: "owner" | "ceo";
  content: string;
}

export async function chatWithCeo(
  workspaceId: string,
  message: string,
  history: ChatTurn[] = []
): Promise<ChatReply> {
  const ceo = getAgent("ceo");
  if (ceo === undefined) throw new Error("ceo agent missing from registry");

  const db = getDb();
  const openGoals = db
    .prepare(
      "SELECT description, status FROM goals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 5"
    )
    .all(workspaceId) as { description: string; status: string }[];
  const pendingApprovals = (
    db
      .prepare("SELECT COUNT(*) AS n FROM approvals WHERE workspace_id = ? AND status = 'pending'")
      .get(workspaceId) as { n: number }
  ).n;

  let context = "";
  try {
    context = formatContext(await search(workspaceId, message));
  } catch {
    // Chat still works without retrieval; the answer is just less grounded.
  }

  const transcript = history
    .slice(-10)
    .map((t) => `${t.role === "owner" ? "OWNER" : "YOU"}: ${t.content}`)
    .join("\n");

  const prompt = `${context === "" ? "" : `${context}\n\n---\n\n`}You are in a direct conversation with the company owner.

CURRENT STATE
Recent goals: ${
    openGoals.length === 0
      ? "none yet"
      : openGoals.map((g) => `"${g.description}" (${g.status})`).join("; ")
  }
Approvals waiting on the owner: ${pendingApprovals}

${transcript === "" ? "" : `CONVERSATION SO FAR:\n${transcript}\n\n`}OWNER'S MESSAGE:
${message}

Reply as the CEO: direct, brief, no preamble. If the owner is asking a
question, answer it. If they are asking for work to be done, say how you would
break it down and who would own it, and set isGoal to true with a clear,
self-contained restatement in suggestedGoal.

Return {"reply": string, "isGoal": boolean, "suggestedGoal": string}.`;

  setAgentStatus(ceo.id, "working", { detail: "in conversation with the owner" });
  try {
    const { data } = await generateJson(prompt, replySchema, {
      agentId: ceo.id,
      workspaceId,
      model: ceo.model,
      temperature: ceo.temperature,
      systemPrompt: withHandbook(ceo.systemPrompt),
      purpose: "owner-chat",
    });
    logEvent({
      workspaceId,
      agentId: ceo.id,
      eventType: "owner_chat",
      detail: { message: message.slice(0, 300), isGoal: data.isGoal },
    });
    return data;
  } finally {
    setAgentStatus(ceo.id, "idle");
  }
}
