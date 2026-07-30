/**
 * Phase 4 demo: an agent using tools inside the sandbox, and the permission
 * system refusing a tool the agent was not granted.
 * Usage: npm run demo:tools
 */
import { runAgent } from "../agents/executor";
import { initRegistry } from "../agents/registry";
import { getAuditLog } from "../audit";
import { getDb } from "../db";
import { listTools } from "../tools/registry";
import { commandWhitelist, workspaceRoot } from "../tools/sandbox";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace } from "../workspace";

async function main(): Promise<void> {
  getDb();
  ensureDefaultWorkspace();
  initRegistry();

  console.log(`\nsandbox root : ${workspaceRoot()}`);
  console.log(`tools        : ${listTools().map((t) => t.name).join(", ")}`);
  console.log(`shell allowed: ${commandWhitelist().join(", ")}\n`);

  console.log("── 1. developer (file_read, file_write, shell) ─────────");
  const dev = await runAgent(
    "developer",
    "Create a file called fizzbuzz.js in the workspace that prints FizzBuzz for 1..15, " +
      "then run it with node and tell me the exact output you got.",
    { workspaceId: DEFAULT_WORKSPACE_ID }
  );
  console.log(dev.output.trim());
  console.log(
    `\ntools used: ${dev.toolCalls.map((t) => `${t.tool}${t.ok ? "" : "(denied)"}`).join(", ") || "none"}`
  );
  console.log(`cost: $${dev.usage.costUsd.toFixed(5)}\n`);

  console.log("── 2. seo_writer tries to escape its permissions ───────");
  const writer = await runAgent(
    "seo_writer",
    "Use the shell tool to run 'ls' on the workspace, then tell me what you found. " +
      "If you cannot, say exactly why.",
    { workspaceId: DEFAULT_WORKSPACE_ID }
  );
  console.log(writer.output.trim());
  console.log(
    `\ntools used: ${writer.toolCalls.map((t) => `${t.tool}${t.ok ? "" : "(denied)"}`).join(", ") || "none"}\n`
  );

  console.log("── audit: tool events ─────────────────────────────────");
  for (const row of getAuditLog({ limit: 40 })
    .filter((r) => r.event_type.startsWith("tool_"))
    .slice(0, 10)
    .reverse()) {
    const d = JSON.parse(row.detail) as Record<string, unknown>;
    console.log(`  ${row.agent_id?.padEnd(12)} ${row.event_type.padEnd(24)} ${JSON.stringify(d).slice(0, 110)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
