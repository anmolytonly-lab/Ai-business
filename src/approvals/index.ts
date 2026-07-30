/**
 * Human approval queue (spec item 5) with the legal_compliance gate
 * (spec item 14): anything an agent declares in requiresApproval[] produces a
 * pending-approval card, and all outbound content passes legal_compliance
 * before that card is created. Nothing external happens without a click.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { getAgent } from "../agents/registry";
import { logEvent } from "../audit";
import { getDb } from "../db";
import { generateJson } from "../llm/provider";

const LEGAL_AGENT_ID = "legal_compliance";

const legalSchema = z.object({
  risky: z.boolean(),
  flags: z.array(z.string()).default([]),
  assessment: z.string().min(1),
});
export type LegalReview = z.infer<typeof legalSchema>;

export interface ApprovalRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  task_id: string | null;
  action_type: string;
  payload: string;
  status: string;
  legal_flags: string;
  legal_assessment: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

/** Action types this agent is not allowed to perform without a human click. */
export function gatedActions(agentId: string): string[] {
  return getAgent(agentId)?.requiresApproval ?? [];
}

export function requiresApproval(agentId: string): boolean {
  return gatedActions(agentId).length > 0;
}

/**
 * Run the legal_compliance agent over outbound content. Returns a
 * conservative "treat as risky" result if the check itself fails — a broken
 * compliance pass must never look like a clean bill of health.
 */
export async function legalCheck(
  workspaceId: string,
  content: string,
  context: string,
  taskId?: string
): Promise<LegalReview> {
  const legal = getAgent(LEGAL_AGENT_ID);
  if (legal === undefined) {
    return {
      risky: true,
      flags: ["legal_compliance agent missing from registry"],
      assessment: "Could not run the compliance check; treat as unreviewed.",
    };
  }

  const prompt = `Review this outbound content for compliance risk before it goes to the owner for approval.

CONTEXT (what this content is for):
${context}

CONTENT:
---
${content}
---

Flag anything that breaches the company handbook or creates legal exposure:
guaranteed outcomes, unverifiable statistics or claims, missing disclosures,
medical/legal/financial advice, fake social proof, competitor claims, or
regulatory/certification claims. Note missing disclaimers too.

Return {"risky": boolean, "flags": ["specific issue", ...], "assessment": "one paragraph"}.
Set risky to true if ANY flag would need fixing before publication.
Remember your output is not legal advice.`;

  try {
    const { data } = await generateJson(prompt, legalSchema, {
      agentId: legal.id,
      workspaceId,
      ...(taskId !== undefined ? { taskId } : {}),
      model: legal.model,
      temperature: legal.temperature,
      systemPrompt: legal.systemPrompt,
      purpose: "legal-compliance-gate",
    });
    logEvent({
      workspaceId,
      agentId: legal.id,
      ...(taskId !== undefined ? { taskId } : {}),
      eventType: data.risky ? "legal_check_flagged" : "legal_check_clear",
      detail: { flags: data.flags, assessment: data.assessment.slice(0, 300) },
    });
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`legal compliance check failed: ${message}`);
    logEvent({
      workspaceId,
      agentId: legal.id,
      ...(taskId !== undefined ? { taskId } : {}),
      eventType: "legal_check_failed",
      detail: { error: message },
    });
    return {
      risky: true,
      flags: [`compliance check could not be completed: ${message}`],
      assessment: "The compliance check failed, so this content is unreviewed. Treat as risky.",
    };
  }
}

/**
 * Queue an outbound action for human approval. Runs the legal gate first and
 * attaches its findings to the card.
 */
export async function queueForApproval(opts: {
  workspaceId: string;
  agentId: string;
  taskId?: string;
  actionType?: string;
  content: string;
  context: string;
}): Promise<{ approvalId: string; legal: LegalReview }> {
  const actions = gatedActions(opts.agentId);
  const actionType = opts.actionType ?? actions[0] ?? "outbound";

  const legal = await legalCheck(opts.workspaceId, opts.content, opts.context, opts.taskId);

  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO approvals (id, workspace_id, agent_id, task_id, action_type, payload,
                              legal_flags, legal_assessment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      opts.workspaceId,
      opts.agentId,
      opts.taskId ?? null,
      actionType,
      JSON.stringify({
        content: opts.content,
        context: opts.context,
        gatedActions: actions,
      }),
      JSON.stringify(legal.flags),
      legal.assessment
    );

  logEvent({
    workspaceId: opts.workspaceId,
    agentId: opts.agentId,
    ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
    eventType: "approval_requested",
    detail: { approvalId: id, actionType, legalRisky: legal.risky, legalFlags: legal.flags },
  });
  console.log(
    `approval required: ${opts.agentId} -> ${actionType} (card ${id.slice(0, 8)}, ` +
      `legal ${legal.risky ? `flagged ${legal.flags.length} issue(s)` : "clear"})`
  );

  return { approvalId: id, legal };
}

export function listApprovals(workspaceId: string, status = "pending"): ApprovalRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM approvals WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC"
    )
    .all(workspaceId, status) as ApprovalRow[];
}

export function getApproval(id: string): ApprovalRow | undefined {
  return getDb().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as
    | ApprovalRow
    | undefined;
}

/**
 * The human's click. Only a pending card can be decided, and approving does
 * not itself perform the action — execution arrives with Phase 10 adapters.
 */
export function decideApproval(
  id: string,
  decision: "approved" | "rejected",
  note = ""
): boolean {
  const info = getDb()
    .prepare(
      `UPDATE approvals SET status = ?, decision_note = ?,
         decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status = 'pending'`
    )
    .run(decision, note, id);
  if (info.changes === 0) return false;

  const card = getApproval(id);
  logEvent({
    ...(card?.workspace_id !== undefined ? { workspaceId: card.workspace_id } : {}),
    ...(card?.agent_id !== undefined ? { agentId: card.agent_id } : {}),
    eventType: decision === "approved" ? "approval_granted" : "approval_rejected",
    detail: { approvalId: id, actionType: card?.action_type, note },
  });
  return true;
}
