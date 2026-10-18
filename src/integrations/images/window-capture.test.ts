import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../infrastructure/config.js";
import { ProcessManager } from "../../process/processes.js";
import { captureWindow, WINDOW_CAPTURE_FALLBACK_POLICY } from "./window-capture.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-window-capture-test-"));
try {
  assert.equal(WINDOW_CAPTURE_FALLBACK_POLICY, "disabled", "window capture must never sample pixels from the desktop behind the target");
  const registry = new WorkspaceRegistry(loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  }));
  const { workspace } = await registry.openWorkspace(root);
  const manager = new ProcessManager(registry);

  const noTarget = await captureWindow(registry, manager, {
    workspaceId: workspace.id,
    outputPath: "capture.png",
  });
  assert.equal(noTarget.isError, true);
  assert.match(noTarget.content[0]?.type === "text" ? noTarget.content[0].text : "", /requires processId or windowTitle|Windows hosts/i);

  if (process.platform === "win32") {
    const invalidProcess = await captureWindow(registry, manager, {
      workspaceId: workspace.id,
      processId: "proc_unknown",
      outputPath: "capture.png",
    }).catch((error) => error as Error);
    assert.ok(invalidProcess instanceof Error);
    assert.match(invalidProcess.message, /not found in workspace/i);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
