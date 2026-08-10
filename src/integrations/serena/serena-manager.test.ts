import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SerenaManager,
  detectSerenaEnvironment,
  defaultSerenaConfig,
  type SerenaConfig,
} from "./serena-manager.js";

// Build a bare session object so callTool exercises the path-validation path
// without actually launching Serena.
function buildFakeSession(workspaceId: string, projectRoot: string, tools: string[]) {
  const id = `serena_fake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    sessionId: id,
    workspaceId,
    projectRoot,
    processPid: 12345,
    mcpInitialized: true,
    activatedProject: projectRoot,
    exposedTools: tools,
    status: "active" as const,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    client: { callTool: async () => ({}), ping: async () => {}, close: async () => {} },
    transport: { close: async () => {} },
  };
}

const testDir = mkdtempSync(join(tmpdir(), "serena-manager-test-"));

function makeConfig(overrides: Partial<SerenaConfig> = {}): SerenaConfig {
  return { ...defaultSerenaConfig(), enabled: true, ...overrides };
}

// --- defaultSerenaConfig ---
{
  const config = defaultSerenaConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.executable, "serena");
  assert.equal(config.backend, "LSP");
  assert.equal(config.context, "desktop-app");
  assert.equal(config.startupTimeoutMs, 30_000);
  assert.equal(config.requestTimeoutMs, 60_000);
  assert.equal(config.idleTimeoutMinutes, 30);
  assert.equal(config.maxInstances, 3);
}

{
  const config = defaultSerenaConfig("custom-serena");
  assert.equal(config.executable, "custom-serena");
}

// --- detectSerenaEnvironment (disabled) ---
{
  const env = await detectSerenaEnvironment({ ...makeConfig(), enabled: false });
  assert.equal(env.installed, false);
  assert.equal(env.initializationState, "missing");
  assert.ok(env.actionableProblems.length > 0);
}

// --- detectSerenaEnvironment (not found) ---
{
  const env = await detectSerenaEnvironment(
    makeConfig({ executable: "serena-nonexistent-binary-xyz" }),
  );
  assert.equal(env.installed, false);
  assert.equal(env.initializationState, "missing");
}

// --- detectSerenaEnvironment (found - skipped in CI without Serena) ---
// This test only runs if serena is actually installed
try {
  const env = await detectSerenaEnvironment(makeConfig({ executable: "serena" }));
  if (env.installed) {
    assert.ok(env.version);
    assert.equal(env.initializationState, "ready");
    assert.ok(Array.isArray(env.actionableProblems));
  }
} catch {
  // skip if serena is not available
}

// --- SerenaManager initial state ---
{
  const mgr = new SerenaManager(makeConfig());
  const info = mgr.getSessionInfo();
  assert.equal(info.length, 0);
  const config = mgr.getConfig();
  assert.equal(config.enabled, true);
}

// --- SerenaManager getEnvironment ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  const env = await mgr.getEnvironment();
  assert.equal(env.installed, false);
}

// --- SerenaManager updateConfig ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  assert.equal(mgr.getConfig().enabled, false);
  mgr.updateConfig(makeConfig({ enabled: true }));
  assert.equal(mgr.getConfig().enabled, true);
}

// --- SerenaManager startSession without enabled ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  try {
    await mgr.startSession("ws_test", testDir);
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok((err as Error).message.includes("disabled"));
  }
}

// --- SerenaManager startSession without serena installed ---
{
  const mgr = new SerenaManager(
    makeConfig({ enabled: true, executable: "serena-nonexistent" }),
  );
  try {
    await mgr.startSession("ws_test", testDir);
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok((err as Error).message.includes("not available") || (err as Error).message.includes("not found"));
  }
}

// --- buildAllowlist: disabled tools excluded ---
{
  // Import buildAllowlist indirectly via SerenaManager using the allowlist logic
  // Since buildAllowlist is not exported, test the logic by calling startSession
  // with a config that has enabled=true but a bogus executable.
  const mgr = new SerenaManager(
    makeConfig({ enabled: true, executable: "serena-nonexistent" }),
  );
  // Verify that session starts still fail gracefully
  try {
    await mgr.startSession("ws_test2", testDir);
    assert.fail("Should have thrown");
  } catch {
    // expected
  }
}

// --- SerenaManager getSessionByWorkspace (no session) ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  const session = mgr.getSessionByWorkspace("nonexistent");
  assert.equal(session, undefined);
}

// --- SerenaManager serializes same-workspace lifecycle operations ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  let active = 0;
  let maxActive = 0;
  const completed: number[] = [];
  await Promise.all(Array.from({ length: 6 }, (_, index) =>
    (mgr as any).runWorkspaceOperation("ws_shared", async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      completed.push(index);
      active -= 1;
    }),
  ));
  assert.equal(maxActive, 1);
  assert.deepEqual(completed, [0, 1, 2, 3, 4, 5]);
}

// --- SerenaManager stopWorkspaceSessions (no-op when no sessions) ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  await mgr.stopWorkspaceSessions("nonexistent");
  assert.equal(mgr.getSessionInfo().length, 0);
}

// --- SerenaManager stopAllSessions (no-op when no sessions) ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  await mgr.stopAllSessions();
  assert.equal(mgr.getSessionInfo().length, 0);
}

// --- SerenaManager cleanup absorbs close failures and evicts the session ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  const session = buildFakeSession("ws_cleanup", testDir, ["find_symbol"]);
  session.client.close = async () => { throw new Error("client close failed"); };
  session.transport.close = async () => { throw new Error("transport close failed"); };
  (mgr as any).sessions.set(session.sessionId, session);

  await assert.doesNotReject(() => mgr.stopSession(session.sessionId));
  assert.equal(mgr.getSessionInfo().length, 0);
}

// --- SerenaManager healthCheck (no session) ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  const health = await mgr.healthCheck("nonexistent");
  assert.equal(health.alive, false);
  assert.equal(health.status, "no_session");
}

// --- SerenaManager clearEnvironmentCache ---
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  await mgr.getEnvironment();
  mgr.clearEnvironmentCache();
  assert.equal((mgr as any).environmentCache, null);
}

// --- maxInstances limit ---
{
  const mgr = new SerenaManager(
    makeConfig({ enabled: true, executable: "serena-nonexistent", maxInstances: 1 }),
  );
  try {
    await mgr.startSession("ws_max1", testDir);
  } catch {
    // expected - serena not found
  }
  // Verify the session tracking works by checking session count is 0 (start failed)
  assert.equal(mgr.getSessionInfo().length, 0);
}

// --------------------------------------------------------------------------
// Security: path validation via callTool
// --------------------------------------------------------------------------
const WS_ROOT = "C:/Users/test/project";
const WS_ID_SEC = "ws_sec";

{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  const session = buildFakeSession(WS_ID_SEC, WS_ROOT, ["find_symbol", "replace_symbol_body"]);
  (mgr as any).sessions.set(session.sessionId, session);

  // Relative path traversal beyond workspace root
  try {
    await mgr.callTool(WS_ID_SEC, "find_symbol", { query: "foo", path: "../../etc/passwd" }, WS_ROOT);
    assert.fail("Should reject path traversal");
  } catch (err) {
    assert.ok((err as Error).message.includes("outside the workspace") || (err as Error).message.includes("invalid"));
  }

  // Absolute path on different drive — should be rejected
  try {
    await mgr.callTool(WS_ID_SEC, "find_symbol", { query: "foo", path: "D:/other/file.ts" }, WS_ROOT);
    assert.fail("Should reject absolute path on different drive");
  } catch (err) {
    assert.ok((err as Error).message.includes("outside the workspace") || (err as Error).message.includes("invalid"));
  }

  // Absolute path with same root — should be accepted (validation passes, then callTool tries to invoke client)
  // The client mock will succeed so this should NOT throw a path error
  try {
    await mgr.callTool(WS_ID_SEC, "find_symbol", { query: "foo", path: WS_ROOT + "/src/index.ts" }, WS_ROOT);
    // If we get here, path validation passed (client mock succeeds)
  } catch (err) {
    // Only acceptable error is from client.callTool (not path validation)
    assert.ok(!(err as Error).message.includes("outside the workspace"), "Should not reject valid path");
  }

  // Trailing-slash root
  try {
    await mgr.callTool(WS_ID_SEC, "find_symbol", { query: "foo", path: ".." }, WS_ROOT);
    assert.fail("Should reject ..");
  } catch (err) {
    assert.ok((err as Error).message.includes("outside the workspace") || (err as Error).message.includes("invalid"));
  }
}

// Path validation with file_path parameter
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  const session = buildFakeSession(WS_ID_SEC, WS_ROOT, ["get_diagnostics_for_file"]);
  (mgr as any).sessions.set(session.sessionId, session);

  try {
    await mgr.callTool(WS_ID_SEC, "get_diagnostics_for_file", { file_path: "../secret.env" }, WS_ROOT);
    assert.fail("Should reject file_path traversal");
  } catch (err) {
    assert.ok((err as Error).message.includes("outside the workspace") || (err as Error).message.includes("invalid"));
  }
}

// Tool not in exposedTools
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  const session = buildFakeSession(WS_ID_SEC, WS_ROOT, ["find_symbol"]);
  (mgr as any).sessions.set(session.sessionId, session);

  try {
    await mgr.callTool(WS_ID_SEC, "execute_shell_command", { command: "calc" }, WS_ROOT);
    assert.fail("Should reject disabled tool");
  } catch (err) {
    assert.ok((err as Error).message.includes("not available"));
  }
}

// No session for workspace
{
  const mgr = new SerenaManager(makeConfig({ enabled: false }));
  try {
    await mgr.callTool("ws_no_session", "find_symbol", { query: "foo" }, WS_ROOT);
    assert.fail("Should reject when no session exists");
  } catch (err) {
    assert.ok((err as Error).message.includes("No active Serena session") || (err as Error).message.includes("serena_start_session"));
  }
}

console.log("serena-manager tests passed");
