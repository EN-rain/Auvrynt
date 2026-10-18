import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveStartLaunchRoot } from "./serve-command.js";

const cwd = resolve(process.cwd(), "current-directory");
const saved = resolve(process.cwd(), "saved-directory");
const configured = resolve(process.cwd(), "configured-directory");

assert.equal(
  resolveStartLaunchRoot([], { workspaceRoot: saved, allowedRoots: [configured] }, cwd),
  saved,
);
assert.equal(
  resolveStartLaunchRoot([], { allowedRoots: [configured] }, cwd),
  configured,
);
assert.equal(
  resolveStartLaunchRoot(["krita"], { workspaceRoot: saved, allowedRoots: [configured] }, cwd),
  cwd,
);
