/**
 * Safety boundary for agent tools (spec item 14).
 *  - Filesystem access is confined to the workspace root; traversal and
 *    symlink escapes are rejected, not sanitised.
 *  - Shell execution uses an explicit command whitelist and never a shell,
 *    so metacharacters cannot chain or redirect anything.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env";

export class SandboxViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxViolation";
  }
}

export function workspaceRoot(): string {
  const root = path.resolve(process.cwd(), env.AGENT_WORKSPACE_ROOT);
  fs.mkdirSync(root, { recursive: true });
  // Resolve the root itself so comparisons are symlink-stable (e.g. /tmp on macOS).
  return fs.realpathSync(root);
}

/** True when `candidate` is the root itself or lives underneath it. */
function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root + path.sep);
}

/**
 * Resolve an agent-supplied path to an absolute path inside the workspace.
 * Throws SandboxViolation for absolute paths, `..` escapes, and symlinks that
 * point outside the workspace.
 */
export function resolveInWorkspace(relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new SandboxViolation("path must be a non-empty string");
  }
  if (relativePath.includes("\0")) {
    throw new SandboxViolation("path must not contain null bytes");
  }
  if (path.isAbsolute(relativePath)) {
    throw new SandboxViolation(
      `absolute paths are not allowed: "${relativePath}" — use a path relative to the workspace root`
    );
  }

  const root = workspaceRoot();
  const resolved = path.resolve(root, relativePath);
  if (!isInside(root, resolved)) {
    throw new SandboxViolation(
      `path escapes the workspace sandbox: "${relativePath}" resolves outside the workspace root`
    );
  }

  // Walk up to the nearest existing ancestor and realpath it, so a symlinked
  // directory anywhere in the chain cannot be used to break out.
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  if (!isInside(root, realExisting)) {
    throw new SandboxViolation(
      `path escapes the workspace sandbox via a symlink: "${relativePath}"`
    );
  }
  // For an existing target, also check the target itself (it may be a symlink).
  if (fs.existsSync(resolved)) {
    const realTarget = fs.realpathSync(resolved);
    if (!isInside(root, realTarget)) {
      throw new SandboxViolation(
        `path is a symlink pointing outside the workspace sandbox: "${relativePath}"`
      );
    }
    return realTarget;
  }
  return resolved;
}

/** Path shown back to agents — always relative to the workspace root. */
export function toWorkspaceRelative(absolutePath: string): string {
  return path.relative(workspaceRoot(), absolutePath) || ".";
}

/**
 * Commands agents may execute. Deliberately excludes anything that deletes
 * (`rm`, `mv`), escalates (`sudo`), fetches from the network (`curl`, `wget`),
 * or pushes code (`git`). Extend via SHELL_WHITELIST_EXTRA in .env.
 */
const DEFAULT_WHITELIST = [
  "ls", "cat", "head", "tail", "wc", "grep", "find", "echo", "pwd", "stat", "diff",
  "mkdir", "touch",
  "node", "npm", "npx", "tsc",
  "python3", "pip3", "pytest",
];

export function commandWhitelist(): string[] {
  const extra = env.SHELL_WHITELIST_EXTRA.split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return [...new Set([...DEFAULT_WHITELIST, ...extra])];
}

/**
 * Validate a command + args pair for execution. The command must be a bare
 * whitelisted name (no path, no metacharacters) and no argument may contain
 * shell metacharacters — commands run via execFile without a shell, so this
 * is belt-and-braces rather than the only defence.
 */
export function assertCommandAllowed(command: string, args: string[]): void {
  if (typeof command !== "string" || command.trim() === "") {
    throw new SandboxViolation("command must be a non-empty string");
  }
  if (command !== path.basename(command)) {
    throw new SandboxViolation(
      `command must be a bare executable name, not a path: "${command}"`
    );
  }
  const whitelist = commandWhitelist();
  if (!whitelist.includes(command)) {
    throw new SandboxViolation(
      `command "${command}" is not whitelisted. Allowed: ${whitelist.join(", ")}`
    );
  }
  for (const arg of args) {
    if (typeof arg !== "string") {
      throw new SandboxViolation("all command arguments must be strings");
    }
    if (arg.includes("\0")) {
      throw new SandboxViolation("command arguments must not contain null bytes");
    }
    if (/[;&|`$><\n]/.test(arg)) {
      throw new SandboxViolation(
        `argument contains shell metacharacters, which are not permitted: "${arg}"`
      );
    }
  }
}
