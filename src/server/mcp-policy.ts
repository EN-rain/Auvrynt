import type { AuvryntScope, ServerConfig } from "../config.js";
import { detectPlatform } from "../integrations/agent-reach/native-channels.js";

const AUVRYNT_TOOL_NAMESPACE = "auvrynt.";

/**
 * Accept the qualified tool identifiers emitted by older/reconnecting hosts,
 * while keeping the canonical MCP inventory names unqualified.
 */
export function normalizeMcpToolName(name: string): string {
  return name.startsWith(AUVRYNT_TOOL_NAMESPACE)
    ? name.slice(AUVRYNT_TOOL_NAMESPACE.length)
    : name;
}

/**
 * Normalize a stale qualified tool identifier before MCP SDK dispatch. The
 * public tools/list inventory remains canonical and unqualified.
 */
export function normalizeMcpToolCallBody(body: unknown): unknown {
  const normalizeMessage = (message: unknown): unknown => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return message;
    const record = message as Record<string, unknown>;
    if (record.method !== "tools/call" || !record.params || typeof record.params !== "object" || Array.isArray(record.params)) {
      return message;
    }
    const params = record.params as Record<string, unknown>;
    if (typeof params.name !== "string") return message;
    const normalizedName = normalizeMcpToolName(params.name);
    if (normalizedName === params.name) return message;
    return { ...record, params: { ...params, name: normalizedName } };
  };

  return Array.isArray(body) ? body.map(normalizeMessage) : normalizeMessage(body);
}

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
]);
const GENERIC_GODOT_TOOL_NAMES = new Set([
  "detect_godot_project",
  "inspect_godot_scene",
  "inspect_godot_dotnet_project",
]);
const GODOT_CSHARP_TOOL_MARKERS = ["dotnet", "csharp", "build_solutions", "generate_vscode_config"];
const GODOT_GDSCRIPT_ONLY_TOOLS = new Set([
  "godot_get_global_classes",
  "godot_add_class_name",
  "godot_remove_class_name",
  "godot_get_autoload_usage",
  "godot_inspect_tool_script",
  "godot_create_editor_plugin",
]);
const CORE_READ_TOOL_NAMES = new Set([
  "read",
  "read_file",
  "view_image",
  "show_changes",
  "grep",
  "grep_files",
  "glob",
  "find_files",
  "ls",
  "list_directory",
  "get_connection_status",
  "glob_files",
  "search_text",
  "inspect_project",
  "inspect_image",
  "compare_images",
  "inspect_sprite",
  "recovery_status",
]);
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
const AGENT_REACH_TOOL_NAMES = new Set([
  "agent_reach_status",
  "agent_reach_doctor",
  "agent_reach_guide",
  "agent_reach_read",
  "agent_reach_search",
]);
const AGENT_REACH_READ_PROCESS_PLATFORMS = new Set([
  "youtube",
  "reddit",
  "twitter",
  "xiaohongshu",
  "facebook",
  "instagram",
]);
const AGENT_REACH_SEARCH_PROCESS_PLATFORMS = new Set([
  "exa",
  "github",
  "youtube",
  "reddit",
  "twitter",
  "xiaohongshu",
  "facebook",
  "instagram",
]);
const KRITA_READ_TOOL_NAMES = new Set([
  "krita_web_agent_signal",
  "krita_get_state",
  "krita_list_actions",
  "krita_search_actions",
]);
const KRITA_LOCAL_READ_TOOL_NAMES = new Set([
  "krita_get_calibration",
  "krita_get_shortcuts",
]);
const KRITA_LIVE_READ_TOOL_NAMES = new Set([
  "krita_status",
  "krita_get_canvas_info",
  "krita_get_canvas",
  "krita_check_calibration",
]);
const KRITA_AUTOMATIC_CALIBRATION_TOOL_NAMES = new Set([
  "krita_auto_calibrate_canvas",
]);
const KRITA_LOCAL_WRITE_TOOL_NAMES = new Set([
  "krita_calibrate_canvas",
  "krita_clear_calibration",
  "krita_confirm_calibration",
  "krita_set_shortcut",
  "krita_reset_shortcut",
  "krita_confirm_shortcuts",
  "krita_unvalidate_shortcuts",
  "krita_set_expected_state",
  "krita_mark_state_unknown",
  "krita_confirm_state",
  "krita_reset_expected_state",
]);
const DESKTOP_READ_TOOL_NAMES = new Set([
  "desktop_list_displays",
  "desktop_capture",
  "desktop_stream_frame",
]);
const DESKTOP_PROCESS_TOOL_NAMES = new Set([
  "desktop_stream_start",
  "desktop_stream_stop",
]);
const CODEX_READ_TOOL_NAMES = new Set([
  "codex_status",
  "codex_list_agents",
  "codex_monitor_run",
  "codex_read_events",
  "codex_get_result",
  "codex_pending_approvals",
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
  const normalizedName = normalizeMcpToolName(name);
  if (normalizedName !== name) return requiredScopesForToolName(normalizedName);
  if (name === "open_workspace") return ["auvrynt:read"];
  if (name === "arbiter_decide") return ["auvrynt:read"];
  if (name === "recovery_reconcile") return ["auvrynt:write"];
  if (name === "aseprite_capture_current") return ["auvrynt:aseprite", "auvrynt:process", "auvrynt:write"];
  if (name === "aseprite_capture_canvas") return ["auvrynt:aseprite", "auvrynt:write"];
  if (name === "close_workspace") return ["auvrynt:write", "auvrynt:process"];
  if (name === "blender_execute_python") return ["auvrynt:blender", "auvrynt:blender-python"];
  if (name.startsWith("blender_")) return ["auvrynt:blender"];
  if (name.startsWith("aseprite_")) return ["auvrynt:aseprite"];
  if (name.startsWith("godot_") || GENERIC_GODOT_TOOL_NAMES.has(name)) return ["auvrynt:godot"];
  if (SERENA_MUTATION_TOOL_NAMES.has(name)) return ["auvrynt:serena", "auvrynt:write"];
  if (SERENA_PROCESS_TOOL_NAMES.has(name)) return ["auvrynt:serena", "auvrynt:process"];
  if (name.startsWith("serena_")) return ["auvrynt:serena"];
  if (name.startsWith("roblox_")) return ["auvrynt:roblox"];
  if (name === "openpencil_status") return ["auvrynt:open-pencil", "auvrynt:read"];
  if (name === "openpencil_list_tools") return ["auvrynt:open-pencil", "auvrynt:process"];
  if (name === "openpencil_call") return ["auvrynt:open-pencil", "auvrynt:process", "auvrynt:write"];
  if (KRITA_READ_TOOL_NAMES.has(name)) return ["auvrynt:read"];
  if (KRITA_LOCAL_READ_TOOL_NAMES.has(name)) return ["auvrynt:krita", "auvrynt:read"];
  if (KRITA_LIVE_READ_TOOL_NAMES.has(name)) return ["auvrynt:krita", "auvrynt:read", "auvrynt:process"];
  if (KRITA_AUTOMATIC_CALIBRATION_TOOL_NAMES.has(name)) {
    return ["auvrynt:krita", "auvrynt:read", "auvrynt:process"];
  }
  if (KRITA_LOCAL_WRITE_TOOL_NAMES.has(name)) return ["auvrynt:krita", "auvrynt:write"];
  if (name.startsWith("krita_")) return ["auvrynt:krita", "auvrynt:process", "auvrynt:write"];
  if (DESKTOP_READ_TOOL_NAMES.has(name)) return ["auvrynt:desktop"];
  if (DESKTOP_PROCESS_TOOL_NAMES.has(name)) return ["auvrynt:desktop", "auvrynt:process"];
  if (name.startsWith("desktop_")) return ["auvrynt:desktop", "auvrynt:process", "auvrynt:write"];
  if (name === "agent_reach_status" || name === "agent_reach_doctor") return ["auvrynt:read", "auvrynt:process"];
  if (name === "agent_reach_guide" || name === "agent_reach_read" || name === "agent_reach_search") return ["auvrynt:read"];
  if (CODEX_READ_TOOL_NAMES.has(name)) return ["auvrynt:read", "auvrynt:process"];
  if (name.startsWith("codex_")) return ["auvrynt:write", "auvrynt:process"];
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
  if (["write", "write_file", "edit", "edit_file", "transfer_file"].includes(name)) return ["auvrynt:write"];
  if (CORE_READ_TOOL_NAMES.has(name)) return ["auvrynt:read"];
  throw new Error(`Unclassified MCP tool "${name}" has no capability policy.`);
}

function agentReachReadUsesProcess(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const candidate = input as { url?: unknown; platform?: unknown };
  if (typeof candidate.url !== "string") return false;
  const requested = typeof candidate.platform === "string" ? candidate.platform : "auto";
  const platform = requested === "auto" || requested === "exa"
    ? detectPlatform(candidate.url)
    : requested;
  return AGENT_REACH_READ_PROCESS_PLATFORMS.has(platform);
}

function agentReachSearchUsesProcess(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const platform = (input as { platform?: unknown }).platform;
  return typeof platform === "string" && AGENT_REACH_SEARCH_PROCESS_PLATFORMS.has(platform);
}

export function requiredScopesForToolCall(name: string, input: unknown): AuvryntScope[] {
  const normalizedName = normalizeMcpToolName(name);
  const required = new Set<AuvryntScope>(requiredScopesForToolName(normalizedName));
  if (normalizedName === "open_workspace" && input && typeof input === "object") {
    if ((input as { mode?: unknown }).mode === "worktree") {
      required.add("auvrynt:write");
      required.add("auvrynt:process");
    }
  }
  if (normalizedName === "agent_reach_read" && agentReachReadUsesProcess(input)) required.add("auvrynt:process");
  if (normalizedName === "agent_reach_search" && agentReachSearchUsesProcess(input)) required.add("auvrynt:process");
  if (normalizedName === "compare_images" && input && typeof input === "object" && "diffOutputPath" in input) {
    if (typeof (input as { diffOutputPath?: unknown }).diffOutputPath === "string") required.add("auvrynt:write");
  }
  if (normalizedName === "dotnet_format" && input && typeof input === "object") {
    if ((input as { verifyOnly?: unknown }).verifyOnly !== true) required.add("auvrynt:write");
  }
  if (normalizedName === "aseprite_recovery" && input && typeof input === "object") {
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
  const normalizedName = normalizeMcpToolName(name);
  if (normalizedName !== name) return toolIntegrationEnabled(config, normalizedName);
  if (config.toolToggles?.[normalizedName] === false) return false;
  if (normalizedName === "arbiter_decide") return config.arbiter.enabled && Boolean(config.arbiter.apiKey);
  if (normalizedName.startsWith("blender_")) return config.integrations.blender;
  if (normalizedName.startsWith("aseprite_")) return config.integrations.aseprite;
  if (isGodotToolName(normalizedName)) return godotIntegrationEnabled(config, normalizedName);
  if (PLAYWRIGHT_TOOL_NAMES.has(normalizedName)) return config.integrations.playwright;
  if (normalizedName.startsWith("agent_reach_")) return true;
  if (normalizedName.startsWith("serena_")) return config.integrations.serena && config.serena.enabled;
  if (normalizedName.startsWith("codex_")) return config.integrations.solOrchestrator;
  if (normalizedName.startsWith("roblox_")) return config.integrations.roblox;
  if (normalizedName.startsWith("openpencil_")) return config.integrations.openPencil;
  if (normalizedName.startsWith("desktop_")) return config.integrations.desktop;
  if (normalizedName.startsWith("krita_")) return config.integrations.krita;
  return true;
}
