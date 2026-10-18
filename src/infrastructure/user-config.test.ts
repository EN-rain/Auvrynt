import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAuvryntFiles,
  writeAuvryntAuth,
  writeAuvryntConfig,
} from "./user-config.js";

const configDir = mkdtempSync(join(tmpdir(), "auvrynt-user-config-test-"));
const env = { AUVRYNT_CONFIG_DIR: configDir };

writeAuvryntConfig({
  host: "127.0.0.1",
  port: 49321,
  allowedRoots: [process.cwd()],
  workspaceRoot: process.cwd(),
  maxSessions: 3,
  maxSessionsPerClient: 2,
  integrations: {
    godotGdscript: false,
    godotCsharp: true,
    blender: false,
    aseprite: true,
    serena: true,
    playwright: true,
  },
  serena: {
    enabled: true,
    backend: "LSP",
    maxInstances: 2,
  },
}, env);
writeAuvryntAuth({ ownerToken: "test-owner-token-that-is-long-enough" }, env);

const loaded = loadAuvryntFiles(env);
assert.equal(loaded.config.port, 49321);
assert.equal(loaded.config.workspaceRoot, process.cwd());
assert.equal(loaded.config.maxSessions, 3);
assert.equal(loaded.config.maxSessionsPerClient, 2);
assert.equal(loaded.config.integrations?.blender, false);
assert.equal(loaded.config.integrations?.aseprite, true);
assert.equal(loaded.config.serena?.maxInstances, 2);
assert.equal(loaded.auth.ownerToken, "test-owner-token-that-is-long-enough");
assert.equal(readdirSync(configDir).some((name) => name.endsWith(".tmp")), false);

const legacyDir = mkdtempSync(join(tmpdir(), "auvrynt-legacy-config-test-"));
const legacyEnv = { AUVRYNT_CONFIG_DIR: legacyDir };
writeFileSync(join(legacyDir, "config.json"), JSON.stringify({
  allowedRoots: [process.cwd()],
  integrations: { serena: false, context7: false, obsidian: false },
  obsidian: { enabled: true, vaultPath: "C:/legacy-vault" },
}));
writeFileSync(join(legacyDir, "auth.json"), JSON.stringify({
  ownerToken: "test-owner-token-that-is-long-enough",
  context7ApiKey: "legacy-context7-key",
}));
const migrated = loadAuvryntFiles(legacyEnv);
assert.equal("context7" in migrated.config.integrations!, false);
assert.equal("obsidian" in migrated.config, false);
assert.equal("context7ApiKey" in migrated.auth, false);
const migratedConfig = JSON.parse(readFileSync(migrated.configPath, "utf8")) as Record<string, unknown>;
const migratedAuth = JSON.parse(readFileSync(migrated.authPath, "utf8")) as Record<string, unknown>;
assert.equal("obsidian" in migratedConfig, false);
assert.equal("context7" in (migratedConfig.integrations as Record<string, unknown>), false);
assert.equal("context7ApiKey" in migratedAuth, false);

if (process.platform !== "win32") {
  assert.equal(statSync(configDir).mode & 0o777, 0o700);
  assert.equal(statSync(loaded.authPath).mode & 0o777, 0o600);
}

writeFileSync(loaded.configPath, JSON.stringify({ integrations: { playwright: "yes" } }));
assert.throws(
  () => loadAuvryntFiles(env),
  /playwright: Invalid input: expected boolean/i,
);

writeFileSync(loaded.configPath, JSON.stringify({ port: 70000 }));
assert.throws(
  () => loadAuvryntFiles(env),
  /port: Too big|port:.*65535/i,
);

writeFileSync(loaded.configPath, JSON.stringify({ maxSessions: 257 }));
assert.throws(
  () => loadAuvryntFiles(env),
  /maxSessions: Too big|maxSessions:.*256/i,
);
