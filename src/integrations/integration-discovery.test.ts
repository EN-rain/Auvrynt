import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOpenPencilExecutable, processDetected, type LocalIntegrationDiscovery } from "./integration-discovery.js";
import { findGodotProjectRoots, isSerenaExecutableUsable } from "../cli/integration-bootstrap.js";

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
assert.equal(processDetected({ ...discovery, processes: ["OpenPencil.exe"] }, "openPencil"), true);
assert.equal(processDetected({ ...discovery, processes: ["open-pencil.exe"] }, "openPencil"), true);
assert.equal(processDetected({ ...discovery, processes: ["openpencil-mcp.exe"] }, "openPencil"), false);
assert.equal(isSerenaExecutableUsable(process.execPath), true);
assert.equal(isSerenaExecutableUsable(join(tmpdir(), "missing-serena-command.exe")), false);

const workspace = await mkdtemp(join(tmpdir(), "auvrynt-godot-discovery-"));
try {
  const openPencilPath = join(workspace, "OpenPencil", "OpenPencil.exe");
  await mkdir(join(workspace, "OpenPencil"), { recursive: true });
  await writeFile(openPencilPath, "fixture");
  assert.equal(findOpenPencilExecutable(undefined, [workspace]), openPencilPath);
  assert.equal(findOpenPencilExecutable(openPencilPath, []), openPencilPath);
  assert.equal(findOpenPencilExecutable(join(workspace, "missing.exe"), []), undefined);
  assert.equal(findOpenPencilExecutable(join(workspace, "openpencil.cmd"), []), undefined);

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
