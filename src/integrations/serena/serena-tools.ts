import * as z from "zod/v4";
import { registerAppTool } from "../../server/mcp-tool-registrar.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "../../config.js";
import { SerenaManager } from "./serena-manager.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { logEvent } from "../../logger.js";

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MUTATING_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

type ToolContent = { type: "text"; text: string };

function textBlock(text: string): ToolContent {
  return { type: "text" as const, text };
}

function toolMeta(): { _meta: Record<string, never> } {
  return { _meta: {} };
}

function registerSerenaHealthTools(
  server: McpServer,
  config: ServerConfig,
  serenaManager: SerenaManager,
  workspaces: WorkspaceRegistry,
): void {
  registerAppTool(
    server,
    "serena_environment",
    {
      title: "Serena environment",
      description: "Detect and report the local Serena installation status, version, backend, and any issues. Does not start a session.",
      inputSchema: {},
      ...toolMeta(),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const env = await serenaManager.getEnvironment();
        return { content: [textBlock(JSON.stringify(env, null, 2))] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [textBlock(`serena_environment failed: ${msg}`)], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "serena_start_session",
    {
      title: "Start Serena session",
      description: "Start a Serena MCP session for the active workspace. Enables serena_ tools for semantic code analysis. Requires an active workspace. Starts Serena as a child process with stdio transport.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        projectRelativePath: z.string().optional().describe("Optional project subdirectory relative to workspace root."),
      },
      ...toolMeta(),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, projectRelativePath }) => {
      try {
        const workspace = workspaces.getWorkspace(workspaceId);
        const projectRoot = projectRelativePath
          ? workspaces.resolvePath(workspace, projectRelativePath)
          : workspace.root;
        const session = await serenaManager.startSession(
          workspaceId,
          projectRoot,
        );
        return {
          content: [textBlock(JSON.stringify({
            sessionId: session.sessionId,
            workspaceId: session.workspaceId,
            projectRoot: session.projectRoot,
            status: session.status,
            toolCount: session.exposedTools.length,
            tools: session.exposedTools,
          }, null, 2))],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [textBlock(`serena_start_session failed: ${msg}`)], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "serena_session_status",
    {
      title: "Serena session status",
      description: "Check the status of the current Serena session for a workspace. Returns session info or indicates no active session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      },
      ...toolMeta(),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId }) => {
      try {
        const session = serenaManager.getSessionByWorkspace(workspaceId);
        if (!session) {
          return { content: [textBlock(JSON.stringify({ active: false, message: "No active Serena session for this workspace." }, null, 2))] };
        }
        return {
          content: [textBlock(JSON.stringify({
            active: true,
            sessionId: session.sessionId,
            projectRoot: session.projectRoot,
            status: session.status,
            toolCount: session.exposedTools.length,
            tools: session.exposedTools,
            activatedProject: session.activatedProject,
            uptimeMs: Date.now() - session.createdAt,
          }, null, 2))],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [textBlock(`serena_session_status failed: ${msg}`)], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "serena_stop_session",
    {
      title: "Stop Serena session",
      description: "Stop the active Serena session for a workspace. Cleans up the child process and releases resources.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      },
      ...toolMeta(),
      annotations: MUTATING_ANNOTATIONS,
    },
    async ({ workspaceId }) => {
      try {
        await serenaManager.stopWorkspaceSessions(workspaceId);
        return { content: [textBlock(JSON.stringify({ stopped: true, workspaceId }))] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [textBlock(`serena_stop_session failed: ${msg}`)], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "serena_restart_session",
    {
      title: "Restart Serena session",
      description: "Restart the Serena session for a workspace. Stops any existing session and starts a new one.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        projectRelativePath: z.string().optional().describe("Optional project subdirectory relative to workspace root."),
      },
      ...toolMeta(),
      annotations: MUTATING_ANNOTATIONS,
    },
    async ({ workspaceId, projectRelativePath }) => {
      try {
        const workspace = workspaces.getWorkspace(workspaceId);
        const projectRoot = projectRelativePath
          ? workspaces.resolvePath(workspace, projectRelativePath)
          : workspace.root;
        await serenaManager.stopWorkspaceSessions(workspaceId);
        const session = await serenaManager.startSession(
          workspaceId,
          projectRoot,
        );
        return {
          content: [textBlock(JSON.stringify({
            sessionId: session.sessionId,
            status: session.status,
            toolCount: session.exposedTools.length,
          }, null, 2))],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [textBlock(`serena_restart_session failed: ${msg}`)], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "serena_list_sessions",
    {
      title: "List Serena sessions",
      description: "List all active Serena sessions across all workspaces.",
      inputSchema: {},
      ...toolMeta(),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const sessions = serenaManager.getSessionInfo();
        return { content: [textBlock(JSON.stringify({ count: sessions.length, sessions }, null, 2))] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [textBlock(`serena_list_sessions failed: ${msg}`)], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "serena_health_check",
    {
      title: "Serena health check",
      description: "Ping the Serena child process and verify the session is healthy, initialized, and has an active project.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      },
      ...toolMeta(),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId }) => {
      try {
        const health = await serenaManager.healthCheck(workspaceId);
        return { content: [textBlock(JSON.stringify(health, null, 2))] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [textBlock(`serena_health_check failed: ${msg}`)], isError: true };
      }
    },
  );
}

function registerSerenaSemanticTools(
  server: McpServer,
  config: ServerConfig,
  serenaManager: SerenaManager,
  workspaces: WorkspaceRegistry,
): void {
  const semanticReadTools: Array<{
    name: string;
    serenaName: string;
    description: string;
    inputSchema: Record<string, any>;
  }> = [
    {
      name: "serena_find_symbol",
      serenaName: "find_symbol",
      description: "Find symbols by Serena name-path pattern. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        query: z.string().describe("Symbol name or Serena name-path pattern to search for."),
        filePath: z.string().optional().describe("Optional workspace-relative file or directory that restricts the search."),
        includeBody: z.boolean().optional().describe("Include the symbol source body."),
        includeInfo: z.boolean().optional().describe("Include hover-like signature/doc information."),
        maxResults: z.number().int().min(1).max(100).optional().describe("Maximum symbol matches."),
      },
    },
    {
      name: "serena_find_referencing_symbols",
      serenaName: "find_referencing_symbols",
      description: "Find references to an exact Serena name path in a known source file. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        query: z.string().describe("Exact Serena name path of the symbol to find references for."),
        filePath: z.string().describe("Workspace-relative file containing the symbol."),
        maxChars: z.number().int().min(1).max(500_000).optional().describe("Maximum backend answer size in characters."),
      },
    },
    {
      name: "serena_get_symbols_overview",
      serenaName: "get_symbols_overview",
      description: "Get an overview of symbols in a source file. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        filePath: z.string().describe("Workspace-relative path to the file."),
        depth: z.number().int().min(-1).max(10).optional().describe("Descendant depth for the symbol overview."),
        maxChars: z.number().int().min(1).max(500_000).optional().describe("Maximum backend answer size in characters."),
      },
    },
    {
      name: "serena_search_for_pattern",
      serenaName: "search_for_pattern",
      description: "Search project files with Serena's regex search. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        pattern: z.string().describe("Regex pattern to search for."),
        path: z.string().optional().describe("Optional workspace-relative file or subdirectory to search."),
        filePattern: z.string().optional().describe("Optional project-relative include glob (e.g. 'src/**/*.ts')."),
        contextLinesBefore: z.number().int().min(0).max(20).optional(),
        contextLinesAfter: z.number().int().min(0).max(20).optional(),
        codeOnly: z.boolean().optional().describe("Restrict the search to files Serena recognizes as code."),
        maxChars: z.number().int().min(1).max(500_000).optional().describe("Maximum backend answer size in characters."),
      },
    },
    {
      name: "serena_find_implementations",
      serenaName: "find_implementations",
      description: "Find implementations of an exact Serena name path in a known source file. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        query: z.string().describe("Exact Serena name path to find implementations for."),
        filePath: z.string().describe("Workspace-relative file containing the symbol."),
        includeInfo: z.boolean().optional().describe("Include hover-like signature/doc information for implementations."),
        maxChars: z.number().int().min(1).max(500_000).optional().describe("Maximum backend answer size in characters."),
      },
    },
    {
      name: "serena_find_declaration",
      serenaName: "find_declaration",
      description: "Resolve the declaration for one captured symbol usage in a known file. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        filePath: z.string().describe("Workspace-relative source file containing the symbol usage."),
        regex: z.string().describe("Regex with exactly one capture group identifying the symbol usage whose declaration should be resolved."),
        containingSymbol: z.string().optional().describe("Optional containing Serena name path to restrict the lookup."),
        includeBody: z.boolean().optional(),
        includeInfo: z.boolean().optional(),
      },
    },
    {
      name: "serena_get_diagnostics_for_file",
      serenaName: "get_diagnostics_for_file",
      description: "Get language-server diagnostics for a source file. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        filePath: z.string().describe("Workspace-relative path to the file."),
        startLine: z.number().int().min(0).optional(),
        endLine: z.number().int().min(-1).optional(),
        minSeverity: z.number().int().min(1).max(4).optional().describe("LSP severity threshold: 1=error through 4=hint."),
        maxChars: z.number().int().min(1).max(500_000).optional().describe("Maximum backend answer size in characters."),
      },
    },
    {
      name: "serena_read_memory",
      serenaName: "read_memory",
      description: "Read a Serena memory entry by name. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        name: z.string().describe("Memory name to read."),
      },
    },
    {
      name: "serena_list_memories",
      serenaName: "list_memories",
      description: "List Serena memory entries. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        topic: z.string().optional().describe("Optional memory topic filter supported by Serena 1.6+."),
      },
    },
    {
      name: "serena_onboarding",
      serenaName: "onboarding",
      description: "Get Serena's onboarding status and project setup guidance. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      },
    },
  ];

  const mutationTools: Array<{
    name: string;
    serenaName: string;
    description: string;
    inputSchema: Record<string, any>;
  }> = [
    {
      name: "serena_replace_symbol_body",
      serenaName: "replace_symbol_body",
      description: "Replace the body of a named symbol (function, class, method) while preserving its signature. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        symbol: z.string().describe("Exact Serena name path of the symbol to replace."),
        newBody: z.string().describe("New body content for the symbol."),
        filePath: z.string().describe("Workspace-relative file containing the symbol."),
      },
    },
    {
      name: "serena_insert_before_symbol",
      serenaName: "insert_before_symbol",
      description: "Insert code before a named symbol's definition. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        symbol: z.string().describe("Exact Serena name path to insert before."),
        content: z.string().describe("Code content to insert."),
        filePath: z.string().describe("Workspace-relative file containing the symbol."),
      },
    },
    {
      name: "serena_insert_after_symbol",
      serenaName: "insert_after_symbol",
      description: "Insert code after a named symbol's definition. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        symbol: z.string().describe("Exact Serena name path to insert after."),
        content: z.string().describe("Code content to insert."),
        filePath: z.string().describe("Workspace-relative file containing the symbol."),
      },
    },
    {
      name: "serena_rename_symbol",
      serenaName: "rename_symbol",
      description: "Rename a symbol across the entire project. Updates all references. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        symbol: z.string().describe("Exact Serena name path of the symbol to rename."),
        newName: z.string().describe("New symbol name."),
        filePath: z.string().describe("Workspace-relative file containing the symbol."),
      },
    },
    {
      name: "serena_safe_delete_symbol",
      serenaName: "safe_delete_symbol",
      description: "Delete a symbol with safety checks. Only deletes if it has no external references. Requires an active Serena session.",
      inputSchema: {
        workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
        symbol: z.string().describe("Serena name-path pattern of the symbol to delete."),
        filePath: z.string().describe("Workspace-relative file containing the symbol."),
      },
    },
  ];

  for (const toolDef of semanticReadTools) {
    registerAppTool(
      server,
      toolDef.name,
      {
        title: toolDef.name,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
        ...toolMeta(),
        annotations: READ_ONLY_ANNOTATIONS,
      },
      async (input: Record<string, unknown>) => {
        const { workspaceId, ...rest } = input as { workspaceId: string; [key: string]: unknown };
        const startedAt = performance.now();
        try {
          const workspace = workspaces.getWorkspace(workspaceId);
          const result = await serenaManager.callTool(
            workspaceId,
            toolDef.serenaName,
            rest,
            workspace.root,
          );
          logEvent(config.logging, "info", "tool_call", {
            tool: toolDef.name,
            workspaceId,
            success: true,
            durationMs: Math.round(performance.now() - startedAt),
          });
          return { content: [textBlock(JSON.stringify(result, null, 2))] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logEvent(config.logging, "warn", "tool_call", {
            tool: toolDef.name,
            workspaceId,
            success: false,
            durationMs: Math.round(performance.now() - startedAt),
            error: msg,
          });
          return { content: [textBlock(`${toolDef.name} failed: ${msg}`)], isError: true };
        }
      },
    );
  }

  for (const toolDef of mutationTools) {
    registerAppTool(
      server,
      toolDef.name,
      {
        title: toolDef.name,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
        ...toolMeta(),
        annotations: MUTATING_ANNOTATIONS,
      },
      async (input: Record<string, unknown>) => {
        const { workspaceId, ...rest } = input as { workspaceId: string; [key: string]: unknown };
        const startedAt = performance.now();
        try {
          const workspace = workspaces.getWorkspace(workspaceId);
          const result = await serenaManager.callTool(
            workspaceId,
            toolDef.serenaName,
            rest,
            workspace.root,
          );
          logEvent(config.logging, "info", "tool_call", {
            tool: toolDef.name,
            workspaceId,
            success: true,
            durationMs: Math.round(performance.now() - startedAt),
          });
          return { content: [textBlock(JSON.stringify(result, null, 2))] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logEvent(config.logging, "warn", "tool_call", {
            tool: toolDef.name,
            workspaceId,
            success: false,
            durationMs: Math.round(performance.now() - startedAt),
            error: msg,
          });
          return { content: [textBlock(`${toolDef.name} failed: ${msg}`)], isError: true };
        }
      },
    );
  }
}

export function registerSerenaTools(
  server: McpServer,
  config: ServerConfig,
  serenaManager: SerenaManager,
  workspaces: WorkspaceRegistry,
): void {
  registerSerenaHealthTools(server, config, serenaManager, workspaces);
  registerSerenaSemanticTools(server, config, serenaManager, workspaces);
}

