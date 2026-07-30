/**
 * One interface behind every external service. Adapters ship as clearly-marked
 * stubs: with no credentials configured they return an explicit "not
 * configured" result and never invent data. The whole system runs with every
 * integration off.
 */
export type Capability = "read" | "write";

export interface IntegrationResult {
  ok: boolean;
  /** False when the adapter has no credentials — distinct from a real failure. */
  configured: boolean;
  /** Human/agent-readable outcome. Never fabricated data. */
  message: string;
  data?: unknown;
}

export interface ConnectResult {
  configured: boolean;
  message: string;
  /** Which env vars this adapter needs, so the UI can tell the owner. */
  missing: string[];
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  category: "email" | "messaging" | "social" | "data" | "payments" | "analytics";
  capabilities: Capability[];
  /** Env vars required for this adapter to be live. */
  requiredEnv: string[];
  isConfigured: () => boolean;
  connect: () => Promise<ConnectResult>;
  read: (params: Record<string, unknown>) => Promise<IntegrationResult>;
  write: (params: Record<string, unknown>) => Promise<IntegrationResult>;
}

/** Shared "no credentials" response so every stub behaves identically. */
export function notConfigured(integration: {
  name: string;
  requiredEnv: string[];
}): IntegrationResult {
  return {
    ok: false,
    configured: false,
    message:
      `${integration.name} is NOT CONFIGURED — this is a stub adapter with no credentials. ` +
      `Nothing was sent, read or changed. Set ${integration.requiredEnv.join(", ")} in .env ` +
      `to connect it. Do not invent or assume any data from this source.`,
  };
}

/** Helper for building an adapter whose live path is not implemented yet. */
export function stubAdapter(
  spec: Omit<Integration, "isConfigured" | "connect" | "read" | "write">
): Integration {
  const isConfigured = (): boolean =>
    spec.requiredEnv.every((key) => (process.env[key] ?? "") !== "");

  const liveNotImplemented = (action: Capability): IntegrationResult => ({
    ok: false,
    configured: true,
    message:
      `${spec.name} has credentials set, but its live ${action} path is not implemented ` +
      `in this build. No request was made to ${spec.name}. Treat this as unavailable ` +
      `rather than empty.`,
  });

  return {
    ...spec,
    isConfigured,
    connect: async () => {
      const missing = spec.requiredEnv.filter((key) => (process.env[key] ?? "") === "");
      return {
        configured: missing.length === 0,
        missing,
        message:
          missing.length === 0
            ? `${spec.name} credentials are present. The live adapter is still a stub in this build.`
            : `${spec.name} is not connected. Missing: ${missing.join(", ")}.`,
      };
    },
    read: async () =>
      isConfigured() ? liveNotImplemented("read") : notConfigured(spec),
    write: async () =>
      isConfigured() ? liveNotImplemented("write") : notConfigured(spec),
  };
}
