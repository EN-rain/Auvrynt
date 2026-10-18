import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { loadConfig } from "../infrastructure/config.js";
import { GitWorktreeError } from "./git-worktrees.js";
import { SqliteWorkspaceStore } from "./workspace-store.js";
import { WorkspaceRegistry } from "./workspaces.js";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "auvrynt-workspace-test-"));

try {
  const agentDir = join(root, ".pi", "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "AGENTS.md"), "global instructions\n");
  await writeFile(join(root, "AGENTS.md"), "root instructions\n");
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", "AGENTS.md"), "nested instructions\n");
  await writeFile(join(root, "nested", "file.txt"), "hello\n");

  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_WORKTREE_ROOT: join(root, ".auvrynt", "worktrees"),
    AUVRYNT_AGENT_DIR: agentDir,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace, agentsFiles, availableAgentsFiles } = await registry.openWorkspace(root);

  assert.equal(workspace.mode, "checkout");
  const expectedArtifact = join(root, "auvrynt-logs", "playwright", "example.png");
  assert.equal(registry.resolveArtifactPath(workspace, "example.png", "playwright"), expectedArtifact);
  assert.equal(registry.resolveArtifactPath(workspace, "playwright/example.png", "playwright"), expectedArtifact);
  assert.equal(registry.resolveArtifactPath(workspace, "auvrynt-logs/playwright/example.png", "playwright"), expectedArtifact);
  assert.throws(
    () => registry.resolveArtifactPath(workspace, "../example.png", "playwright"),
    /outside allowed roots/i,
  );
  assert.deepEqual(
    agentsFiles.map((file) => file.content),
    ["global instructions\n", "root instructions\n"],
  );
  assert.deepEqual(
    availableAgentsFiles.map((file) => file.path),
    [join(root, "nested", "AGENTS.md")],
  );

  const missingWorkspaceRoot = join(root, "missing", "workspace");
  const missingWorkspace = await registry.openWorkspace(missingWorkspaceRoot);
  assert.equal(missingWorkspace.workspace.root, missingWorkspaceRoot);
  assert.equal(missingWorkspace.workspace.mode, "checkout");
  assert.equal((await stat(missingWorkspaceRoot)).isDirectory(), true);

  registry.markClosed(missingWorkspace.workspace.id);
  assert.throws(
    () => registry.getWorkspace(missingWorkspace.workspace.id),
    /Unknown workspaceId|has been closed/,
  );
  const reopenedMissingWorkspace = await registry.openWorkspace(missingWorkspaceRoot);
  assert.notEqual(reopenedMissingWorkspace.workspace.id, missingWorkspace.workspace.id);

  await assert.rejects(
    () => registry.openWorkspace({ path: root, mode: "worktree" }),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "GIT_REPOSITORY_NOT_FOUND",
  );

  const gitRoot = join(root, "git-project");
  await mkdir(gitRoot);
  await writeFile(join(gitRoot, "AGENTS.md"), "git root instructions\n");
  await writeFile(join(gitRoot, "README.md"), "hello\n");
  await git(gitRoot, ["init"]);
  await git(gitRoot, ["config", "user.email", "auvrynt@example.com"]);
  await git(gitRoot, ["config", "user.name", "Auvrynt Test"]);
  await git(gitRoot, ["add", "."]);
  await git(gitRoot, ["commit", "-m", "Initial commit"]);
  await writeFile(join(gitRoot, "dirty.txt"), "not copied\n");

  const worktreeWorkspace = await registry.openWorkspace({
    path: gitRoot,
    mode: "worktree",
  });
  assert.equal(worktreeWorkspace.workspace.mode, "worktree");
  assert.notEqual(worktreeWorkspace.workspace.root, gitRoot);
  assert.match(worktreeWorkspace.workspace.root, /git-project-[a-f0-9]{8}$/);
  assert.equal(worktreeWorkspace.workspace.sourceRoot, gitRoot);
  assert.equal(worktreeWorkspace.workspace.worktree?.baseRef, "HEAD");
  assert.equal(worktreeWorkspace.workspace.worktree?.dirtySource, true);
  assert.equal(worktreeWorkspace.workspace.worktree?.managed, true);
  assert.equal((await stat(worktreeWorkspace.workspace.root)).isDirectory(), true);
  assert.match(worktreeWorkspace.agentsFiles.map((file) => file.content).join("\n"), /global instructions/);
  assert.match(worktreeWorkspace.agentsFiles.map((file) => file.content).join("\n"), /git root instructions/);

  const worktreeReadmePath = registry.resolvePath(worktreeWorkspace.workspace, "README.md");
  assert.equal(worktreeReadmePath.startsWith(worktreeWorkspace.workspace.root), true);

  const stateDir = join(root, ".state");
  const firstStore = new SqliteWorkspaceStore(stateDir);
  const persistentRegistry = new WorkspaceRegistry(config, firstStore);
  const persistentWorkspace = await persistentRegistry.openWorkspace(root);
  const persistentWorktree = await persistentRegistry.openWorkspace({
    path: gitRoot,
    mode: "worktree",
  });
  firstStore.close();

  const secondStore = new SqliteWorkspaceStore(stateDir);
  const restoredRegistry = new WorkspaceRegistry(config, secondStore);
  const restoredWorkspace = restoredRegistry.getWorkspace(persistentWorkspace.workspace.id);
  assert.equal(restoredWorkspace.root, root);
  assert.equal(restoredWorkspace.mode, "checkout");

  const restoredWorktree = restoredRegistry.getWorkspace(persistentWorktree.workspace.id);
  assert.equal(restoredWorktree.mode, "worktree");
  assert.equal(restoredWorktree.sourceRoot, gitRoot);
  assert.equal(restoredWorktree.root, persistentWorktree.workspace.root);
  assert.equal(restoredWorktree.worktree?.managed, true);
  secondStore.close();

  await rm(persistentWorktree.workspace.root, { recursive: true, force: true });
  const thirdStore = new SqliteWorkspaceStore(stateDir);
  const missingWorktreeRegistry = new WorkspaceRegistry(config, thirdStore);
  const recoveredCheckout = missingWorktreeRegistry.getWorkspace(persistentWorktree.workspace.id);
  assert.equal(recoveredCheckout.mode, "checkout");
  assert.equal(recoveredCheckout.root, gitRoot);
  assert.equal(recoveredCheckout.sourceRoot, undefined);
  assert.equal(recoveredCheckout.worktree, undefined);
  thirdStore.close();

  const fourthStore = new SqliteWorkspaceStore(stateDir);
  const persistedFallbackRegistry = new WorkspaceRegistry(config, fourthStore);
  const persistedFallback = persistedFallbackRegistry.getWorkspace(persistentWorktree.workspace.id);
  assert.equal(persistedFallback.mode, "checkout");
  assert.equal(persistedFallback.root, gitRoot);
  fourthStore.close();

  const limitedRegistry = new WorkspaceRegistry(config, undefined, { maxActiveWorkspaces: 3 });
  const concurrentOpens = await Promise.allSettled(
    Array.from({ length: 8 }, () => limitedRegistry.openWorkspace(root)),
  );
  const opened = concurrentOpens.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<WorkspaceRegistry["openWorkspace"]>>> => result.status === "fulfilled",
  );
  assert.equal(opened.length, 3, "concurrent workspace opens must not oversubscribe capacity");
  assert.equal(concurrentOpens.filter((result) => result.status === "rejected").length, 5);
  for (const result of opened) limitedRegistry.markClosed(result.value.workspace.id);

  if (platform() !== "win32") {
    const aliasRoot = join(root, "alias-root");
    await symlink(root, aliasRoot, "dir");
    const aliasConfig = loadConfig({
      AUVRYNT_ALLOWED_ROOTS: aliasRoot,
      AUVRYNT_WORKTREE_ROOT: join(aliasRoot, ".auvrynt", "alias-worktrees"),
      AUVRYNT_AGENT_DIR: agentDir,
      AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
      PORT: "1",
    });
    const aliasWorkspace = await new WorkspaceRegistry(aliasConfig).openWorkspace({
      path: join(aliasRoot, "git-project"),
      mode: "worktree",
    });
    assert.equal(aliasWorkspace.workspace.sourceRoot, join(aliasRoot, "git-project"));
  }

  const replacementRoot = join(root, "replacement-root");
  await mkdir(replacementRoot);
  const closedWorkspaceIds = registry.replaceAllowedRoots([replacementRoot]);
  assert.ok(closedWorkspaceIds.includes(workspace.id), "changing roots must invalidate the old active workspace");
  assert.throws(() => registry.getWorkspace(workspace.id), /Unknown workspaceId|has been closed/);
  const replacementWorkspace = await registry.openWorkspace(replacementRoot);
  assert.equal(replacementWorkspace.workspace.root, replacementRoot);
  assert.deepEqual(config.allowedRoots, [replacementRoot]);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
