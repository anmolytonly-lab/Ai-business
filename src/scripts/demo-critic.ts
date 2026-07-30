/**
 * Phase 5 demo: the critic loop.
 *  1. A task with a bar the agent should clear on the first attempt.
 *  2. A task with a deliberately strict criterion, to show revision rounds
 *     and — if it still can't pass — escalation to the human.
 * Usage: npm run demo:critic
 */
import crypto from "node:crypto";
import { initRegistry } from "../agents/registry";
import { getDb } from "../db";
import { listEscalations, pickReviewer, produceWithReview } from "../orchestration/critic";
import { createGoal } from "../orchestration/goals";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace } from "../workspace";

function seedTask(goalId: string, agentId: string, instruction: string, criteria: string): string {
  const id = `demo-${crypto.randomUUID().slice(0, 8)}`;
  getDb()
    .prepare(
      `INSERT INTO tasks (id, goal_id, workspace_id, agent_id, instruction,
                          acceptance_criteria, depends_on, status)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 'pending')`
    )
    .run(id, goalId, DEFAULT_WORKSPACE_ID, agentId, instruction, criteria);
  return id;
}

async function scenario(
  goalId: string,
  label: string,
  agentId: string,
  instruction: string,
  criteria: string
): Promise<void> {
  console.log(`\n── ${label} ─────────────────────────────────────`);
  console.log(`producer: ${agentId}   reviewer: ${pickReviewer(agentId)}`);
  console.log(`criteria: ${criteria}\n`);

  const taskId = seedTask(goalId, agentId, instruction, criteria);
  const result = await produceWithReview({
    taskId,
    goalId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    producerId: agentId,
    instruction,
    acceptanceCriteria: criteria,
    basePrompt: `Your task: ${instruction}\n\nAcceptance criteria:\n${criteria}`,
  });

  for (const r of result.reviews) {
    console.log(`  round ${r.round}: ${r.verdict} by ${r.reviewerId}`);
    console.log(`    ${r.feedback.slice(0, 180)}`);
    for (const c of r.requiredChanges.slice(0, 3)) console.log(`      - ${c.slice(0, 120)}`);
  }
  console.log(`\n  status: ${result.status} after ${result.rounds} revision round(s), $${result.usage.costUsd.toFixed(5)}`);
  console.log(`  deliverable: ${result.output.trim().slice(0, 300).replace(/\n/g, " ")}`);
}

async function main(): Promise<void> {
  getDb();
  ensureDefaultWorkspace();
  initRegistry();

  const goalId = createGoal(DEFAULT_WORKSPACE_ID, "Phase 5 critic loop demo");

  await scenario(
    goalId,
    "1. reasonable bar (expect APPROVE)",
    "ad_copywriter",
    "Write one headline for a productivity app aimed at freelancers.",
    "Exactly one headline. Under 12 words. Names the audience or their problem."
  );

  // A lipogram: achievable in principle, mechanically checkable, and something
  // language models reliably get wrong — so it exercises revision rounds.
  await scenario(
    goalId,
    "2. strict constraint (expect revisions, likely escalation)",
    "ad_copywriter",
    "Write a one-sentence product description for a task management app.",
    "The sentence must not contain the letter 'e' anywhere at all. " +
      "It must be between 10 and 20 words. Reject it if even one 'e' appears."
  );

  const open = listEscalations(DEFAULT_WORKSPACE_ID);
  console.log(`\n── open escalations: ${open.length} ─────────────────────`);
  for (const e of open.slice(0, 3)) {
    console.log(`  ${e.id.slice(0, 8)}  task=${e.task_id}  ${e.producer_id} -> ${e.reviewer_id}`);
    console.log(`    ${e.reason.slice(0, 200)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
