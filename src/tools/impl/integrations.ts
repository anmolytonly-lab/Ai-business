/**
 * Each integration becomes its own tool, named `integration_<id>`, so the
 * existing per-agent `tools[]` grant is the enforcement point for spec item
 * 14: no agent may call an external integration it wasn't granted.
 *
 * Writes are additionally gated: an agent whose requiresApproval[] covers the
 * action cannot write directly — the call is refused with instructions to
 * route the content through the approval queue instead.
 */
import { z } from "zod";
import { getAgent } from "../../agents/registry";
import { ADAPTERS, callIntegration } from "../../integrations";
import { ToolDefinition } from "../types";

interface IntegrationArgs {
  action: "read" | "write";
  params?: Record<string, unknown> | undefined;
}

/** Approval action types that gate writing to an outbound channel. */
const OUTBOUND_ACTIONS = ["publish", "send_email", "send_dm", "send_proposal", "spend", "deploy"];

export const integrationTools: ToolDefinition<IntegrationArgs>[] = ADAPTERS.map((adapter) => ({
  name: `integration_${adapter.id}`,
  description:
    `${adapter.name}: ${adapter.description} Supports ${adapter.capabilities.join(" and ")}. ` +
    `If it reports NOT CONFIGURED, say the data or channel is unavailable — never invent ` +
    `results from it.`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: adapter.capabilities,
        description: "What to do with this integration",
      },
      params: {
        type: "object",
        description: "Adapter-specific parameters (e.g. recipient, subject, body, range)",
      },
    },
    required: ["action"],
  },
  argsSchema: z.object({
    action: z.enum(["read", "write"]),
    params: z.record(z.unknown()).optional(),
  }),
  external: true,
  handler: async (args, ctx) => {
    if (args.action === "write") {
      const gated = (getAgent(ctx.agentId)?.requiresApproval ?? []).filter((a) =>
        OUTBOUND_ACTIONS.includes(a)
      );
      if (gated.length > 0) {
        return (
          `REFUSED: you may not write to ${adapter.name} directly. Your gated actions ` +
          `(${gated.join(", ")}) require human approval. Produce the content as your ` +
          `deliverable instead — it will go through the legal check and the owner's ` +
          `approval queue, and only then can it be sent.`
        );
      }
    }
    const result = await callIntegration(adapter.id, args.action, args.params ?? {}, {
      workspaceId: ctx.workspaceId,
      agentId: ctx.agentId,
    });
    return result.message;
  },
}));
