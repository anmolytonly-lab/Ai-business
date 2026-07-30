import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveInWorkspace, toWorkspaceRelative, workspaceRoot } from "../sandbox";
import { ToolDefinition } from "../types";

const MAX_READ_CHARS = 20_000;
const MAX_WRITE_CHARS = 200_000;

export const fileReadTool: ToolDefinition<{ path: string }> = {
  name: "file_read",
  description:
    "Read a UTF-8 text file from the workspace. Paths are relative to the workspace root; " +
    "paths outside the workspace are rejected.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to the workspace root" },
    },
    required: ["path"],
  },
  argsSchema: z.object({ path: z.string() }),
  handler: (args) => {
    const full = resolveInWorkspace(args.path);
    if (!fs.existsSync(full)) return `ERROR: file not found: ${args.path}`;
    if (fs.statSync(full).isDirectory()) {
      return `ERROR: ${args.path} is a directory — use file_list instead`;
    }
    const content = fs.readFileSync(full, "utf8");
    return content.length > MAX_READ_CHARS
      ? `${content.slice(0, MAX_READ_CHARS)}\n[...truncated at ${MAX_READ_CHARS} characters]`
      : content;
  },
};

export const fileWriteTool: ToolDefinition<{ path: string; content: string }> = {
  name: "file_write",
  description:
    "Create or overwrite a UTF-8 text file in the workspace. Parent directories are created " +
    "as needed. Paths are relative to the workspace root; paths outside it are rejected.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to the workspace root" },
      content: { type: "string", description: "Full file contents to write" },
    },
    required: ["path", "content"],
  },
  argsSchema: z.object({ path: z.string(), content: z.string() }),
  handler: (args) => {
    if (args.content.length > MAX_WRITE_CHARS) {
      return `ERROR: content exceeds the ${MAX_WRITE_CHARS}-character write limit`;
    }
    const full = resolveInWorkspace(args.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, args.content, "utf8");
    return `Wrote ${args.content.length} characters to ${toWorkspaceRelative(full)}`;
  },
};

export const fileListTool: ToolDefinition<{ path?: string | undefined }> = {
  name: "file_list",
  description:
    "List files and directories in a workspace directory. Defaults to the workspace root.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path relative to the workspace root (default: root)",
      },
    },
  },
  argsSchema: z.object({ path: z.string().optional() }),
  handler: (args) => {
    const target = args.path === undefined || args.path === "" ? "." : args.path;
    const full = target === "." ? workspaceRoot() : resolveInWorkspace(target);
    if (!fs.existsSync(full)) return `ERROR: directory not found: ${target}`;
    if (!fs.statSync(full).isDirectory()) return `ERROR: ${target} is not a directory`;
    const entries = fs.readdirSync(full, { withFileTypes: true });
    if (entries.length === 0) return `(empty directory: ${target})`;
    return entries
      .map((e) => {
        if (e.isDirectory()) return `${e.name}/`;
        const size = fs.statSync(path.join(full, e.name)).size;
        return `${e.name} (${size} bytes)`;
      })
      .sort()
      .join("\n");
  },
};
