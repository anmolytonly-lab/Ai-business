import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Minimal .env loader — avoids pulling in dotenv, which isn't on the approved
// dependency list. Values already present in process.env win over the file.
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.resolve(process.cwd(), ".env"));

const envSchema = z.object({
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("./data/agentcorp.db"),
  DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  /** Filesystem sandbox root — agents can never read or write outside this. */
  AGENT_WORKSPACE_ROOT: z.string().default("./workspace"),
  /** Extra whitelisted shell commands, comma-separated. Empty by default. */
  SHELL_WHITELIST_EXTRA: z.string().default(""),
  /** Company Brain embedding model and dimensionality (must match the schema). */
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  /** Chunks retrieved and injected into an agent's prompt before it answers. */
  BRAIN_TOP_K: z.coerce.number().int().positive().default(4),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;

export function requireGeminiKey(): string {
  if (env.GEMINI_API_KEY === "") {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
  return env.GEMINI_API_KEY;
}
