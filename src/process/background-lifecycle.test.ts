import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireManagementLock,
  getProcessIdentity,
  parseIntegrationProfiles,
  parseStartRequest,
  processIdentityMatches,
  rotateLogFile,
} from "./background-lifecycle.js";

assert.deepEqual(parseIntegrationProfiles(["model, web", "godotcs"]), ["blender", "playwright", "godotCsharp"]);
assert.deepEqual(parseIntegrationProfiles(["web model"]), ["playwright", "blender"]);
assert.deepEqual(parseIntegrationProfiles(["se", "serena"]), ["serena"]);
assert.deepEqual(parseIntegrationProfiles(["godotGdscript", "godotCsharp", "playwright"]), ["godotGdscript", "godotCsharp", "playwright"]);
assert.deepEqual(parseStartRequest(["model", "--replace"]), {
  profiles: ["blender"],
  replace: true,
  backgroundChild: false,
});
assert.deepEqual(parseStartRequest([]), {
  profiles: [],
  replace: false,
  backgroundChild: false,
});
assert.deepEqual(parseStartRequest(["--no-integrations", "--background-child"]).profiles, []);
assert.throws(() => parseStartRequest(["model", "--no-integrations"]), /Do not combine/);
assert.throws(() => parseIntegrationProfiles(["unknown"]), /Unknown start profile/);
assert.throws(() => parseStartRequest(["--unknown"]), /Unknown start option/);

const lifecycleSource = await readFile(new URL("./cli/lifecycle-manager.ts", import.meta.url), "utf8");
const hardRestartBlock = lifecycleSource.match(/if \(hard\) \{([\s\S]*?)\n    \}\n    const config = loadConfig\(\);/)?.[1] ?? "";
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
