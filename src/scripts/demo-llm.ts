/**
 * Phase 1 demo: one working Gemini call through the provider module.
 * Usage: npm run demo:llm ["your prompt here"]
 * Demonstrates plain-text generation, the zod-validated JSON path, and the
 * audit row written to llm_calls.
 */
import { z } from "zod";
import { getDb } from "../db";
import { generateJson, generateText } from "../llm/provider";

async function main(): Promise<void> {
  const prompt =
    process.argv[2] ??
    "In one sentence, introduce yourself as the CEO agent of AgentCorp, an autonomous AI-run business.";

  console.log(`prompt: ${prompt}\n`);

  const result = await generateText(prompt, { purpose: "phase1-demo" });
  console.log(`response: ${result.text.trim()}\n`);
  console.log(
    `usage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens, ` +
      `~$${result.usage.costUsd.toFixed(6)}, ${result.usage.latencyMs}ms, model ${result.usage.model}\n`
  );

  const taglineSchema = z.object({
    tagline: z.string(),
    tone: z.string(),
  });
  const json = await generateJson(
    'Write a 6-word tagline for "AgentCorp", an AI-run business platform, as {"tagline": string, "tone": string}.',
    taglineSchema,
    { purpose: "phase1-demo-json" }
  );
  console.log(`json demo: ${JSON.stringify(json.data)}\n`);

  const audit = getDb()
    .prepare(
      "SELECT id, model, purpose, input_tokens, output_tokens, cost_usd, status FROM llm_calls ORDER BY id DESC LIMIT 5"
    )
    .all();
  console.log("last llm_calls audit rows:");
  console.table(audit);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
