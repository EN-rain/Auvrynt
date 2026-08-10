import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../infrastructure/config.js";
import { getConnectionStatus } from "./connection-status.js";
import { ProcessManager } from "../process/processes.js";
import { WorkspaceRegistry } from "../workspace/workspaces.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-connection-status-test-"));
try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    AUVRYNT_GODOT_GDSCRIPT_ENABLED: "0",
    AUVRYNT_GODOT_CSHARP_ENABLED: "0",
    AUVRYNT_BLENDER_ENABLED: "0",
    AUVRYNT_SERENA_ENABLED: "0",
    AUVRYNT_PLAYWRIGHT_ENABLED: "0",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const processManager = new ProcessManager(registry);

  const status = await getConnectionStatus(
    registry,
    processManager,
    config,
    ["auvrynt:read"],
    workspace.id,
  );

  assert.equal(status.connections.blender.state, "disabled");
  assert.equal(status.connections.godot.state, "disabled");
  assert.equal(status.connections.serena.state, "disabled");
  assert.equal(status.connections.browser.state, "disabled");
  assert.equal(status.connections.chrome_mcp.state, "unauthorized");
  assert.deepEqual(status.processes, []);
} finally {
  await rm(root, { recursive: true, force: true });
}
