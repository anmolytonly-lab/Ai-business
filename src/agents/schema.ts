import { z } from "zod";

export const agentSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "id must be snake_case"),
  name: z.string().min(1),
  department: z.enum(["executive", "product", "marketing", "sales", "ops"]),
  role: z.string().min(1),
  systemPrompt: z.string().min(1),
  tools: z.array(z.string()).default([]),
  /** Agent id this agent reports to, or "owner" for the human. */
  reportsTo: z.string(),
  canDelegateTo: z.array(z.string()).default([]),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  /** USD cap per single task execution. */
  maxCostPerTask: z.number().positive(),
  /** Action types that must pass the human approval queue (Phase 7). */
  requiresApproval: z.array(z.string()).default([]),
});

export type AgentConfig = z.infer<typeof agentSchema>;
