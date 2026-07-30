/**
 * Clearly-marked stubs for integrations that don't exist yet. They return an
 * explicit "not available" message rather than pretending to work or inventing
 * data. Real adapters land in Phase 10.
 */
import { z } from "zod";
import { ToolDefinition } from "../types";

export const webSearchTool: ToolDefinition<{ query: string }> = {
  name: "web_search",
  description:
    "Search the web for current information with sources. " +
    "NOT YET AVAILABLE — external integrations ship in Phase 10.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  argsSchema: z.object({ query: z.string() }),
  external: true,
  handler: (args) =>
    `NOT AVAILABLE: web search is not configured (Phase 10 integrations). ` +
    `Your query was "${args.query}". Do not fabricate sources or statistics — ` +
    `state plainly that this needs research you cannot perform yet.`,
};
