/**
 * Phase 3 demo: owner goal -> CEO plans a task DAG -> TaskRunner executes it
 * with dependency-aware parallelism.
 * Usage: npm run demo:goal ["goal description"]
 */
import { initRegistry } from "../agents/registry";
import { getDb } from "../db";
import { createGoal, executeGoal, getGoal } from "../orchestration/goals";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace } from "../workspace";

async function main(): Promise<void> {
  getDb();
  ensureDefaultWorkspace();
  initRegistry();

  const description =
    process.argv[2] ??
    "Prepare a launch announcement for our new product 'AgentCorp Starter': a short blog post and a 3-email sequence, both consistent with each other.";

  console.log(`\nowner goal: ${description}\n`);
  const goalId = createGoal(DEFAULT_WORKSPACE_ID, description);
  console.log(`goal ${goalId} created — CEO is planning...\n`);

  const started = Date.now();
  const result = await executeGoal(goalId);

  const goal = getGoal(goalId);
  console.log("── task DAG ────────────────────────────────────────────");
  for (const t of goal?.tasks ?? []) {
    const deps = (JSON.parse(t.depends_on) as string[]).join(", ") || "none";
    console.log(`  ${t.id}  agent=${t.agent_id}  deps=[${deps}]  -> ${t.status}`);
  }
  console.log("\n── report ──────────────────────────────────────────────");
  console.log(result.report);
  console.log(`\nwall time: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const firstDone = goal?.tasks.find((t) => t.status === "completed");
  if (firstDone?.result != null) {
    console.log(`\n── sample deliverable (${firstDone.agent_id}) ──────────`);
    console.log(firstDone.result.slice(0, 800));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
