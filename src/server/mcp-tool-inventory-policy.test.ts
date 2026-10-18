import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, SUPPORTED_SCOPES } from "../config.js";
import { createServer } from "../server.js";
import {
  TOOL_CAPABILITIES,
  integrationForTool,
} from "../tool-capabilities.js";
import { requiredScopesForToolName } from "./mcp-policy.js";
import { registerAppTool } from "./mcp-tool-registrar.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-tool-policy-"));
try {
  TOOL_CAPABILITIES.clear();
  const config = loadConfig({
    AUVRYNT_CONFIG_DIR: root,
    AUVRYNT_STATE_DIR: root,
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    AUVRYNT_OAUTH_SCOPES: SUPPORTED_SCOPES.join(","),
    AUVRYNT_GODOT_GDSCRIPT_ENABLED: "1",
    AUVRYNT_GODOT_CSHARP_ENABLED: "1",
    AUVRYNT_BLENDER_ENABLED: "1",
    AUVRYNT_ASEPRITE_ENABLED: "1",
    AUVRYNT_SERENA_ENABLED: "1",
    AUVRYNT_SERENA_INTEGRATION_ENABLED: "1",
    AUVRYNT_PLAYWRIGHT_ENABLED: "1",
    AUVRYNT_ROBLOX_ENABLED: "1",
    AUVRYNT_DESKTOP_ENABLED: "1",
    AUVRYNT_KRITA_ENABLED: "1",
    PORT: "1",
  });

  const running = createServer(config);
  try {
    const entries = [...TOOL_CAPABILITIES.entries()];
    assert.ok(entries.length > 500, `expected the executable production inventory, got only ${entries.length} tools`);

    const names = entries.map(([name]) => name);
    assert.equal(new Set(names).size, names.length, "production tool inventory must not contain duplicate names");

    for (const [name, capability] of entries) {
      assert.equal(capability.name, name, `${name} capability name must match its inventory key`);
      assert.ok(capability.scopes.length > 0, `${name} must have explicit capability scopes`);
      assert.deepEqual(
        [...capability.scopes].sort(),
        [...requiredScopesForToolName(name)].sort(),
        `${name} capability scopes must match the central policy`,
      );
      assert.ok(
        ["read", "write", "process", "web-read", "web-write"].includes(capability.access),
        `${name} must have an explicit access classification`,
      );
    }

    const expectedIntegrations: Array<[string, string]> = [
      ["blender_ping", "blender"],
      ["aseprite_detect", "aseprite"],
      ["detect_godot_project", "godot"],
      ["serena_find_symbol", "serena"],
      ["browser_open", "playwright"],
      ["agent_reach_read", "agentReach"],
      ["desktop_capture", "desktop"],
      ["krita_web_agent_signal", "krita"],
      ["roblox_status", "roblox"],
      ["dotnet_build", "software"],
    ];
    for (const [name, integration] of expectedIntegrations) {
      assert.ok(TOOL_CAPABILITIES.has(name), `${name} must be present in the production inventory`);
      assert.equal(integrationForTool(name), integration, `${name} must belong to ${integration}`);
      assert.equal(TOOL_CAPABILITIES.get(name)?.integration, integration);
    }
    assert.equal(TOOL_CAPABILITIES.has("context7_resolve_library"), false);
    assert.equal(TOOL_CAPABILITIES.has("obsidian_read_note"), false);
  } finally {
    await running.close();
  }

  const testServer = new McpServer({ name: "unclassified-registration-test", version: "1.0.0" });
  assert.throws(
    () => (registerAppTool as any)(
      testServer,
      "unclassified_test_tool",
      { inputSchema: {}, _meta: {} },
      async () => ({ content: [{ type: "text", text: "should not register" }] }),
    ),
    /Unclassified MCP tool/i,
    "an unclassified tool must fail before registration",
  );
  await testServer.close();
} finally {
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || code !== "EBUSY") throw error;
  }
}

console.log("MCP production tool inventory policy tests passed!");
