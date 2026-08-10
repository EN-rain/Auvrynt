import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../../infrastructure/config.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";
import {
  detectGodotProject,
  inspectGodotScene,
  parseGodotProjectFile,
  parseGodotScene,
} from "./godot-tools.js";

const packagedBridge = await readFile(new URL("../../../addons/auvrynt_bridge/auvrynt_bridge.gd", import.meta.url), "utf8");
const bridgeLines = packagedBridge.replace(/^\uFEFF/, "").split(/\r?\n/);
assert.equal(bridgeLines[0], "@tool");
assert.equal(bridgeLines[1], "extends EditorPlugin");
assert.equal(packagedBridge.includes("Claude connector after restart.@tool"), false);

const root = await mkdtemp(join(tmpdir(), "auvrynt-godot-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  const sampleGodotProject = `config_version=5

[application]

config/name="Space Shooter Game"
run/main_scene="res://scenes/main.tscn"
config/features=PackedStringArray("4.3", "Forward+")

[autoload]

GameManager="*res://scripts/game_manager.gd"

[input]

move_right={
"deadzone": 0.5,
"events": []
}
`;

  const sampleSceneTscn = `[gd_scene load_steps=3 format=3 uid="uid://b1234567"]

[ext_resource type="Script" path="res://player.gd" id="1_p1"]

[node name="Player" type="CharacterBody2D"]
position = Vector2(100, 200)
script = ExtResource("1_p1")

[node name="Sprite2D" type="Sprite2D" parent="."]
texture_filter = 1

[connection signal="body_entered" from="." to="." method="_on_body_entered"]
`;

  await writeFile(join(root, "project.godot"), sampleGodotProject);
  await writeFile(join(root, "main.tscn"), sampleSceneTscn);

  // 1. detectGodotProject
  const detRes = await detectGodotProject(registry, { workspaceId });
  assert.equal(detRes.godotProjectFound, true);
  assert.equal(detRes.name, "Space Shooter Game");
  assert.equal(detRes.mainScene, "res://scenes/main.tscn");
  assert.equal(detRes.autoloads?.GameManager, "*res://scripts/game_manager.gd");
  assert.ok(detRes.inputActions?.includes("move_right"));

  // 2. inspectGodotScene
  const sceneRes = await inspectGodotScene(registry, { workspaceId, scenePath: "main.tscn" });
  assert.equal(sceneRes.rootNode, "Player");
  assert.equal(sceneRes.nodeCount, 2);
  assert.ok(sceneRes.nodeTypes.includes("CharacterBody2D"));
  assert.ok(sceneRes.nodeTypes.includes("Sprite2D"));
  assert.equal(sceneRes.externalResources.length, 1);
  assert.equal(sceneRes.signals.length, 1);
  assert.equal(sceneRes.signals[0].signal, "body_entered");
} finally {
  await rm(root, { recursive: true, force: true });
}
