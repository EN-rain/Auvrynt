import { requiredScopesForToolName } from "../server/mcp-policy.js";

export type ToolAccess = "read" | "write" | "process" | "web-read" | "web-write";

export interface ToolCapability {
  name: string;
  access: ToolAccess;
  scopes: string[];
  integration: string | undefined;
  requiresWorkspace: boolean;
}

export function toolAccessForName(name: string): ToolAccess {
  if (name.startsWith("blender_")) return "write";
  if (name.startsWith("godot_")) return "write";
  if (name.startsWith("serena_")) return "write";
  if (name === "start_process" || name === "stop_process" || name === "bash" || name === "run_shell") return "process";
  if (name.startsWith("dotnet_") && (name.includes("build") || name.includes("test") || name.includes("run") || name.includes("restore") || name.includes("format"))) return "process";
  if (name === "start_dev_server") return "web-write";
  if (name === "capture_page_screenshot" || name === "test_responsive_page") return "web-write";
  if (name === "inspect_page") return "web-read";
  if (name === "agent_reach_doctor") return "process";
  if (name.startsWith("agent_reach_")) return "read";
  if (["write", "write_file", "edit", "edit_file", "split_sprite_sheet", "capture_window", "compare_images"].includes(name)) return "write";
  if (name === "open_workspace" || name === "close_workspace") return "write";
  if (name === "start_blender" || name === "get_connection_status" || name === "get_process_logs" || name === "list_processes" || name === "inspect_dotnet_project") return "read";
  return "read";
}

export function integrationForTool(name: string): string | undefined {
  if (name.startsWith("blender_")) return "blender";
  if (name.startsWith("godot_")) return "godot";
  if (name.startsWith("serena_")) return "serena";
  if (name === "capture_page_screenshot" || name === "inspect_page" || name === "test_responsive_page") return "playwright";
  if (name.startsWith("agent_reach_")) return "agent-reach";
  return undefined;
}

export const TOOL_CAPABILITIES = new Map<string, ToolCapability>();

export function registerToolCapability(name: string): void {
  if (TOOL_CAPABILITIES.has(name)) return;
  const caps: ToolCapability = {
    name,
    access: toolAccessForName(name),
    scopes: [], // populated dynamically
    integration: integrationForTool(name),
    requiresWorkspace: name !== "open_workspace",
  };
  TOOL_CAPABILITIES.set(name, caps);
}

export function updateToolScopes(): void {
  for (const [name, caps] of TOOL_CAPABILITIES) {
    caps.scopes = requiredScopesForName(name);
  }
}

function requiredScopesForName(name: string): string[] {
  const scopes = requiredScopesForToolName(name);
  return name === "open_workspace"
    ? Array.from(new Set([...scopes, "auvrynt:process"]))
    : scopes;
}
