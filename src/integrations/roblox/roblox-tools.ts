import {
  callRobloxStudioTool,
  disconnectRobloxStudioClient,
  listRobloxStudioTools,
  resolveRobloxStudioMcpLaunch,
  robloxStudioClientConnected,
} from "./roblox-studio-client.js";

/** Official Studio MCP tools documented by Roblox (names as exposed by Studio). */
export const ROBLOX_OFFICIAL_TOOL_NAMES = [
  "script_read",
  "multi_edit",
  "script_search",
  "script_grep",
  "generate_mesh",
  "generate_material",
  "generate_procedural_model",
  "wait_job_finished",
  "search_asset",
  "insert_asset",
  "upload_image",
  "store_image",
  "subagent",
  "search_game_tree",
  "inspect_instance",
  "execute_luau",
  "get_studio_state",
  "start_stop_play",
  "get_console_output",
  "screen_capture",
  "character_navigation",
  "user_keyboard_input",
  "user_mouse_input",
  "http_get",
  "skill",
  "list_roblox_studios",
  "set_active_studio",
] as const;

export type RobloxOfficialToolName = (typeof ROBLOX_OFFICIAL_TOOL_NAMES)[number];

export function auvryntRobloxToolName(remoteName: string): string {
  return remoteName.startsWith("roblox_") ? remoteName : `roblox_${remoteName}`;
}

export function remoteRobloxToolName(auvryntName: string): string {
  return auvryntName.startsWith("roblox_") ? auvryntName.slice("roblox_".length) : auvryntName;
}

export async function robloxStatus(): Promise<Record<string, unknown>> {
  const launch = resolveRobloxStudioMcpLaunch();
  const base = {
    integration: "roblox",
    mode: "official-studio-mcp",
    platform: launch.platform,
    launcher: {
      command: launch.command,
      args: launch.args,
      path: launch.hint,
      exists: launch.pathExists,
    },
    connected: robloxStudioClientConnected(),
    setup: [
      "Open Roblox Studio",
      "Assistant → … → Manage MCP Servers → Enable Studio as MCP server",
      "Start Auvrynt with: auvrynt start roblox",
      "Keep Studio open while using roblox_* tools",
    ],
    docs: "https://create.roblox.com/docs/studio/mcp",
  };

  if (!launch.pathExists) {
    return {
      ...base,
      ok: false,
      error: `Studio MCP launcher not found at ${launch.hint}`,
    };
  }

  try {
    const tools = await listRobloxStudioTools(true);
    return {
      ...base,
      ok: true,
      connected: true,
      toolCount: tools.length,
      tools: tools.map((t) => t.name),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      ok: false,
      connected: false,
      error: message,
    };
  }
}

export async function robloxListTools(forceRefresh = false): Promise<Record<string, unknown>> {
  const tools = await listRobloxStudioTools(forceRefresh);
  return {
    ok: true,
    count: tools.length,
    tools: tools.map((tool) => ({
      remoteName: tool.name,
      auvryntName: auvryntRobloxToolName(tool.name),
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
}

export async function robloxCall(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const remote = remoteRobloxToolName(toolName);
  return callRobloxStudioTool(remote, args);
}

export async function robloxDisconnect(): Promise<{ ok: true }> {
  await disconnectRobloxStudioClient();
  return { ok: true };
}
