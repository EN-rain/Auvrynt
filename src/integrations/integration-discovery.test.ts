import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processDetected, type LocalIntegrationDiscovery } from "./integration-discovery.js";
import { findGodotProjectRoots } from "./cli/integration-bootstrap.js";

const discovery: LocalIntegrationDiscovery = {
  processes: ["blender.exe", "aseprite.exe", "cloudflared.exe", "serena.exe"],
  executables: { cloudflared: "C:/tools/cloudflared.exe", serena: "C:/tools/serena.exe" },
  ports: {
    blender_lab_mcp: true,
    auvrynt_blender_bridge: false,
    auvrynt_godot_bridge: false,
  },
};

assert.equal(processDetected(discovery, "blender"), true);
assert.equal(processDetected(discovery, "aseprite"), true);
assert.equal(processDetected(discovery, "cloudflare_tunnel"), true);
assert.equal(processDetected(discovery, "serena"), true);
assert.equal(processDetected(discovery, "godot"), false);

const workspace = await mkdtemp(join(tmpdir(), "auvrynt-godot-discovery-"));
try {
  const firstProject = join(workspace, "games", "first");
  const secondProject = join(workspace, "second");
  const excludedProject = join(workspace, "node_modules", "ignored");
  await mkdir(firstProject, { recursive: true });
  await mkdir(secondProject, { recursive: true });
  await mkdir(excludedProject, { recursive: true });
  await writeFile(join(firstProject, "project.godot"), "config_version=5\n");
  await writeFile(join(secondProject, "project.godot"), "config_version=5\n");
  await writeFile(join(excludedProject, "project.godot"), "config_version=5\n");

  assert.deepEqual(
    await findGodotProjectRoots(workspace),
    [firstProject, secondProject],
    "nested workspace projects should be found while generated directories are skipped",
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log("Integration discovery unit tests passed!");
