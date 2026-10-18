import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { createServer } from "../server.js";
import { createDashboardToolsView } from "./dashboard.js";
import { integrationToolCounts } from "./mcp-tool-registrar.js";

const stateDir = await mkdtemp(join(tmpdir(), "auvrynt-tool-inventory-seed-"));
const config = loadConfig({
  AUVRYNT_CONFIG_DIR: stateDir,
  AUVRYNT_ALLOWED_ROOTS: process.cwd(),
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  AUVRYNT_GODOT_GDSCRIPT_ENABLED: "0",
  AUVRYNT_GODOT_CSHARP_ENABLED: "0",
  AUVRYNT_BLENDER_ENABLED: "1",
  AUVRYNT_ASEPRITE_ENABLED: "0",
  AUVRYNT_SERENA_ENABLED: "1",
  AUVRYNT_PLAYWRIGHT_ENABLED: "1",
  AUVRYNT_STATE_DIR: stateDir,
  PORT: "1",
});

const running = createServer(config);

const counts = integrationToolCounts(config);
console.log("seed counts:", JSON.stringify(counts));
console.log("oauth scopes:", JSON.stringify(config.oauth.scopes));
assert.ok((counts.blender?.total ?? 0) > 200, "blender tools must be seeded at startup without a session");
assert.ok((counts.serena?.total ?? 0) > 0, "serena tools must be seeded at startup without a session");

const blenderTools = createDashboardToolsView(config, "blender");
assert.ok(blenderTools && blenderTools.length > 200, "blender dashboard tools view must be populated without a session");
const serenaTools = createDashboardToolsView(config, "serena");
assert.ok(serenaTools && serenaTools.length > 0, "serena dashboard tools view must be populated without a session");

const disabledView = createDashboardToolsView(config, "aseprite");
assert.ok(disabledView && disabledView.length > 0, "disabled integration tools still visible in dashboard (all toggled off)");
assert.ok(disabledView.every((t) => !t.enabled), "disabled integration tools must all show as disabled");
const enabledCount = disabledView.filter((t) => t.enabled).length;
assert.equal(enabledCount, 0, "disabled integration must not show enabled tools");

await running.close();
console.log("Tool inventory seed tests passed!");
console.log('seed counts:', JSON.stringify(counts));
