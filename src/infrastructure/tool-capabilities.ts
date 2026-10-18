import {
  isGodotToolName,
  requiredScopesForToolName,
} from "../server/mcp-policy.js";

export type ToolAccess = "read" | "write" | "process" | "web-read" | "web-write";

const SERENA_MUTATION_TOOL_NAMES = new Set([
  "serena_replace_symbol_body",
  "serena_insert_before_symbol",
  "serena_insert_after_symbol",
  "serena_rename_symbol",
  "serena_safe_delete_symbol",
]);
const SERENA_PROCESS_TOOL_NAMES = new Set([
  "serena_start_session",
  "serena_stop_session",
  "serena_restart_session",
]);

export interface ToolCapability {
  name: string;
  access: ToolAccess;
  scopes: string[];
  integration: string | undefined;
  requiresWorkspace: boolean;
}

export function toolAccessForName(name: string): ToolAccess {
  if (name.startsWith("blender_")) return "write";
  if (name.startsWith("aseprite_")) return "write";
  if (name === "detect_godot_project" || name === "inspect_godot_scene") return "read";
  if (isGodotToolName(name)) return "write";
  if (SERENA_MUTATION_TOOL_NAMES.has(name)) return "write";
  if (SERENA_PROCESS_TOOL_NAMES.has(name)) return "process";
  if (name.startsWith("serena_")) return "read";
  if (name.startsWith("roblox_")) return "write";
  if (name === "openpencil_status") return "read";
  if (name === "openpencil_list_tools") return "process";
  if (name.startsWith("openpencil_")) return "write";
  if (name.startsWith("desktop_") || name.startsWith("krita_")) {
    const scopes = requiredScopesForToolName(name);
    if (scopes.includes("auvrynt:write")) return "write";
    if (scopes.includes("auvrynt:process")) return "process";
    return "read";
  }
  if (name === "start_dev_server") return "web-write";
  if (["capture_page_screenshot", "test_responsive_page", "browser_screenshot"].includes(name)) return "web-write";
  if (name === "inspect_page" || name.startsWith("browser_")) return "web-read";
  if (name === "agent_reach_status" || name === "agent_reach_doctor") return "process";
  if (name.startsWith("agent_reach_")) return "read";
  if (["write", "write_file", "edit", "edit_file", "split_sprite_sheet", "capture_window", "compare_images"].includes(name)) return "write";
  if (name === "open_workspace") return "read";

  const scopes = requiredScopesForToolName(name);
  if (scopes.includes("auvrynt:process")) return "process";
  if (scopes.includes("auvrynt:write")) return "write";
  if (scopes.includes("auvrynt:web")) return "web-read";
  return "read";
}

export function integrationForTool(name: string): string | undefined {
  if (name.startsWith("blender_")) return "blender";
  if (name.startsWith("aseprite_")) return "aseprite";
  if (isGodotToolName(name)) return "godot";
  if (name.startsWith("serena_")) return "serena";
  if (name.startsWith("desktop_")) return "desktop";
  if (name.startsWith("krita_")) return "krita";
  if (name.startsWith("roblox_")) return "roblox";
  if (name.startsWith("openpencil_")) return "openPencil";
  if (
    name.startsWith("browser_")
    || ["capture_page_screenshot", "inspect_page", "test_responsive_page"].includes(name)
  ) return "playwright";
  if (name.startsWith("agent_reach_")) return "agentReach";
  if (name.startsWith("dotnet_") || name === "inspect_dotnet_project") return "software";
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
  return requiredScopesForToolName(name);
}
