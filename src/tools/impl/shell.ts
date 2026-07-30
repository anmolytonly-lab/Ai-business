import { execFile } from "node:child_process";
import { z } from "zod";
import {
  assertCommandAllowed,
  commandWhitelist,
  resolveInWorkspace,
  workspaceRoot,
} from "../sandbox";
import { ToolDefinition } from "../types";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 15_000;

interface ShellArgs {
  command: string;
  args?: string[] | undefined;
  cwd?: string | undefined;
}

export const shellTool: ToolDefinition<ShellArgs> = {
  name: "shell",
  description:
    `Run a whitelisted command inside the workspace. Provide the executable name and its ` +
    `arguments as separate array entries — there is no shell, so pipes, redirects and ` +
    `command chaining are unavailable. Allowed commands: ${commandWhitelist().join(", ")}.`,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Executable name, e.g. \"node\"" },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments, one array entry each",
      },
      cwd: {
        type: "string",
        description: "Working directory relative to the workspace root (default: root)",
      },
    },
    required: ["command"],
  },
  argsSchema: z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
  }),
  handler: async (args) => {
    const argv = args.args ?? [];
    assertCommandAllowed(args.command, argv);
    const cwd =
      args.cwd === undefined || args.cwd === "" ? workspaceRoot() : resolveInWorkspace(args.cwd);

    return new Promise<string>((resolve) => {
      execFile(
        args.command,
        argv,
        {
          cwd,
          timeout: TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
          shell: false,
          // Minimal environment: no inherited API keys or secrets.
          env: { PATH: process.env.PATH ?? "", HOME: cwd, NODE_ENV: "sandbox" },
        },
        (err, stdout, stderr) => {
          const clip = (s: string): string =>
            s.length > MAX_OUTPUT_CHARS
              ? `${s.slice(0, MAX_OUTPUT_CHARS)}\n[...truncated]`
              : s;
          const parts: string[] = [];
          if (stdout !== "") parts.push(`stdout:\n${clip(stdout)}`);
          if (stderr !== "") parts.push(`stderr:\n${clip(stderr)}`);
          if (err) {
            const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
            parts.push(`exit: ${String(code ?? "error")} (${err.message})`);
          } else {
            parts.push("exit: 0");
          }
          resolve(parts.join("\n\n") || "(no output)");
        }
      );
    });
  },
};
