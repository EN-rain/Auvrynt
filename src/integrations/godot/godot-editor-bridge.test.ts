import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../infrastructure/config.js";
import { GodotEditorBridgeClient, godotEditorConnect } from "./godot-editor-bridge.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";

const client = new GodotEditorBridgeClient();
await assert.rejects(
  () => client.connect("10.0.0.1", 49322, "token"),
  /Only loopback connections are allowed/i,
);
await assert.rejects(
  () => client.connect("127.0.0.1", 70000, "token"),
  /Invalid Godot bridge port/i,
);

const root = await mkdtemp(join(tmpdir(), "auvrynt-godot-bridge-test-"));
try {
  const registry = new WorkspaceRegistry(loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  }));

  await assert.rejects(
    () => godotEditorConnect(registry, {
      workspaceId: "ws_unknown",
      projectPath: root,
      token: "token",
    }),
    /Unknown workspaceId/i,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
