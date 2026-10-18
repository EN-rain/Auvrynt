import assert from "node:assert/strict";
import { countTextLines, createWorkspaceChangeTracker } from "./workspace-analytics.js";

let tick = 0;
const tracker = createWorkspaceChangeTracker(() => new Date(1_700_000_000_000 + tick++ * 1_000));

assert.equal(countTextLines(""), 0);
assert.equal(countTextLines("one"), 1);
assert.equal(countTextLines("one\n"), 1);
assert.equal(countTextLines("one\ntwo\n"), 2);
assert.equal(countTextLines("one\n\n"), 2);

tracker.activateWorkspace("ws_a", "C:/projects/a");
assert.deepEqual(tracker.snapshot(), {
  workspaceId: "ws_a",
  workspaceRoot: "C:/projects/a",
  filesCreated: 0,
  filesDeleted: 0,
  filesModified: 0,
  additions: 0,
  removals: 0,
  startedAt: "2023-11-14T22:13:20.000Z",
  sampledAt: "2023-11-14T22:13:20.000Z",
});

tracker.recordMutation({
  workspaceId: "ws_a",
  workspaceRoot: "C:/projects/a",
  path: "src/new.ts",
  kind: "created",
  additions: 12,
  removals: 0,
});
tracker.recordMutation({
  workspaceId: "ws_a",
  workspaceRoot: "C:/projects/a",
  path: "src/new.ts",
  kind: "modified",
  additions: 3,
  removals: 1,
});
tracker.recordMutation({
  workspaceId: "ws_a",
  workspaceRoot: "C:/projects/a",
  path: "src/existing.ts",
  kind: "modified",
  additions: 4,
  removals: 2,
});
tracker.recordMutation({
  workspaceId: "ws_a",
  workspaceRoot: "C:/projects/a",
  path: "src/old.ts",
  kind: "deleted",
  additions: -5,
  removals: 8.8,
});

assert.deepEqual(tracker.snapshot(), {
  workspaceId: "ws_a",
  workspaceRoot: "C:/projects/a",
  filesCreated: 1,
  filesDeleted: 1,
  filesModified: 2,
  additions: 19,
  removals: 11,
  startedAt: "2023-11-14T22:13:20.000Z",
  sampledAt: "2023-11-14T22:13:24.000Z",
});

tracker.activateWorkspace("ws_a_reconnected", "C:/projects/a/");
assert.equal(tracker.snapshot().workspaceId, "ws_a_reconnected");
assert.equal(tracker.snapshot().additions, 19, "reopening the same root must preserve activity across MCP sessions");

tracker.activateWorkspace("ws_b", "C:/projects/no-git");
assert.equal(tracker.snapshot().workspaceRoot, "C:/projects/no-git");
assert.equal(tracker.snapshot().additions, 0);
assert.equal(tracker.deactivateWorkspace("missing"), false);
assert.equal(tracker.deactivateWorkspace("ws_b"), true);
assert.equal(tracker.snapshot().workspaceId, undefined);
tracker.activateWorkspace("ws_a_reconnected", "C:/projects/a");
assert.equal(tracker.snapshot().additions, 19);
assert.equal(tracker.deactivateWorkspace("ws_a_reconnected"), true);
assert.equal(tracker.snapshot().workspaceId, undefined);

console.log("Auvrynt workspace activity analytics tests passed!");
