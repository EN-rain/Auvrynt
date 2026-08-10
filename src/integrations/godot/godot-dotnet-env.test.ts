import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../../infrastructure/config.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";
import {
  findGodotExecutableCandidates,
  inspectGodotDotnetEnvironment,
  verifyGodotExecutable,
} from "./godot-dotnet-env.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-godot-env-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  // 1. Candidate discovery
  const candidates = findGodotExecutableCandidates();
  assert.ok(candidates.length > 0);
  assert.ok(candidates.includes("godot-mono"));

  // 2. Executable verification fallback (non-existent executable)
  const verifyRes = await verifyGodotExecutable("non_existent_godot_path_123");
  assert.equal(verifyRes.valid, false);
  assert.equal(verifyRes.hasDotnetSupport, false);

  // 3. Environment diagnostic call
  const envRes = await inspectGodotDotnetEnvironment(registry, { workspaceId });
  assert.ok(envRes.status === "ready" || envRes.status === "incomplete" || envRes.status === "invalid");
  assert.ok(Array.isArray(envRes.problems));
} finally {
  await rm(root, { recursive: true, force: true });
}
