/**
 * Company Brain tools (Phase 6). kb_search is real semantic retrieval;
 * kb_write stores an agent learning flagged for human review — it never
 * silently becomes trusted company knowledge.
 */
import { z } from "zod";
import { addDocument, search } from "../../brain";
import { ToolDefinition } from "../types";

export const kbSearchTool: ToolDefinition<{ query: string; limit?: number | undefined }> = {
  name: "kb_search",
  description:
    "Search the company knowledge base for relevant context: product docs, pricing, brand " +
    "voice, past decisions, customer FAQs. Use this before answering anything that depends " +
    "on how this specific business works. If it returns nothing, say the information is not " +
    "in the knowledge base — do not invent it.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you need to know" },
      limit: { type: "number", description: "Maximum passages to return (default 4)" },
    },
    required: ["query"],
  },
  argsSchema: z.object({ query: z.string(), limit: z.number().int().positive().max(10).optional() }),
  handler: async (args, ctx) => {
    const hits = await search(ctx.workspaceId, args.query, args.limit ?? 4);
    if (hits.length === 0) {
      return (
        `No matching entries in the company knowledge base for "${args.query}". ` +
        `Say that the information is not documented rather than inventing an answer.`
      );
    }
    return hits
      .map(
        (h, i) =>
          `[${i + 1}] ${h.title}${h.needsReview ? " (UNREVIEWED agent learning)" : ""} ` +
          `(relevance ${h.score.toFixed(2)})\n${h.content}`
      )
      .join("\n\n");
  },
};

export const kbWriteTool: ToolDefinition<{ title: string; content: string }> = {
  name: "kb_write",
  description:
    "Record a durable learning in the company knowledge base — something proven that future " +
    "work should know. Entries you write are flagged for human review before they are trusted. " +
    "Write facts and decisions, not speculation.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short descriptive title" },
      content: { type: "string", description: "The learning, self-contained and specific" },
    },
    required: ["title", "content"],
  },
  argsSchema: z.object({ title: z.string(), content: z.string() }),
  handler: async (args, ctx) => {
    const { documentId, chunks } = await addDocument({
      workspaceId: ctx.workspaceId,
      title: args.title,
      content: args.content,
      source: "agent",
      agentId: ctx.agentId,
    });
    return (
      `Stored as document ${documentId} (${chunks} chunk(s)), flagged for human review. ` +
      `It is searchable now but marked unreviewed until the owner approves it.`
    );
  },
};
