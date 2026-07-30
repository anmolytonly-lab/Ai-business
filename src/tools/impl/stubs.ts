/**
 * Clearly-marked stubs. These tools exist so agent configs can declare them
 * and permission enforcement is exercised now; they return an explicit
 * "not available" message rather than pretending to work or inventing data.
 */
import { z } from "zod";
import { ToolDefinition } from "../types";

export const kbSearchTool: ToolDefinition<{ query: string }> = {
  name: "kb_search",
  description:
    "Search the company knowledge base (Company Brain) for relevant context. " +
    "NOT YET AVAILABLE — the knowledge base ships in Phase 6.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "What to look for" } },
    required: ["query"],
  },
  argsSchema: z.object({ query: z.string() }),
  handler: (args) =>
    `NOT AVAILABLE: the company knowledge base is not built yet (Phase 6). ` +
    `Your query was "${args.query}". Do not invent an answer — say the information ` +
    `is unavailable and needs to be added to the knowledge base.`,
};

export const kbWriteTool: ToolDefinition<{ title: string; content: string }> = {
  name: "kb_write",
  description:
    "Write a learning back to the company knowledge base for human review. " +
    "NOT YET AVAILABLE — the knowledge base ships in Phase 6.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
    },
    required: ["title", "content"],
  },
  argsSchema: z.object({ title: z.string(), content: z.string() }),
  handler: (args) =>
    `NOT AVAILABLE: knowledge base writes ship in Phase 6. Nothing was stored ` +
    `for "${args.title}".`,
};

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
