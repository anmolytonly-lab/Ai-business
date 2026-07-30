/**
 * Phase 7 demo: approval queue, budget guard, kill switch.
 * Usage: npm run demo:safety
 */
import { runAgent } from "../agents/executor";
import { getAgent, initRegistry } from "../agents/registry";
import { decideApproval, gatedActions, listApprovals, queueForApproval } from "../approvals";
import { initHandbook } from "../brain/handbook";
import { getDb } from "../db";
import { getSpendSnapshot } from "../safety/budget";
import { isKillSwitchOn, setKillSwitch } from "../safety/killswitch";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace } from "../workspace";

async function main(): Promise<void> {
  getDb();
  ensureDefaultWorkspace();
  initRegistry();
  initHandbook();
  setKillSwitch(false, "demo start");

  console.log("\n── gated actions per agent ────────────────────────────");
  for (const id of ["instagram_agent", "email_marketer", "devops", "analyst"]) {
    const actions = gatedActions(id);
    console.log(`  ${id.padEnd(18)} ${actions.length > 0 ? actions.join(", ") : "(nothing gated)"}`);
  }

  console.log("\n── 1. outbound content -> legal gate -> approval card ──");
  const draft = await runAgent(
    "instagram_agent",
    "Write a short Instagram caption announcing our Growth plan at $99/month.",
    { workspaceId: DEFAULT_WORKSPACE_ID }
  );
  console.log(`draft: ${draft.output.trim().slice(0, 200)}\n`);

  const { approvalId, legal } = await queueForApproval({
    workspaceId: DEFAULT_WORKSPACE_ID,
    agentId: "instagram_agent",
    content: draft.output,
    context: "Instagram caption announcing the Growth plan price",
  });
  console.log(`legal: ${legal.risky ? "FLAGGED" : "clear"} — ${legal.assessment.slice(0, 200)}`);
  if (legal.flags.length > 0) for (const f of legal.flags) console.log(`  flag: ${f.slice(0, 140)}`);
  console.log(`\ncard ${approvalId.slice(0, 8)} is PENDING — nothing has been posted.`);

  const pending = listApprovals(DEFAULT_WORKSPACE_ID);
  console.log(`pending approvals: ${pending.length}`);

  console.log("\n── 2. the human clicks ────────────────────────────────");
  decideApproval(approvalId, "approved", "Looks good, price is correct.");
  console.log(`after decision, pending: ${listApprovals(DEFAULT_WORKSPACE_ID).length}`);

  console.log("\n── 3. kill switch ─────────────────────────────────────");
  setKillSwitch(true, "(demo) owner pulled the switch");
  console.log(`engaged: ${isKillSwitchOn()}`);
  try {
    await runAgent("seo_writer", "Write one sentence about productivity.", {
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    console.log("  UNEXPECTED: the agent ran while the kill switch was engaged");
  } catch (err) {
    console.log(`  agent refused: ${err instanceof Error ? err.message : String(err)}`);
  }
  setKillSwitch(false, "(demo) released");
  const after = await runAgent("seo_writer", "Write one sentence about productivity.", {
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  console.log(`  after release, agent runs again: "${after.output.trim().slice(0, 90)}"`);

  console.log("\n── 4. budget ──────────────────────────────────────────");
  const snap = getSpendSnapshot();
  console.log(
    `  today: $${snap.dailySpendUsd.toFixed(4)} of $${snap.dailyBudgetUsd.toFixed(2)} ` +
      `(${(snap.percentUsed * 100).toFixed(1)}%), remaining $${snap.dailyRemainingUsd.toFixed(4)}`
  );
  console.log(`  per-agent daily cap: $${snap.agentDailyBudgetUsd.toFixed(2)}`);
  console.log(`  alert threshold (80%) reached: ${snap.alertThresholdReached}`);
  console.log("  top spenders today:");
  for (const a of snap.byAgent.slice(0, 5)) {
    console.log(`    ${a.agentId.padEnd(20)} $${a.spendUsd.toFixed(5)}  (${a.calls} calls)`);
  }
  const missing = snap.byAgent.filter((a) => getAgent(a.agentId) === undefined);
  if (missing.length > 0) console.log(`  (${missing.length} historical agent id(s) no longer in registry)`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
