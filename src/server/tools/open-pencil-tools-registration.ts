import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import {
  callOpenPencilTool, listOpenPencilTools, openPencilStatus,
} from "../../integrations/open-pencil/open-pencil-client.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS, READ_ONLY_ANNOTATIONS, WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

function asText(result: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError };
}

function errorResult(error: unknown) {
  return asText({ error: error instanceof Error ? error.message : String(error) }, true);
}

export function registerOpenPencilTools(
  server: McpServer, config: ServerConfig, workspaces: WorkspaceRegistry,
): void {
  registerAppTool(server, "openpencil_status", {
    title: "OpenPencil desktop and MCP status",
    description: "Detect the installed/running OpenPencil desktop editor and the official managed MCP package. Never installs or launches the app.",
    inputSchema: {},
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => {
    try { return asText(await openPencilStatus()); }
    catch (error) { return errorResult(error); }
  });

  registerAppTool(server, "openpencil_list_tools", {
    title: "List OpenPencil MCP tools",
    description: "Connect to the running OpenPencil desktop app through the official MCP stdio package and return remote names, descriptions, and exact input schemas. Requires an open document.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      query: z.string().max(80).optional().describe("Filter names and descriptions."),
      offset: z.number().int().min(0).max(1000).optional(),
      limit: z.number().int().min(1).max(50).optional().describe("Page size; defaults to 20."),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, query, offset, limit }) => {
    try { return asText(await listOpenPencilTools(workspaces.getWorkspace(workspaceId).root, { query, offset, limit })); }
    catch (error) { return errorResult(error); }
  });

  registerAppTool(server, "openpencil_call", {
    title: "Call official OpenPencil MCP tool",
    description: "Call a tool by its exact name from openpencil_list_tools. May modify the active design or write files; use the explicit document_id/page_id when appropriate. File operations are limited to the selected Auvrynt workspace root.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      tool: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
      arguments: z.record(z.string(), z.unknown()).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, tool, arguments: args }) => {
    try {
      return asText(await callOpenPencilTool(workspaces.getWorkspace(workspaceId).root, tool, args ?? {}));
    } catch (error) {
      return errorResult(error);
    }
  });
}
