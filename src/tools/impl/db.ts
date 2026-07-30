import { z } from "zod";
import { getDb } from "../../db";
import { ToolDefinition } from "../types";

const MAX_ROWS = 100;

/** Tables an agent may read. Excludes llm_calls prompt bodies and approvals payloads. */
const READABLE_TABLES = ["goals", "tasks", "audit_log", "documents", "agent_memory"];

export const dbQueryTool: ToolDefinition<{ sql: string }> = {
  name: "db_query",
  description:
    `Run a read-only SQL SELECT against the company database and get rows back as JSON. ` +
    `Readable tables: ${READABLE_TABLES.join(", ")}. Writes are rejected. ` +
    `At most ${MAX_ROWS} rows are returned, so add your own LIMIT and aggregates.`,
  parameters: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A single SELECT statement" },
    },
    required: ["sql"],
  },
  argsSchema: z.object({ sql: z.string() }),
  handler: (args, ctx) => {
    const sql = args.sql.trim().replace(/;\s*$/, "");
    if (sql.includes(";")) {
      return "ERROR: only a single statement is allowed (no semicolons)";
    }
    if (!/^(select|with)\b/i.test(sql)) {
      return "ERROR: only SELECT (or WITH ... SELECT) queries are allowed";
    }

    let stmt;
    try {
      stmt = getDb().prepare(sql);
    } catch (err) {
      return `ERROR: could not prepare query: ${err instanceof Error ? err.message : String(err)}`;
    }
    // better-sqlite3 tells us authoritatively whether the statement writes.
    if (!stmt.readonly) {
      return "ERROR: query is not read-only and was rejected";
    }

    // Keep agents inside their own workspace's data.
    const lowered = sql.toLowerCase();
    for (const table of ["llm_calls", "approvals", "workspaces", "schema_migrations"]) {
      if (new RegExp(`\\b${table}\\b`).test(lowered)) {
        return `ERROR: table "${table}" is not readable by agents`;
      }
    }

    try {
      const rows = stmt.all() as unknown[];
      const clipped = rows.slice(0, MAX_ROWS);
      const note =
        rows.length > MAX_ROWS ? `\n[${rows.length - MAX_ROWS} more rows omitted]` : "";
      void ctx;
      return `${clipped.length} row(s):\n${JSON.stringify(clipped, null, 2)}${note}`;
    } catch (err) {
      return `ERROR: query failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
