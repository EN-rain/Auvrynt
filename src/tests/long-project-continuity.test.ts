import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../infrastructure/config.js";
import { editFileTool, readFileTool, writeFileTool } from "../tools/pi-tools.js";
import { SqliteWorkspaceStore } from "../workspace/workspace-store.js";
import { WorkspaceRegistry } from "../workspace/workspaces.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-long-project-"));
let firstStore: SqliteWorkspaceStore | undefined;
let secondStore: SqliteWorkspaceStore | undefined;
try {
  const stateDir = join(root, ".state");
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_STATE_DIR: stateDir,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  firstStore = new SqliteWorkspaceStore(stateDir);
  const firstRegistry = new WorkspaceRegistry(config, firstStore);
  const opened = await firstRegistry.openWorkspace(root);
  const workspaceId = opened.workspace.id;
  const checklist = [
    "# Long Project Plan",
    "",
    ...Array.from({ length: 25 }, (_, index) => `- [ ] Task ${index + 1}`),
    "",
  ].join("\n");

  const context = { cwd: root, root };
  const written = await writeFileTool({ path: "PROJECT_PLAN.md", content: checklist }, context);
  assert.equal(written.isError, undefined);
  const updated = await editFileTool({
    path: "PROJECT_PLAN.md",
    edits: Array.from({ length: 5 }, (_, index) => ({
      oldText: `- [ ] Task ${index + 1}\n`,
      newText: `- [x] Task ${index + 1}\n`,
    })),
  }, context);
  assert.equal(updated.isError, undefined);
  firstStore.close();
  firstStore = undefined;

  secondStore = new SqliteWorkspaceStore(stateDir);
  const restoredRegistry = new WorkspaceRegistry(config, secondStore);
  const restored = restoredRegistry.getWorkspace(workspaceId);
  assert.equal(restored.root, root);
  const read = await readFileTool({ path: "PROJECT_PLAN.md" }, context);
  assert.equal(read.isError, undefined);
  const text = read.content.map((item) => item.type === "text" ? item.text : "").join("\n");
  assert.equal((text.match(/- \[[ x]\] Task/g) ?? []).length, 25);
  assert.equal((text.match(/- \[x\] Task/g) ?? []).length, 5);
  assert.match(text, /- \[ \] Task 25/);
  secondStore.close();
  secondStore = undefined;
} finally {
  firstStore?.close();
  secondStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("Long-project checklist continuity tests passed!");
