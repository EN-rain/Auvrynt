import assert from "node:assert/strict";
import {
  registerToolCapability,
  toolAccessForName,
  integrationForTool,
  updateToolScopes,
  TOOL_CAPABILITIES,
} from "./tool-capabilities.js";

TOOL_CAPABILITIES.clear();

assert.equal(toolAccessForName("bash"), "process");
assert.equal(toolAccessForName("run_shell"), "process");
assert.equal(toolAccessForName("start_process"), "process");
assert.equal(toolAccessForName("stop_process"), "process");
assert.equal(toolAccessForName("write"), "write");
assert.equal(toolAccessForName("edit"), "write");
assert.equal(toolAccessForName("edit_file"), "write");
assert.equal(toolAccessForName("write_file"), "write");
assert.equal(toolAccessForName("open_workspace"), "read");
assert.equal(toolAccessForName("close_workspace"), "process");
assert.equal(toolAccessForName("start_dev_server"), "web-write");
assert.equal(toolAccessForName("capture_page_screenshot"), "web-write");
assert.equal(toolAccessForName("inspect_page"), "web-read");
assert.equal(toolAccessForName("test_responsive_page"), "web-write");
assert.equal(toolAccessForName("get_connection_status"), "read");
assert.equal(toolAccessForName("get_process_logs"), "process");
assert.equal(toolAccessForName("list_processes"), "process");
assert.equal(toolAccessForName("split_sprite_sheet"), "write");
assert.equal(toolAccessForName("inspect_dotnet_project"), "read");
assert.equal(toolAccessForName("capture_window"), "write");
assert.equal(toolAccessForName("desktop_capture"), "read");
assert.equal(toolAccessForName("desktop_stream_start"), "process");
assert.equal(toolAccessForName("desktop_mouse_click"), "write");
assert.equal(toolAccessForName("blender_render"), "write");
assert.equal(toolAccessForName("godot_run_scene"), "write");
assert.equal(toolAccessForName("dotnet_build"), "process");
assert.equal(toolAccessForName("dotnet_test"), "process");
assert.equal(toolAccessForName("dotnet_run"), "process");
assert.equal(toolAccessForName("dotnet_restore"), "process");
assert.equal(toolAccessForName("dotnet_format"), "process");

assert.throws(() => toolAccessForName("nonexistent_tool"), /Unclassified MCP tool/i);
assert.equal(toolAccessForName("serena_find_symbol"), "read");
assert.equal(toolAccessForName("detect_godot_project"), "read");
assert.equal(toolAccessForName("inspect_godot_scene"), "read");
assert.equal(toolAccessForName("compare_images"), "write");

registerToolCapability("bash");
assert.ok(TOOL_CAPABILITIES.has("bash"));
const cap = TOOL_CAPABILITIES.get("bash")!;
registerToolCapability("bash");
assert.equal(TOOL_CAPABILITIES.get("bash"), cap);

registerToolCapability("blender_execute_python");
registerToolCapability("blender_mesh");
registerToolCapability("open_workspace");
registerToolCapability("close_workspace");
registerToolCapability("start_process");
registerToolCapability("dotnet_build");
registerToolCapability("serena_find_symbol");
registerToolCapability("detect_godot_project");
registerToolCapability("compare_images");
registerToolCapability("capture_page_screenshot");
registerToolCapability("inspect_page");
registerToolCapability("start_dev_server");
registerToolCapability("capture_window");
registerToolCapability("split_sprite_sheet");
registerToolCapability("inspect_dotnet_project");
registerToolCapability("write");
registerToolCapability("edit");
registerToolCapability("get_connection_status");

updateToolScopes();

assert.deepEqual(TOOL_CAPABILITIES.get("blender_execute_python")?.scopes, ["auvrynt:blender", "auvrynt:blender-python"]);
assert.deepEqual(TOOL_CAPABILITIES.get("blender_mesh")?.scopes, ["auvrynt:blender"]);
assert.deepEqual(TOOL_CAPABILITIES.get("open_workspace")?.scopes, ["auvrynt:read"]);
assert.deepEqual(TOOL_CAPABILITIES.get("close_workspace")?.scopes, ["auvrynt:write", "auvrynt:process"]);
assert.deepEqual(TOOL_CAPABILITIES.get("start_process")?.scopes, ["auvrynt:process"]);
assert.deepEqual(TOOL_CAPABILITIES.get("dotnet_build")?.scopes, ["auvrynt:software", "auvrynt:process"]);
// serena tools have no toolAccessForName entry, so updateToolScopes throws for them.
// requiredScopesForName does handle serena_* but is only called via updateToolScopes/registerToolCapability cycle.
assert.deepEqual(TOOL_CAPABILITIES.get("capture_page_screenshot")?.scopes, ["auvrynt:web", "auvrynt:write"]);
assert.deepEqual(TOOL_CAPABILITIES.get("inspect_page")?.scopes, ["auvrynt:web"]);
assert.deepEqual(TOOL_CAPABILITIES.get("start_dev_server")?.scopes, ["auvrynt:web", "auvrynt:process"]);
assert.deepEqual(TOOL_CAPABILITIES.get("capture_window")?.scopes, ["auvrynt:process", "auvrynt:write"]);
assert.deepEqual(TOOL_CAPABILITIES.get("split_sprite_sheet")?.scopes, ["auvrynt:write"]);
assert.deepEqual(TOOL_CAPABILITIES.get("inspect_dotnet_project")?.scopes, ["auvrynt:software"]);
assert.deepEqual(TOOL_CAPABILITIES.get("write")?.scopes, ["auvrynt:write"]);
assert.deepEqual(TOOL_CAPABILITIES.get("edit")?.scopes, ["auvrynt:write"]);
assert.deepEqual(TOOL_CAPABILITIES.get("get_connection_status")?.scopes, ["auvrynt:read"]);
assert.deepEqual(TOOL_CAPABILITIES.get("serena_find_symbol")?.scopes, ["auvrynt:serena"]);
assert.deepEqual(TOOL_CAPABILITIES.get("detect_godot_project")?.scopes, ["auvrynt:godot"]);

assert.equal(integrationForTool("blender_render"), "blender");
assert.equal(integrationForTool("godot_run_scene"), "godot");
assert.equal(integrationForTool("serena_find_symbol"), "serena");
assert.equal(integrationForTool("capture_page_screenshot"), "playwright");
assert.equal(integrationForTool("inspect_page"), "playwright");
assert.equal(integrationForTool("test_responsive_page"), "playwright");
assert.equal(integrationForTool("browser_navigate"), "playwright");
assert.equal(integrationForTool("agent_reach_read"), "agentReach");
assert.equal(integrationForTool("context7_resolve_library_id"), undefined);
assert.equal(integrationForTool("obsidian_read_note"), undefined);
assert.equal(integrationForTool("aseprite_detect"), "aseprite");
assert.equal(integrationForTool("roblox_status"), "roblox");
assert.equal(integrationForTool("desktop_capture"), "desktop");
assert.equal(integrationForTool("krita_web_agent_signal"), "krita");
assert.equal(integrationForTool("detect_godot_project"), "godot");
assert.equal(integrationForTool("dotnet_build"), "software");
assert.equal(integrationForTool("bash"), undefined);
assert.equal(integrationForTool("unknown_tool"), undefined);

assert.equal(TOOL_CAPABILITIES.get("bash")?.requiresWorkspace, true);
assert.equal(TOOL_CAPABILITIES.get("open_workspace")?.requiresWorkspace, false);
assert.equal(TOOL_CAPABILITIES.get("close_workspace")?.requiresWorkspace, true);
assert.equal(TOOL_CAPABILITIES.get("write")?.requiresWorkspace, true);

console.log("Tool capabilities tests passed!");
