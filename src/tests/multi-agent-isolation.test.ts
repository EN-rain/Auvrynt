import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../infrastructure/config.js";
import { RoomRegistry } from "../auth/room-registry.js";
import { SqliteWorkspaceStore } from "../workspace/workspace-store.js";
import { WorkspaceRegistry } from "../workspace/workspaces.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-multi-agent-"));
let firstStore: SqliteWorkspaceStore | undefined;
let secondStore: SqliteWorkspaceStore | undefined;
try {
  const chatgptDirectory = join(root, "chatgpt-project");
  const claudeDirectory = join(root, "claude-project");
  await mkdir(chatgptDirectory);
  await mkdir(claudeDirectory);

  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_WORKTREE_ROOT: join(root, ".worktrees"),
    AUVRYNT_STATE_DIR: join(root, ".state"),
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  firstStore = new SqliteWorkspaceStore(config.stateDir);
  const workspaces = new WorkspaceRegistry(config, firstStore);
  const rooms = new RoomRegistry(firstStore.getDatabase());

  const chatgpt = await workspaces.openWorkspace(chatgptDirectory);
  const claude = await workspaces.openWorkspace(claudeDirectory);
  const chatgptRoom = rooms.create("chatgpt-client", chatgpt.workspace.id);
  const claudeRoom = rooms.create("claude-client", claude.workspace.id);

  assert.notEqual(chatgpt.workspace.id, claude.workspace.id);
  assert.notEqual(chatgptRoom.roomId, claudeRoom.roomId);
  assert.equal(rooms.requireWorkspaceAccess("chatgpt-client", chatgpt.workspace.id).roomId, chatgptRoom.roomId);
  assert.equal(rooms.requireWorkspaceAccess("claude-client", claude.workspace.id).roomId, claudeRoom.roomId);
  assert.throws(
    () => rooms.requireWorkspaceAccess("chatgpt-client", claude.workspace.id),
    /different OAuth client/,
  );
  assert.throws(
    () => rooms.requireWorkspaceAccess("claude-client", chatgpt.workspace.id),
    /different OAuth client/,
  );

  const sameCheckoutA = await workspaces.openWorkspace(chatgptDirectory);
  const sameCheckoutB = await workspaces.openWorkspace(chatgptDirectory);
  rooms.create("chatgpt-client", sameCheckoutA.workspace.id);
  rooms.create("claude-client", sameCheckoutB.workspace.id);
  assert.notEqual(sameCheckoutA.workspace.id, sameCheckoutB.workspace.id);
  assert.equal(sameCheckoutA.workspace.root, sameCheckoutB.workspace.root);
  assert.equal(sameCheckoutA.workspace.mode, "checkout");
  assert.equal(sameCheckoutB.workspace.mode, "checkout");

  firstStore.close();
  firstStore = undefined;
  secondStore = new SqliteWorkspaceStore(config.stateDir);
  const restoredRooms = new RoomRegistry(secondStore.getDatabase());
  assert.equal(
    restoredRooms.requireWorkspaceAccess("chatgpt-client", chatgpt.workspace.id).ownerClientId,
    "chatgpt-client",
  );
  assert.throws(
    () => restoredRooms.requireWorkspaceAccess("claude-client", chatgpt.workspace.id),
    /different OAuth client/,
  );
  secondStore.close();
  secondStore = undefined;
} finally {
  firstStore?.close();
  secondStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("Multi-agent isolation tests passed!");
