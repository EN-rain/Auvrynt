import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../../infrastructure/config.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";
import { inspectGdscript } from "./godot-gdscript.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-gdscript-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  const sampleGdscript = `@tool
class_name Player
extends CharacterBody2D

@export var speed = 200.0
@export_range(0, 100) var health = 100

signal jumped(height: float)
signal died

func _ready():
\tpass

func _physics_process(delta):
\tpass
`;

  const scriptPath = "Player.gd";
  await writeFile(join(root, scriptPath), sampleGdscript);

  const res = await inspectGdscript(registry, { workspaceId, scriptPath });

  assert.equal(res.className, "Player");
  assert.equal(res.extendsType, "CharacterBody2D");
  assert.equal(res.toolScript, true);
  
  assert.equal(res.signals.length, 2);
  assert.equal(res.signals[0].name, "jumped");
  assert.equal(res.signals[0].parameters[0].name, "height");
  assert.equal(res.signals[0].parameters[0].type, "float");
  assert.equal(res.signals[1].name, "died");

  assert.equal(res.exports.length, 2);
  assert.equal(res.exports[0].name, "speed");
  assert.equal(res.exports[0].defaultValue, "200.0");
  assert.equal(res.exports[1].name, "health");
  assert.equal(res.exports[1].defaultValue, "100");

  assert.equal(res.methods.length, 2);
  assert.equal(res.methods[0].name, "_ready");
  assert.equal(res.methods[1].name, "_physics_process");

  console.log("inspectGdscript parser unit tests passed!");
} finally {
  await rm(root, { recursive: true, force: true });
}
