import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../infrastructure/config.js";
import { BoundedMcpEventStore } from "../infrastructure/mcp-event-store.js";
import { RoomRegistry } from "../auth/room-registry.js";
import { limitToolResultPayload } from "../infrastructure/tool-result-budget.js";
import { WorkspaceRegistry } from "../workspace/workspaces.js";

// Accelerated deterministic soak checks. These exercise the same bounded
// collections and payload paths that accumulate during a 12-hour agent session
// without waiting twelve wall-clock hours.

{
  const store = new BoundedMcpEventStore({
    maxEvents: 10_000,
    maxBytes: 1024 * 1024,
    maxEventBytes: 128 * 1024,
    retentionMs: 12 * 60 * 60 * 1000,
  });

  for (let index = 0; index < 5_000; index++) {
    await store.storeEvent("soak-stream", {
      jsonrpc: "2.0",
      id: index,
      result: { payload: "x".repeat(8 * 1024) },
    });
  }

  assert.ok(store.byteSize() <= 1024 * 1024);
  assert.ok(store.size() < 5_000);
}

{
  const rooms = new RoomRegistry();
  for (let index = 0; index < 5_000; index++) {
    const room = rooms.create("soak-owner", `workspace-${index}`);
    rooms.close(room.roomId);
  }
  assert.equal(rooms.allRooms().length, 0);
}

{
  const hugeText = "z".repeat(2 * 1024 * 1024);
  for (let index = 0; index < 500; index++) {
    const limited = limitToolResultPayload({
      content: [{ type: "text", text: hugeText }],
      _meta: { tool: "read", card: { payload: { content: [{ type: "text", text: hugeText }] } } },
      structuredContent: { index, result: hugeText },
    });
    assert.ok(Buffer.byteLength(JSON.stringify(limited), "utf8") < 2.5 * 1024 * 1024);
  }
}

const root = await mkdtemp(join(tmpdir(), "auvrynt-sustained-use-"));
try {
  await writeFile(join(root, "README.md"), "soak workspace\n");
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_WORKTREE_ROOT: join(root, ".worktrees"),
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    AUVRYNT_SKILLS: "0",
    PORT: "1",
  });
  const workspaces = new WorkspaceRegistry(config);

  // More cycles than the registry's simultaneous 128-workspace capacity. This
  // proves close_workspace releases capacity instead of requiring a restart.
  for (let index = 0; index < 160; index++) {
    const opened = await workspaces.openWorkspace(root);
    workspaces.markClosed(opened.workspace.id);
  }

  const finalWorkspace = await workspaces.openWorkspace(root);
  assert.equal(finalWorkspace.workspace.root, root);
  workspaces.markClosed(finalWorkspace.workspace.id);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Sustained-use soak tests passed!");
