import { getDb } from "./db";

export const DEFAULT_WORKSPACE_ID = "default";

/** Multi-workspace support lands in Phase 10; until then everything runs in "default". */
export function ensureDefaultWorkspace(): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)")
    .run(DEFAULT_WORKSPACE_ID, "Default Workspace");
}
