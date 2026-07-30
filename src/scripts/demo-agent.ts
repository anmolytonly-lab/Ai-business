/**
 * Phase 2 demo: single-agent execution with full audit logging.
 * Usage: npm run demo:agent [agentId] ["instruction"]
 * Defaults to the SEO writer drafting a short outline.
 */
import { runAgent } from "../agents/executor";
import { initRegistry, listAgents } from "../agents/registry";
import { getAuditLog } from "../audit";
import { getDb } from "../db";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace } from "../workspace";

async function main(): Promise<void> {
  getDb();
  ensureDefaultWorkspace();
  initRegistry();

  const agentId = process.argv[2] ?? "seo_writer";
  const instruction =
    process.argv[3] ??
    "Draft a 5-point outline (titles + one-line summaries only) for a blog post targeting the keyword 'AI business automation'.";

  console.log(`\nregistry: ${listAgents().length} agents loaded`);
  console.log(`running agent "${agentId}"...\ninstruction: ${instruction}\n`);

  const result = await runAgent(agentId, instruction, { workspaceId: DEFAULT_WORKSPACE_ID });

  console.log("── output ──────────────────────────────────────────────");
  console.log(result.output.trim());
  console.log("────────────────────────────────────────────────────────\n");
  console.log(
    `run ${result.runId}: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens, ` +
      `~$${result.usage.costUsd.toFixed(6)}, ${result.usage.latencyMs}ms, model ${result.usage.model}` +
      (result.overBudget ? "  ⚠ OVER maxCostPerTask" : "")
  );

  console.log("\naudit trail for this agent:");
  for (const row of getAuditLog({ agentId, limit: 5 }).reverse()) {
    const detail = JSON.parse(row.detail) as Record<string, unknown>;
    console.log(`  [${row.created_at}] ${row.event_type} ${JSON.stringify(detail).slice(0, 140)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
