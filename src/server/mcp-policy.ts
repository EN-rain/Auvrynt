import type { AuvryntScope, ServerConfig } from "../config.js";

const PLAYWRIGHT_TOOL_NAMES = new Set([
  "capture_page_screenshot",
  "inspect_page",
  "test_responsive_page",
  "browser_open",
  "browser_close",
  "browser_list_sessions",
  "browser_navigate",
  "browser_reload",
  "browser_go_back",
  "browser_go_forward",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_select_option",
  "browser_hover",
  "browser_press_key",
  "browser_wait_for",
  "browser_get_text",
  "browser_get_attribute",
  "browser_is_visible",
  "browser_scroll",
  "browser_console",
  "browser_network",
  "browser_evaluate",
  "browser_screenshot",
  "agent_reach_status",
  "agent_reach_doctor",
  "agent_reach_guide",
]);
const GENERIC_GODOT_TOOL_NAMES = new Set(["detect_godot_project", "inspect_godot_scene"]);
const GODOT_CSHARP_TOOL_MARKERS = ["dotnet", "csharp", "build_solutions", "generate_vscode_config"];
const GODOT_GDSCRIPT_ONLY_TOOLS = new Set([
  "godot_get_global_classes",
  "godot_add_class_name",
  "godot_remove_class_name",
  "godot_get_autoload_usage",
  "godot_inspect_tool_script",
  "godot_create_editor_plugin",
]);

/** Dashboard / inventory family for Godot tools. Shared tools count under both profile keys. */
export type GodotToolFamily = "godotCsharp" | "godotGdscript" | "godotShared";

export function isGodotToolName(name: string): boolean {
  return name.startsWith("godot_") || GENERIC_GODOT_TOOL_NAMES.has(name);
}

export function godotToolFamily(name: string): GodotToolFamily | undefined {
  if (!isGodotToolName(name)) return undefined;
  if (GODOT_CSHARP_TOOL_MARKERS.some((marker) => name.includes(marker))) return "godotCsharp";
  if (name.includes("gdscript") || GODOT_GDSCRIPT_ONLY_TOOLS.has(name)) return "godotGdscript";
  return "godotShared";
}

export function godotToolBelongsToIntegration(name: string, integration: "godotCsharp" | "godotGdscript"): boolean {
  const family = godotToolFamily(name);
  if (!family) return false;
  return family === integration || family === "godotShared";
}

export function requiredScopesForToolName(name: string): AuvryntScope[] {
  if (name === "open_workspace") return ["auvrynt:read", "auvrynt:write"];
  if (name === "aseprite_capture_current") return ["auvrynt:aseprite", "auvrynt:process", "auvrynt:write"];
  if (name === "aseprite_capture_canvas") return ["auvrynt:aseprite", "auvrynt:write"];
  if (name === "close_workspace") return ["auvrynt:write", "auvrynt:process"];
  if (name === "blender_execute_python") return ["auvrynt:blender", "auvrynt:blender-python"];
  if (name.startsWith("blender_")) return ["auvrynt:blender"];
  if (name.startsWith("aseprite_")) return ["auvrynt:aseprite"];
  if (name.startsWith("godot_") || GENERIC_GODOT_TOOL_NAMES.has(name)) return ["auvrynt:godot"];
  if (name.startsWith("serena_")) return ["auvrynt:serena"];
  if (name.startsWith("roblox_")) return ["auvrynt:roblox"];
  if (name.startsWith("context7_")) return ["auvrynt:read"];
  if (name === "agent_reach_doctor") return ["auvrynt:web", "auvrynt:process"];
  if (name.startsWith("agent_reach_")) return ["auvrynt:web"];
  if (name === "obsidian_write_note") return ["auvrynt:write"];
  if (name.startsWith("obsidian_")) return ["auvrynt:read"];
  if (name === "start_dev_server") return ["auvrynt:web", "auvrynt:process"];
  if (
    name === "capture_page_screenshot"
    || name === "test_responsive_page"
    || name === "browser_screenshot"
  ) return ["auvrynt:web", "auvrynt:write"];
  if (
    name === "inspect_page"
    || name.startsWith("browser_")
  ) return ["auvrynt:web"];
  if (name === "capture_window") return ["auvrynt:process", "auvrynt:write"];
  if (name === "split_sprite_sheet") return ["auvrynt:write"];
  if (name === "inspect_dotnet_project") return ["auvrynt:software"];
  if (["dotnet_restore", "dotnet_build", "dotnet_test", "dotnet_run", "dotnet_format"].includes(name)) {
    return ["auvrynt:software", "auvrynt:process"];
  }
  if (["start_process", "get_process_logs", "list_processes", "stop_process", "run_shell", "bash"].includes(name)) {
    return ["auvrynt:process"];
  }
  if (["write", "write_file", "edit", "edit_file"].includes(name)) return ["auvrynt:write"];
  return ["auvrynt:read"];
}

export function requiredScopesForToolCall(name: string, input: unknown): AuvryntScope[] {
  const required = new Set<AuvryntScope>(requiredScopesForToolName(name));
  if (name === "open_workspace" && input && typeof input === "object") {
    if ((input as { mode?: unknown }).mode === "worktree") required.add("auvrynt:process");
  }
  if (name === "compare_images" && input && typeof input === "object" && "diffOutputPath" in input) {
    if (typeof (input as { diffOutputPath?: unknown }).diffOutputPath === "string") required.add("auvrynt:write");
  }
  if (name === "dotnet_format" && input && typeof input === "object") {
    if ((input as { verifyOnly?: unknown }).verifyOnly !== true) required.add("auvrynt:write");
  }
  if (name === "aseprite_recovery" && input && typeof input === "object") {
    const action = (input as { action?: unknown }).action;
    if (action === "open_recovery_ui") required.add("auvrynt:process");
    if (action === "archive") required.add("auvrynt:write");
  }
  return Array.from(required);
}

export function hasRequiredScopes(scopes: Iterable<string>, required: readonly string[]): boolean {
  const available = scopes instanceof Set ? scopes : new Set(scopes);
  return required.every((scope) => available.has(scope));
}

function godotIntegrationEnabled(config: ServerConfig, toolName: string): boolean {
  const family = godotToolFamily(toolName);
  if (family === "godotCsharp") return config.integrations.godotCsharp;
  if (family === "godotGdscript") return config.integrations.godotGdscript;
  return config.integrations.godotGdscript || config.integrations.godotCsharp;
}

export function toolIntegrationEnabled(config: ServerConfig, name: string): boolean {
  if (config.toolToggles?.[name] === false) return false;
  if (name.startsWith("blender_")) return config.integrations.blender;
  if (name.startsWith("aseprite_")) return config.integrations.aseprite;
  if (isGodotToolName(name)) return godotIntegrationEnabled(config, name);
  if (PLAYWRIGHT_TOOL_NAMES.has(name) || name.startsWith("agent_reach_")) return config.integrations.playwright;
  if (name.startsWith("serena_")) return config.integrations.serena && config.serena.enabled;
  if (name.startsWith("context7_")) return config.integrations.context7;
  if (name.startsWith("obsidian_")) return config.integrations.obsidian;
  if (name.startsWith("roblox_")) return config.integrations.roblox;
  return true;
}
