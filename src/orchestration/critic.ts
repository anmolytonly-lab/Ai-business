/**
 * Phase 5 critic loop. Every deliverable goes to a reviewer agent and is
 * judged against its acceptanceCriteria. On REVISE the producing agent gets
 * the critique and tries again — at most MAX_REVISION_ROUNDS times — after
 * which the task is escalated to the human rather than shipped or retried
 * forever.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { runAgent } from "../agents/executor";
import { getAgent } from "../agents/registry";
import { setAgentStatus } from "../agents/status";
import { logEvent } from "../audit";
import { getDb } from "../db";
import { generateJson } from "../llm/provider";
import { LlmUsage } from "../llm/types";

/** Spec: max 2 revision rounds, then escalate. */
export const MAX_REVISION_ROUNDS = 2;

const reviewSchema = z.object({
  verdict: z.enum(["APPROVE", "REVISE"]),
  feedback: z.string().min(1),
  requiredChanges: z.array(z.string()).default([]),
});
export type Review = z.infer<typeof reviewSchema>;

/**
 * Reviewer routing: code_reviewer for code, creative_director for content,
 * coo for everything else. An agent never reviews its own work — the fallback
 * chain is coo, then ceo for the coo's own deliverables.
 */
export function pickReviewer(producerId: string): string {
  const producer = getAgent(producerId);
  if (producer === undefined) return "coo";

  let reviewer: string;
  if (producer.department === "product") reviewer = "code_reviewer";
  else if (producer.department === "marketing") reviewer = "creative_director";
  else reviewer = "coo";

  if (reviewer === producerId) reviewer = "coo";
  if (reviewer === producerId) reviewer = "ceo"; // the coo's own work
  return reviewer;
}

function buildReviewPrompt(
  producerId: string,
  instruction: string,
  acceptanceCriteria: string,
  deliverable: string,
  round: number
): string {
  return `You are reviewing a deliverable produced by the "${producerId}" agent.

TASK THEY WERE GIVEN:
${instruction}

ACCEPTANCE CRITERIA they must meet:
${acceptanceCriteria || "(none specified — judge whether the task was completed properly)"}

THEIR DELIVERABLE (revision round ${round}):
---
${deliverable}
---

Judge the deliverable ONLY against the task and its acceptance criteria.
Approve work that meets the bar even if you would have written it differently.
Reject work that is incomplete, off-brief, factually unsupported, or fails a
stated criterion.

Return:
{"verdict": "APPROVE" | "REVISE",
 "feedback": "one paragraph explaining the verdict",
 "requiredChanges": ["specific change 1", "specific change 2"]}

requiredChanges must be empty when you approve, and specific and actionable
when you do not.`;
}

export interface ReviewedResult {
  output: string;
  status: "completed" | "escalated" | "failed";
  rounds: number;
  reviews: (Review & { reviewerId: string; round: number })[];
  usage: LlmUsage;
  escalationId?: string;
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    latencyMs: a.latencyMs + b.latencyMs,
    model: b.model,
  };
}

async function review(
  reviewerId: string,
  producerId: string,
  taskId: string,
  workspaceId: string,
  instruction: string,
  acceptanceCriteria: string,
  deliverable: string,
  round: number
): Promise<{ review: Review; usage: LlmUsage }> {
  const reviewer = getAgent(reviewerId);
  if (reviewer === undefined) {
    throw new Error(`reviewer agent "${reviewerId}" missing from registry`);
  }

  setAgentStatus(reviewer.id, "reviewing", { taskId, detail: `reviewing ${producerId}'s work` });
  try {
    return await runReview(reviewer, producerId, taskId, workspaceId, instruction, acceptanceCriteria, deliverable, round);
  } finally {
    setAgentStatus(reviewer.id, "idle");
  }
}

async function runReview(
  reviewer: NonNullable<ReturnType<typeof getAgent>>,
  producerId: string,
  taskId: string,
  workspaceId: string,
  instruction: string,
  acceptanceCriteria: string,
  deliverable: string,
  round: number
): Promise<{ review: Review; usage: LlmUsage }> {
  const { data, usage } = await generateJson(
    buildReviewPrompt(producerId, instruction, acceptanceCriteria, deliverable, round),
    reviewSchema,
    {
      agentId: reviewer.id,
      workspaceId,
      taskId,
      model: reviewer.model,
      temperature: reviewer.temperature,
      systemPrompt: reviewer.systemPrompt,
      purpose: `review-round-${round}`,
    }
  );

  getDb()
    .prepare(
      `INSERT INTO reviews (task_id, workspace_id, reviewer_id, producer_id, round,
                            verdict, feedback, required_changes, deliverable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      taskId,
      workspaceId,
      reviewer.id,
      producerId,
      round,
      data.verdict,
      data.feedback,
      JSON.stringify(data.requiredChanges),
      deliverable
    );

  logEvent({
    workspaceId,
    taskId,
    agentId: reviewer.id,
    eventType: data.verdict === "APPROVE" ? "review_approved" : "review_revise_requested",
    detail: {
      producerId,
      round,
      feedback: data.feedback.slice(0, 300),
      requiredChanges: data.requiredChanges,
    },
  });

  return { review: data, usage };
}

function escalate(
  workspaceId: string,
  goalId: string | null,
  taskId: string,
  producerId: string,
  reviewerId: string,
  reason: string,
  deliverable: string
): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO escalations (id, workspace_id, goal_id, task_id, producer_id,
                                reviewer_id, reason, deliverable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, workspaceId, goalId, taskId, producerId, reviewerId, reason, deliverable);

  logEvent({
    workspaceId,
    taskId,
    agentId: producerId,
    eventType: "task_escalated",
    detail: { escalationId: id, reviewerId, reason: reason.slice(0, 300) },
  });
  console.warn(`task ${taskId} escalated to human after ${MAX_REVISION_ROUNDS} revision rounds`);
  return id;
}

/**
 * Produce a deliverable and drive it through the critic loop.
 * `buildPrompt(feedback)` returns the prompt for the producing agent; on
 * revision rounds it receives the reviewer's critique to fold in.
 */
export async function produceWithReview(opts: {
  taskId: string;
  goalId: string | null;
  workspaceId: string;
  producerId: string;
  instruction: string;
  acceptanceCriteria: string;
  basePrompt: string;
  /** Override the routed reviewer. Used by tests and future per-task routing. */
  reviewerId?: string;
}): Promise<ReviewedResult> {
  const { taskId, goalId, workspaceId, producerId, instruction, acceptanceCriteria } = opts;
  const db = getDb();
  const reviewerId = opts.reviewerId ?? pickReviewer(producerId);
  const reviews: (Review & { reviewerId: string; round: number })[] = [];
  let usage: LlmUsage = {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    model: getAgent(producerId)?.model ?? "unknown",
  };
  let deliverable = "";
  let lastCritique = "";

  for (let round = 0; round <= MAX_REVISION_ROUNDS; round++) {
    const prompt =
      round === 0
        ? opts.basePrompt
        : `${opts.basePrompt}\n\n--- REVISION REQUIRED (round ${round} of ${MAX_REVISION_ROUNDS}) ---\n` +
          `Your previous attempt was reviewed by "${reviewerId}" and did not pass:\n${lastCritique}\n\n` +
          `Your previous attempt:\n${deliverable}\n\n` +
          `Produce a corrected deliverable that addresses every point above. ` +
          `Output only the deliverable.`;

    if (round > 0) {
      db.prepare("UPDATE tasks SET status = 'revising', revision_round = ? WHERE id = ?").run(
        round,
        taskId
      );
    }

    const run = await runAgent(producerId, prompt, { workspaceId, taskId });
    usage = addUsage(usage, run.usage);
    deliverable = run.output;

    db.prepare("UPDATE tasks SET status = 'in_review' WHERE id = ?").run(taskId);

    let verdict: Review;
    try {
      const result = await review(
        reviewerId,
        producerId,
        taskId,
        workspaceId,
        instruction,
        acceptanceCriteria,
        deliverable,
        round
      );
      verdict = result.review;
      usage = addUsage(usage, result.usage);
    } catch (err) {
      // A broken reviewer must not silently pass work through.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`review failed for task ${taskId}: ${message}`);
      const escalationId = escalate(
        workspaceId,
        goalId,
        taskId,
        producerId,
        reviewerId,
        `Review could not be completed: ${message}`,
        deliverable
      );
      return { output: deliverable, status: "escalated", rounds: round, reviews, usage, escalationId };
    }

    reviews.push({ ...verdict, reviewerId, round });

    if (verdict.verdict === "APPROVE") {
      return { output: deliverable, status: "completed", rounds: round, reviews, usage };
    }

    lastCritique =
      `${verdict.feedback}\n` +
      verdict.requiredChanges.map((c, i) => `${i + 1}. ${c}`).join("\n");
  }

  // Out of revision rounds — hand it to the human with the full critique.
  const last = reviews[reviews.length - 1];
  const escalationId = escalate(
    workspaceId,
    goalId,
    taskId,
    producerId,
    reviewerId,
    `Failed review after ${MAX_REVISION_ROUNDS} revision rounds. Last critique: ${
      last?.feedback ?? "(none)"
    }`,
    deliverable
  );
  return {
    output: deliverable,
    status: "escalated",
    rounds: MAX_REVISION_ROUNDS,
    reviews,
    usage,
    escalationId,
  };
}

export interface EscalationRow {
  id: string;
  workspace_id: string;
  goal_id: string | null;
  task_id: string;
  producer_id: string;
  reviewer_id: string;
  reason: string;
  deliverable: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function listEscalations(workspaceId: string, status = "open"): EscalationRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM escalations WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC"
    )
    .all(workspaceId, status) as EscalationRow[];
}

export function resolveEscalation(
  id: string,
  status: "resolved" | "dismissed",
  resolution: string
): boolean {
  const info = getDb()
    .prepare(
      `UPDATE escalations SET status = ?, resolution = ?,
         resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status = 'open'`
    )
    .run(status, resolution, id);
  if (info.changes > 0) {
    logEvent({ eventType: "escalation_resolved", detail: { escalationId: id, status, resolution } });
  }
  return info.changes > 0;
}

export function getReviews(taskId: string): unknown[] {
  return getDb()
    .prepare("SELECT * FROM reviews WHERE task_id = ? ORDER BY round")
    .all(taskId);
}
