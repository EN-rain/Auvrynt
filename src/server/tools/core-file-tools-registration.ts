import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateUnifiedPatch } from "@earendil-works/pi-coding-agent";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import { logEvent } from "../../logger.js";
import {
  editFileTool,
  findFilesTool,
  grepFilesTool,
  listDirectoryTool,
  readFileTool,
  runShellTool,
} from "../../pi-tools.js";
import type { createReviewCheckpointManager } from "../../review-checkpoints.js";
import { executeViewImage } from "../../view-image.js";
import { MAX_TRANSFER_CHUNK_BYTES, writeFileTransferChunk } from "../../workspace/file-transfer.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import { countTextLines, type WorkspaceChangeTracker } from "../workspace-analytics.js";
import {
  EDIT_TOOL_ANNOTATIONS,
  SHELL_TOOL_ANNOTATIONS,
  VIEW_IMAGE_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  resultOutputSchema,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

const MAX_WRITE_SIZE = 50 * 1024 * 1024;

type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface CoreFileToolNames {
  read: "read_file" | "read";
  write: "write_file" | "write";
  edit: "edit_file" | "edit";
  grep: "grep_files" | "grep";
  glob: "find_files" | "glob";
  ls: "list_directory" | "ls";
  shell: "run_shell" | "bash";
}

interface ToolLogFields {
  tool: string;
  workspaceId?: string;
  path?: string;
  workingDirectory?: string;
  command?: string;
  commandLength?: number;
  success: boolean;
  durationMs: number;
  error?: string;
}

type LogToolCall = (config: ServerConfig, fields: ToolLogFields) => void;
type LogFailedToolResponse = (
  config: ServerConfig,
  fields: Omit<ToolLogFields, "success" | "durationMs">,
  content: ToolContent[],
  startedAt: number,
) => void;

async function safeWriteFile(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${randomUUID()}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

function contentText(content: ToolContent[]): string {
  return content.map((block) => block.type === "text" ? block.text : `[${block.mimeType} image]`).join("\n");
}

function textBlock(text: string): ToolContent {
  return { type: "text", text };
}

function textSummary(content: ToolContent[]): { blocks: number; characters: number; images: number } {
  return {
    blocks: content.length,
    characters: content.filter((block): block is Extract<ToolContent, { type: "text" }> => block.type === "text")
      .reduce((total, block) => total + block.text.length, 0),
    images: content.filter((block) => block.type === "image").length,
  };
}

function contentLineCount(content: string): number {
  return countTextLines(content);
}

async function readExistingTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function countDiffStats(diff: string | undefined): { additions: number; removals: number } {
  if (!diff) return { additions: 0, removals: 0 };
  let additions = 0;
  let removals = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    if (line.startsWith("-")) removals++;
  }
  return { additions, removals };
}

function contentLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function newFilePatch(path: string, content: string): string {
  const lines = contentLines(content);
  const body = lines.map((line) => `+${line}`).join("\n");
  return `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
}

export function registerCoreFileTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  reviewCheckpoints: ReturnType<typeof createReviewCheckpointManager>,
  toolNames: CoreFileToolNames,
  workspaceChanges: WorkspaceChangeTracker,
  logToolCall: LogToolCall,
  logFailedToolResponse: LogFailedToolResponse,
): void {
  registerAppTool(server, toolNames.read, {
    title: "Read file",
    description: [
      "Read a file inside an open workspace. Use this for file inspection instead of shell commands like cat or sed. Call open_workspace first and pass workspaceId.",
      "Use this tool to inspect relevant AGENTS.md or CLAUDE.md files listed by open_workspace before working in nested directories.",
      config.skillsEnabled
        ? "If available skills were returned and a task matches one, read that skill's path before proceeding. Skill paths may be outside the workspace; only advertised SKILL.md files and files under already-loaded skill directories are readable."
        : "",
    ].filter(Boolean).join(" "),
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      path: z.string().describe(config.skillsEnabled
        ? "File path to read, relative to the workspace root. May also be an advertised skill path from open_workspace skills."
        : "File path to read, relative to the workspace root."),
      offset: z.number().int().positive().optional().describe("1-indexed line number to start reading from."),
      limit: z.number().int().positive().optional().describe("Maximum number of lines to read."),
    },
    outputSchema: resultOutputSchema(),
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: { readOnlyHint: true },
  }, async ({ workspaceId, ...input }) => {
    const startedAt = performance.now();
    const workspace = workspaces.getWorkspace(workspaceId);
    const readPath = workspaces.resolveReadPath(workspace, input.path);
    const response = await readFileTool({ ...input, path: readPath.absolutePath }, {
      cwd: workspace.root,
      root: workspace.root,
      readRoots: readPath.readRoots,
    });
    if (response.isError) {
      logFailedToolResponse(config, { tool: toolNames.read, workspaceId, path: input.path }, response.content, startedAt);
      return response;
    }
    workspaces.markReadPathLoaded(workspace, readPath);
    logToolCall(config, {
      tool: toolNames.read, workspaceId, path: input.path, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      ...response,
      _meta: {
        tool: toolNames.read,
        card: {
          workspaceId, path: input.path,
          summary: {
            ...textSummary(response.content),
            lines: contentLineCount(contentText(response.content)),
            offset: input.offset ?? 1,
            limited: input.limit !== undefined,
          },
          payload: { content: response.content },
        },
      },
      structuredContent: { result: contentText(response.content) },
    };
  });

  registerAppTool(server, "view_image", {
    title: "View image",
    description: "View a local image file (.png, .jpg, .jpeg, .webp, .gif) inside an open workspace as visual MCP image content. Use this when asked to inspect, describe, analyze, or compare images. Call open_workspace first and pass workspaceId.",
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      path: z.string().describe("Image file path, relative to the workspace root."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: VIEW_IMAGE_TOOL_ANNOTATIONS,
  }, async ({ workspaceId, path }) => {
    const startedAt = performance.now();
    const response = await executeViewImage(workspaces, { workspaceId, path });
    if (response.isError) {
      logFailedToolResponse(config, { tool: "view_image", workspaceId, path }, response.content, startedAt);
      return response;
    }
    logToolCall(config, {
      tool: "view_image", workspaceId, path, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return response;
  });

  registerAppTool(server, "transfer_file", {
    title: "Transfer binary file",
    description: `Transfer binary bytes from the web client into a local workspace file. Use this for generated or attached images and other binary artifacts that cannot be sent through the text-only ${toolNames.write} tool. Send base64 or a base64 data URL. Each call accepts up to ${MAX_TRANSFER_CHUNK_BYTES} decoded bytes; for larger files, send sequential chunks using the returned nextOffset and set final=false until the last chunk.`,
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      path: z.string().describe("Destination path relative to the workspace root."),
      dataBase64: z.string().min(1).max(Math.ceil(MAX_TRANSFER_CHUNK_BYTES / 3) * 4 + 1024).describe("Raw base64 bytes or a data:<mime>;base64,... URL."),
      mimeType: z.string().trim().min(1).max(128).optional().describe("Optional MIME type. Data URLs are accepted and validated against this value when both are supplied."),
      offset: z.number().int().min(0).optional().describe("Byte offset for this chunk. Omit or use 0 for the first chunk; later chunks must equal the previous nextOffset."),
      overwrite: z.boolean().optional().describe("Allow replacing an existing destination. Valid only for the first chunk; defaults to false."),
      final: z.boolean().optional().describe("Defaults to true. Set false when more chunks will follow."),
      expectedSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional().describe("Optional expected SHA-256 for the completed file. Checked on the final chunk."),
    },
    outputSchema: resultOutputSchema({
      path: z.string(),
      bytesWritten: z.number().int().nonnegative(),
      sizeBytes: z.number().int().nonnegative(),
      nextOffset: z.number().int().nonnegative(),
      final: z.boolean(),
      sha256: z.string().optional(),
      mimeType: z.string().optional(),
    }),
    ...toolWidgetDescriptorMeta(config, "write"), annotations: WRITE_TOOL_ANNOTATIONS,
  }, async ({ workspaceId, path, ...input }) => {
    const startedAt = performance.now();
    const workspace = workspaces.getWorkspace(workspaceId);
    const absolutePath = workspaces.resolvePath(workspace, path);
    const result = await writeFileTransferChunk({ absolutePath, ...input });
    workspaceChanges.recordMutation({
      workspaceId,
      workspaceRoot: workspace.root,
      path,
      kind: (input.offset ?? 0) === 0 && !input.overwrite ? "created" : "modified",
      additions: 0,
      removals: 0,
    });
    const summary = result.final
      ? `Transferred ${result.sizeBytes} bytes to ${path}${result.sha256 ? ` (sha256 ${result.sha256})` : ""}.`
      : `Transferred chunk to ${path}; ${result.sizeBytes} bytes received so far. Continue at offset ${result.nextOffset}.`;
    const content = [textBlock(summary)];
    logToolCall(config, {
      tool: "transfer_file", workspaceId, path, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      content,
      _meta: {
        tool: "transfer_file",
        card: { workspaceId, path, summary: result },
      },
      structuredContent: { result: summary, path, ...result },
    };
  });

  registerAppTool(server, toolNames.write, {
    title: "Write file",
    description: `Create or completely overwrite a file inside an open workspace. Prefer ${toolNames.edit} for targeted changes to existing files. Call open_workspace first and pass workspaceId.`,
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      path: z.string().describe("File path to write, relative to the workspace root."),
      content: z.string().describe("Complete new file content."),
      expectedVersion: z.string().optional().describe("Expected SHA-256 hash (hex) of the current file content. If provided and the actual file hash differs, the write is rejected to prevent overwriting concurrent changes."),
    },
    outputSchema: resultOutputSchema(),
    ...toolWidgetDescriptorMeta(config, "write"), annotations: WRITE_TOOL_ANNOTATIONS,
  }, async ({ workspaceId, expectedVersion, ...input }) => {
    const startedAt = performance.now();
    const workspace = workspaces.getWorkspace(workspaceId);
    const absolutePath = workspaces.resolvePath(workspace, input.path);
    if (input.content.length > MAX_WRITE_SIZE) {
      throw new Error(`File content exceeds maximum write size of ${MAX_WRITE_SIZE} bytes (${input.content.length} bytes provided).`);
    }
    const previousContent = await readExistingTextFile(absolutePath);
    if (expectedVersion && previousContent !== undefined) {
      const currentHash = createHash("sha256").update(previousContent).digest("hex");
      if (currentHash !== expectedVersion) {
        logEvent(config.logging, "warn", "write_version_mismatch", {
          path: input.path, expectedVersion, actualVersion: currentHash,
        });
        return {
          content: [{ type: "text" as const, text: `Write rejected: file content has changed since last read. Expected version ${expectedVersion.slice(0, 12)}… but actual version is ${currentHash.slice(0, 12)}…. Re-read the file before writing.` }],
          isError: true,
        };
      }
    }
    await safeWriteFile(absolutePath, input.content);
    const changed = previousContent !== input.content;
    const patch = !changed
      ? ""
      : previousContent === undefined
        ? newFilePatch(input.path, input.content)
        : generateUnifiedPatch(input.path, previousContent, input.content);
    const stats = countDiffStats(patch);
    if (changed) {
      workspaceChanges.recordMutation({
        workspaceId,
        workspaceRoot: workspace.root,
        path: input.path,
        kind: previousContent === undefined ? "created" : "modified",
        additions: stats.additions,
        removals: stats.removals,
      });
    }
    const content = [{ type: "text" as const, text: `Wrote ${contentLineCount(input.content)} lines to ${input.path}.` }];
    logToolCall(config, {
      tool: toolNames.write, workspaceId, path: input.path, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      content,
      _meta: {
        tool: toolNames.write,
        card: {
          workspaceId, path: input.path,
          summary: { ...stats, lines: contentLineCount(input.content), characters: input.content.length },
          payload: { content, patch },
        },
      },
      structuredContent: { result: contentText(content) },
    };
  });

  registerAppTool(server, toolNames.edit, {
    title: "Edit file",
    description: `Edit one file inside an open workspace by replacing exact text blocks. Prefer this over ${toolNames.write} for targeted changes. Each oldText must match a unique, non-overlapping region of the original file; merge nearby changes into one edit and keep oldText as small as possible while still unique. Call open_workspace first and pass workspaceId.`,
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      path: z.string().describe("File path to edit, relative to the workspace root."),
      edits: z.array(z.object({
        oldText: z.string().describe("Exact text to replace. Must match uniquely in the original file."),
        newText: z.string().describe("Replacement text."),
      })).min(1),
    },
    outputSchema: resultOutputSchema({ status: z.literal("applied") }),
    ...toolWidgetDescriptorMeta(config, "edit"), annotations: EDIT_TOOL_ANNOTATIONS,
  }, async ({ workspaceId, ...input }) => {
    const startedAt = performance.now();
    const workspace = workspaces.getWorkspace(workspaceId);
    workspaces.resolvePath(workspace, input.path);
    const response = await editFileTool(input, { cwd: workspace.root, root: workspace.root });
    if (response.isError) {
      logFailedToolResponse(config, { tool: toolNames.edit, workspaceId, path: input.path }, response.content, startedAt);
      return response;
    }
    const stats = countDiffStats(response.details?.patch ?? response.details?.diff);
    const content = [textBlock(`Edited ${input.path} (+${stats.additions} -${stats.removals}).`)];
    if (stats.additions > 0 || stats.removals > 0) {
      workspaceChanges.recordMutation({
        workspaceId,
        workspaceRoot: workspace.root,
        path: input.path,
        kind: "modified",
        additions: stats.additions,
        removals: stats.removals,
      });
    }
    logToolCall(config, {
      tool: toolNames.edit, workspaceId, path: input.path, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      content,
      _meta: {
        tool: toolNames.edit,
        card: {
          workspaceId, path: input.path, summary: { ...stats, editCount: input.edits.length },
          payload: { diff: response.details?.diff, patch: response.details?.patch },
        },
      },
      structuredContent: { status: "applied" as const, result: contentText(content) },
    };
  });

  if (config.widgets === "changes") {
    registerAppTool(server, "show_changes", {
      title: "Show changes",
      description: "Show aggregate file changes in an open workspace since the last shown checkpoint or since the workspace was opened. After you create, edit, or overwrite files, call this once when the related file changes are complete so the user can inspect the combined diff.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        since: z.enum(["last_shown", "workspace_open"]).optional().describe("Defaults to last_shown. Use workspace_open to compare against the initial open_workspace checkpoint."),
        markReviewed: z.boolean().optional().describe("Defaults to true. When true, advances the last shown checkpoint to the current workspace state."),
      },
      outputSchema: resultOutputSchema(),
      ...toolWidgetDescriptorMeta(config, "show_changes"), annotations: { readOnlyHint: true },
    }, async ({ workspaceId, since, markReviewed }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      const review = await reviewCheckpoints.reviewChanges({
        workspaceId, root: workspace.root, since: since ?? "last_shown", markReviewed: markReviewed ?? true,
      });
      const content = [textBlock(review.result)];
      logToolCall(config, {
        tool: "show_changes", workspaceId, success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return {
        content,
        _meta: {
          tool: "show_changes",
          card: { workspaceId, summary: review.summary, files: review.files, payload: { patch: review.patch } },
        },
        structuredContent: { result: contentText(content) },
      };
    });
  }

  if (!config.minimalTools) {
    registerSearchTools(server, config, workspaces, toolNames, logToolCall, logFailedToolResponse);
  }

  registerAppTool(server, toolNames.shell, {
    title: config.toolNaming === "short" ? "Bash" : "Run shell",
    description: config.minimalTools
      ? `Run a shell command inside an open workspace. Use for tests, builds, git inspection, package scripts, search, file discovery, and directory inspection. In minimal tool mode, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} are disabled; command-line search tools may be used instead. Prefer ${toolNames.read} for direct file reads and the dedicated edit/write tools for source changes. Shell commands execute with the local user's privileges and can modify files or run programs beyond what path-scoped file tools can do, so this tool requires the privileged auvrynt:process scope. Call open_workspace first and pass workspaceId.`
      : `Run a shell command inside an open workspace for tests, builds, git inspection, package scripts, and commands that genuinely require a shell. Prefer ${toolNames.read}, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} for inspection and the dedicated edit/write tools for source changes. Shell commands execute with the local user's privileges and can modify files or run programs beyond what path-scoped file tools can do, so this tool requires the privileged auvrynt:process scope. Call open_workspace first and pass workspaceId.`,
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      command: z.string().describe(`Shell command to run. This executes with local-user privileges; prefer ${toolNames.edit} or ${toolNames.write} for ordinary source-file changes.`),
      workingDirectory: z.string().optional().describe("Optional working directory relative to the workspace root. Defaults to the workspace root."),
      timeout: z.number().positive().max(300).optional().describe("Timeout in seconds. Defaults to 30, max 300."),
    },
    outputSchema: resultOutputSchema(),
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: SHELL_TOOL_ANNOTATIONS,
  }, async ({ workspaceId, workingDirectory, ...input }) => {
    const startedAt = performance.now();
    const workspace = workspaces.getWorkspace(workspaceId);
    const cwd = workspaces.resolveWorkingDirectory(workspace, workingDirectory);
    const response = await runShellTool(input, { cwd, root: workspace.root });
    if (response.isError) {
      logFailedToolResponse(config, {
        tool: toolNames.shell, workspaceId, workingDirectory: workingDirectory ?? ".",
        command: input.command, commandLength: input.command.length,
      }, response.content, startedAt);
      return response;
    }
    logToolCall(config, {
      tool: toolNames.shell, workspaceId, workingDirectory: workingDirectory ?? ".",
      command: input.command, commandLength: input.command.length, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      ...response,
      _meta: {
        tool: toolNames.shell,
        card: {
          workspaceId, path: workingDirectory,
          summary: { command: input.command, workingDirectory: workingDirectory ?? ".", ...textSummary(response.content) },
          payload: { content: response.content },
        },
      },
      structuredContent: { result: contentText(response.content) },
    };
  });
}

function registerSearchTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  toolNames: CoreFileToolNames,
  logToolCall: LogToolCall,
  logFailedToolResponse: LogFailedToolResponse,
): void {
  registerAppTool(server, toolNames.grep, {
    title: config.toolNaming === "short" ? "Grep" : "Grep files",
    description: "Search file contents inside an open workspace. Use this before broad reads when looking for symbols, text, or usage sites. Respects project ignore rules. Call open_workspace first and pass workspaceId.",
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      pattern: z.string().describe("Search pattern."),
      path: z.string().optional().describe("Optional path or glob scope relative to the workspace root."),
      include: z.string().optional().describe("Optional include glob."),
    },
    outputSchema: resultOutputSchema(),
    ...toolWidgetDescriptorMeta(config, "search"), annotations: { readOnlyHint: true },
  }, async ({ workspaceId, ...input }) => {
    const startedAt = performance.now();
    const workspace = workspaces.getWorkspace(workspaceId);
    if (input.path) workspaces.resolvePath(workspace, input.path);
    const response = await grepFilesTool(input, { cwd: workspace.root, root: workspace.root });
    if (response.isError) {
      logFailedToolResponse(config, { tool: toolNames.grep, workspaceId, path: input.path }, response.content, startedAt);
      return response;
    }
    logToolCall(config, {
      tool: toolNames.grep, workspaceId, path: input.path, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      ...response,
      _meta: {
        tool: toolNames.grep,
        card: {
          workspaceId, path: input.path,
          summary: { pattern: input.pattern, scope: input.path ?? ".", ...textSummary(response.content) },
          payload: { content: response.content },
        },
      },
      structuredContent: { result: contentText(response.content) },
    };
  });

  registerAppTool(server, toolNames.glob, {
    title: config.toolNaming === "short" ? "Glob" : "Find files",
    description: "Find files by glob pattern inside an open workspace. Use this to discover filenames or narrow file sets before reading. Respects project ignore rules. Call open_workspace first and pass workspaceId.",
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      pattern: z.string().describe("File glob pattern."),
      path: z.string().optional().describe("Optional path scope relative to the workspace root."),
    },
    outputSchema: resultOutputSchema(),
    ...toolWidgetDescriptorMeta(config, "search"), annotations: { readOnlyHint: true },
  }, async ({ workspaceId, ...input }) => {
    const startedAt = performance.now();
    const workspace = workspaces.getWorkspace(workspaceId);
    if (input.path) workspaces.resolvePath(workspace, input.path);
    const response = await findFilesTool(input, { cwd: workspace.root, root: workspace.root });
    if (response.isError) {
      logFailedToolResponse(config, { tool: toolNames.glob, workspaceId, path: input.path }, response.content, startedAt);
      return response;
    }
    logToolCall(config, {
      tool: toolNames.glob, workspaceId, path: input.path, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      ...response,
      _meta: {
        tool: toolNames.glob,
        card: {
          workspaceId, path: input.path,
          summary: { pattern: input.pattern, scope: input.path ?? ".", ...textSummary(response.content) },
          payload: { content: response.content },
        },
      },
      structuredContent: { result: contentText(response.content) },
    };
  });

  registerAppTool(server, toolNames.ls, {
    title: config.toolNaming === "short" ? "Ls" : "List directory",
    description: "List a directory inside an open workspace. Use this for directory inspection before reading files. Call open_workspace first and pass workspaceId.",
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      path: z.string().describe("Directory path to list, relative to the workspace root."),
    },
    outputSchema: resultOutputSchema(),
    ...toolWidgetDescriptorMeta(config, "directory"), annotations: { readOnlyHint: true },
  }, async ({ workspaceId, ...input }) => {
    const startedAt = performance.now();
    const workspace = workspaces.getWorkspace(workspaceId);
    workspaces.resolvePath(workspace, input.path);
    const response = await listDirectoryTool(input, { cwd: workspace.root, root: workspace.root });
    if (response.isError) {
      logFailedToolResponse(config, { tool: toolNames.ls, workspaceId, path: input.path }, response.content, startedAt);
      return response;
    }
    logToolCall(config, {
      tool: toolNames.ls, workspaceId, path: input.path, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      ...response,
      _meta: {
        tool: toolNames.ls,
        card: { workspaceId, path: input.path, summary: textSummary(response.content), payload: { content: response.content } },
      },
      structuredContent: { result: contentText(response.content) },
    };
  });
}
