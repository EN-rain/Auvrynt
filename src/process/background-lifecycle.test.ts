import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  acquireManagementLock,
  getProcessIdentity,
  INTEGRATION_KEYS,
  parseIntegrationProfiles,
  parseStartRequest,
  profilesFromIntegrationConfig,
  resolveSavedWorkspaceRoot,
  processIdentityMatches,
  rotateLogFile,
} from "./background-lifecycle.js";

assert.deepEqual(parseIntegrationProfiles(["model, web", "godotcs"]), ["blender", "playwright", "godotCsharp"]);
assert.deepEqual(parseIntegrationProfiles(["web model"]), ["playwright", "blender"]);
assert.deepEqual(parseIntegrationProfiles(["se", "serena"]), ["serena"]);
assert.deepEqual(parseIntegrationProfiles(["godotGdscript", "godotCsharp", "playwright"]), ["godotGdscript", "godotCsharp", "playwright"]);
assert.deepEqual(parseIntegrationProfiles(["desktop,krita"]), ["desktop", "krita"]);
assert.deepEqual(parseIntegrationProfiles(["desktop-use", "computer-use", "desktopuse", "computeruse"]), ["desktop"]);
assert.deepEqual(parseIntegrationProfiles(["screen", "paint"]), ["desktop", "krita"]);
assert.deepEqual(parseIntegrationProfiles(["openpencil", "open-pencil", "pencil"]), ["openPencil"]);
assert.equal(INTEGRATION_KEYS.includes("openPencil"), true);
assert.deepEqual(profilesFromIntegrationConfig({ openPencil: true, serena: false }), ["openPencil"]);
assert.equal(INTEGRATION_KEYS.includes("context7" as never), false);
assert.equal(INTEGRATION_KEYS.includes("obsidian" as never), false);
assert.throws(() => parseIntegrationProfiles(["context7"]), /Unknown start profile/);
assert.throws(() => parseIntegrationProfiles(["obsidian"]), /Unknown start profile/);
assert.deepEqual(parseStartRequest(["model", "--replace"]), {
  profiles: ["blender"],
  replace: true,
  backgroundChild: false,
});
assert.deepEqual(parseStartRequest([]), {
  profiles: undefined,
  replace: false,
  backgroundChild: false,
});
assert.deepEqual(parseStartRequest(["--no-integrations", "--background-child"]).profiles, []);
assert.deepEqual(profilesFromIntegrationConfig({ desktop: true, krita: true }), ["serena", "desktop", "krita"]);
assert.deepEqual(profilesFromIntegrationConfig(undefined), ["serena"]);
const savedWorkspaceRoot = resolve(process.cwd(), "saved-project");
const olderWorkspaceRoot = resolve(process.cwd(), "older-project");
const currentWorkspaceRoot = resolve(process.cwd(), "current-project");
assert.equal(
  resolveSavedWorkspaceRoot({ workspaceRoot: savedWorkspaceRoot, allowedRoots: [olderWorkspaceRoot] }, currentWorkspaceRoot),
  savedWorkspaceRoot,
);
assert.equal(
  resolveSavedWorkspaceRoot({ allowedRoots: [olderWorkspaceRoot] }, currentWorkspaceRoot),
  olderWorkspaceRoot,
);
assert.throws(() => parseStartRequest(["model", "--no-integrations"]), /Do not combine/);
assert.throws(() => parseIntegrationProfiles(["unknown"]), /Unknown start profile/);
assert.throws(() => parseStartRequest(["--unknown"]), /Unknown start option/);

const lifecycleSource = await readFile(new URL("../cli/lifecycle-manager.ts", import.meta.url), "utf8");
const hardRestartStart = lifecycleSource.indexOf("if (hard) {");
const normalRestartStart = lifecycleSource.indexOf("\n    const config = loadConfig();", hardRestartStart);
const hardRestartBlock = hardRestartStart >= 0 && normalRestartStart >= 0
  ? lifecycleSource.slice(hardRestartStart, normalRestartStart)
  : "";
assert.ok(hardRestartBlock, "hard-restart implementation must remain discoverable");
assert.doesNotMatch(hardRestartBlock, /await stop\(\)/, "hard restart should use the locked lifecycle path directly");
assert.match(hardRestartBlock, /await stopActiveInstance\(active\)/);
assert.match(hardRestartBlock, /await stopManagedTunnel/,
  "hard restart must destroy the managed tunnel so startup receives a fresh public URL");
assert.match(hardRestartBlock, /await runBackgroundStartUnlocked/);

const identity = getProcessIdentity(process.pid);
assert.ok(identity);
assert.equal(processIdentityMatches(process.pid, identity), true);
assert.equal(processIdentityMatches(process.pid, { ...identity, processStartedAt: "2000-01-01T00:00:00.000Z" }), false);

const stateDir = await mkdtemp(join(tmpdir(), "auvrynt-lifecycle-"));
try {
  const first = await acquireManagementLock(stateDir);
  await assert.rejects(() => acquireManagementLock(stateDir), /lifecycle command is already running/);
  await first.release();
  const second = await acquireManagementLock(stateDir);
  await second.release();
  await writeFile(join(stateDir, "manager.lock"), "{stale");
  const recovered = await acquireManagementLock(stateDir);
  await recovered.release();

  const logPath = join(stateDir, "auvrynt.log");
  await writeFile(logPath, "123456");
  await rotateLogFile(logPath, 5);
  assert.equal(await readFile(`${logPath}.1`, "utf8"), "123456");
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
