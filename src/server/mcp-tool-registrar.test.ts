import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { loadConfig } from "../config.js";
import { RoomRegistry } from "../room-registry.js";
import { runWithContext } from "../request-context.js";
import { WorkspaceRegistry } from "../workspaces.js";
import { TOOL_CAPABILITIES } from "../tool-capabilities.js";
import {
  configureMcpToolGuard,
  registerAppTool,
  syncMcpToolAvailability,
} from "./mcp-tool-registrar.js";
import { groupForTool, groupToolsByName } from "./tool-groups.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-tool-guard-"));
try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const workspaces = new WorkspaceRegistry(config);
  const rooms = new RoomRegistry();
  const ownerWorkspace = await workspaces.openWorkspace(root);
  rooms.create("owner-a", ownerWorkspace.workspace.id);

  const server = new McpServer({ name: "test", version: "1.0.0" });
  configureMcpToolGuard(server, { config, workspaces, rooms });
  let calls = 0;
  const registered = registerAppTool(server, "read_file", {
    inputSchema: { workspaceId: z.string() },
    _meta: {},
  }, async () => {
    calls += 1;
    return { content: [{ type: "text", text: "ok" }] };
  });
  assert.ok(registered);
  const handler = (registered as any).handler as (...args: any[]) => Promise<any>;
  const authInfo = { authInfo: { clientId: "owner-a", scopes: ["auvrynt:read"] } };

  const allowed = await runWithContext({
    sessionId: "session-a",
    ownerClientId: "owner-a",
    authScopes: ["auvrynt:read"],
  }, () => handler({ workspaceId: ownerWorkspace.workspace.id }, authInfo));
  assert.equal(allowed.content[0].text, "ok");
  assert.equal(calls, 1);

  await assert.rejects(
    () => runWithContext({
      sessionId: "session-b",
      ownerClientId: "owner-b",
      authScopes: ["auvrynt:read"],
    }, () => handler({ workspaceId: ownerWorkspace.workspace.id }, {
      authInfo: { clientId: "owner-b", scopes: ["auvrynt:read"] },
    })),
    /different OAuth client/,
  );
  assert.equal(calls, 1, "cross-owner request must be rejected before tool execution");

  config.integrations.serena = true;
  config.serena.enabled = true;
  const serenaTool = registerAppTool(server, "serena_find_symbol", {
    inputSchema: { workspaceId: z.string() },
    _meta: {},
  }, async () => ({ content: [{ type: "text", text: "semantic" }] }));
  assert.ok(serenaTool);
  assert.equal((serenaTool as any).enabled, true);

  config.integrations.serena = false;
  config.serena.enabled = false;
  assert.deepEqual(syncMcpToolAvailability(server, config), { enabled: 0, disabled: 1 });
  assert.equal((serenaTool as any).enabled, false, "disabled Serena must disappear from the MCP tool list");

  config.integrations.serena = true;
  config.serena.enabled = true;
  assert.deepEqual(syncMcpToolAvailability(server, config), { enabled: 1, disabled: 0 });
  assert.equal((serenaTool as any).enabled, true);

  config.toolToggles["blender_create_cube"] = false;
  config.integrations.blender = true;
  const blenderTool = registerAppTool(server, "blender_create_cube", {
    inputSchema: { workspaceId: z.string() },
    _meta: {},
  }, async () => ({ content: [{ type: "text", text: "cube" }] }));
  assert.ok(blenderTool);
  assert.equal((blenderTool as any).enabled, false, "toolToggles=false must hide the tool even when the integration is enabled");
  delete config.toolToggles["blender_create_cube"];
  assert.deepEqual(syncMcpToolAvailability(server, config), { enabled: 1, disabled: 0 });
  assert.equal((blenderTool as any).enabled, true, "removing the toggle must restore the tool");

  const unavailableDesktopTool = registerAppTool(server, "desktop_capture", {
    inputSchema: { workspaceId: z.string() },
    _meta: {},
  }, async () => ({ content: [{ type: "text", text: "capture" }] }));
  assert.equal(unavailableDesktopTool, undefined, "a tool outside the configured OAuth envelope must not be registered");
  assert.equal(
    TOOL_CAPABILITIES.has("desktop_capture"),
    false,
    "a tool that was not registered must not be advertised through the capability inventory",
  );

  assert.equal(groupForTool("blender_add_cube"), "Model");
  assert.equal(groupForTool("blender_set_keyframe"), "Animation");
  assert.equal(groupForTool("blender_setup_principled_material"), "Materials & Shading");
  assert.equal(groupForTool("blender_viewport_orbit"), "Viewport & Camera");
  assert.equal(groupForTool("blender_render_image"), "Rendering");
  assert.equal(groupForTool("blender_export_glb"), "Export & Import");
  assert.equal(groupForTool("blender_select_all"), "Selection");
  assert.equal(groupForTool("blender_ping"), "Utilities");
  assert.equal(groupForTool("blender_unknown_op"), "Other");
  const grouped = groupToolsByName(["blender_add_cube", "blender_knife_cut", "blender_add_uv_sphere"]);
  assert.deepEqual([...grouped.keys()], ["Model"]);
  assert.equal(grouped.get("Model")!.length, 3);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("MCP tool registrar ownership tests passed!");
