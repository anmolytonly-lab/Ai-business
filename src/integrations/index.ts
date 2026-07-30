/**
 * Integration registry. Every adapter is a clearly-marked stub until its
 * credentials are set AND its live path is implemented; the system runs fully
 * with all of them off.
 */
import { logEvent } from "../audit";
import { Integration, IntegrationResult, stubAdapter } from "./types";

const ADAPTERS: Integration[] = [
  stubAdapter({
    id: "gmail",
    name: "Gmail",
    description: "Read and send email from the company inbox.",
    category: "email",
    capabilities: ["read", "write"],
    requiredEnv: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
  }),
  stubAdapter({
    id: "whatsapp",
    name: "WhatsApp Cloud API",
    description: "Read and reply to WhatsApp business messages.",
    category: "messaging",
    capabilities: ["read", "write"],
    requiredEnv: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"],
  }),
  stubAdapter({
    id: "instagram",
    name: "Instagram Graph API",
    description: "Publish posts and read comments/DMs on the business account.",
    category: "social",
    capabilities: ["read", "write"],
    requiredEnv: ["INSTAGRAM_BUSINESS_ACCOUNT_ID", "INSTAGRAM_ACCESS_TOKEN"],
  }),
  stubAdapter({
    id: "google_sheets",
    name: "Google Sheets",
    description: "Read and append rows in a spreadsheet.",
    category: "data",
    capabilities: ["read", "write"],
    requiredEnv: ["GOOGLE_SHEETS_CLIENT_EMAIL", "GOOGLE_SHEETS_PRIVATE_KEY", "GOOGLE_SHEETS_ID"],
  }),
  stubAdapter({
    id: "notion",
    name: "Notion",
    description: "Read and write pages and databases.",
    category: "data",
    capabilities: ["read", "write"],
    requiredEnv: ["NOTION_API_KEY", "NOTION_DATABASE_ID"],
  }),
  stubAdapter({
    id: "stripe",
    name: "Stripe",
    description: "Read payments and revenue; create payment links.",
    category: "payments",
    capabilities: ["read", "write"],
    requiredEnv: ["STRIPE_SECRET_KEY"],
  }),
  stubAdapter({
    id: "razorpay",
    name: "Razorpay",
    description: "Read payments and revenue; create payment links.",
    category: "payments",
    capabilities: ["read", "write"],
    requiredEnv: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
  }),
  stubAdapter({
    id: "google_analytics",
    name: "Google Analytics",
    description: "Read traffic, conversion and acquisition metrics.",
    category: "analytics",
    capabilities: ["read"],
    requiredEnv: ["GA_PROPERTY_ID", "GA_CLIENT_EMAIL", "GA_PRIVATE_KEY"],
  }),
];

const registry = new Map(ADAPTERS.map((a) => [a.id, a]));

export function getIntegration(id: string): Integration | undefined {
  return registry.get(id);
}

export function listIntegrations(): {
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  requiredEnv: string[];
  configured: boolean;
}[] {
  return ADAPTERS.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    category: a.category,
    capabilities: a.capabilities,
    requiredEnv: a.requiredEnv,
    configured: a.isConfigured(),
  }));
}

/** True when at least one adapter has credentials. */
export function anyConfigured(): boolean {
  return ADAPTERS.some((a) => a.isConfigured());
}

export async function callIntegration(
  id: string,
  action: "read" | "write",
  params: Record<string, unknown>,
  ctx: { workspaceId: string; agentId?: string }
): Promise<IntegrationResult> {
  const adapter = registry.get(id);
  if (adapter === undefined) {
    return { ok: false, configured: false, message: `No such integration "${id}".` };
  }
  if (!adapter.capabilities.includes(action)) {
    return {
      ok: false,
      configured: adapter.isConfigured(),
      message: `${adapter.name} does not support ${action}.`,
    };
  }

  const result = action === "read" ? await adapter.read(params) : await adapter.write(params);
  logEvent({
    workspaceId: ctx.workspaceId,
    ...(ctx.agentId !== undefined ? { agentId: ctx.agentId } : {}),
    eventType: "integration_call",
    detail: { integration: id, action, configured: result.configured, ok: result.ok },
  });
  return result;
}

export { ADAPTERS };
