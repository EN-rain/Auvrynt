import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../infrastructure/config.js";
import { WorkspaceRegistry } from "../workspace/workspaces.js";
import { ProcessManager, redactProcessText, sanitizeEnv } from "./processes.js";

const root1 = await mkdtemp(join(tmpdir(), "auvrynt-proc-test1-"));
const root2 = await mkdtemp(join(tmpdir(), "auvrynt-proc-test2-"));

async function waitForLog(
  manager: ProcessManager,
  workspaceId: string,
  processId: string,
  predicate: (line: string) => boolean,
  timeoutMs = 10_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let lines: string[] = [];
  while (Date.now() < deadline) {
    lines = manager.getProcessLogs({ workspaceId, processId }).lines;
    if (lines.some(predicate)) return lines;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return lines;
}

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: `${root1},${root2}`,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace: ws1 } = await registry.openWorkspace(root1);
  const { workspace: ws2 } = await registry.openWorkspace(root2);

  const manager = new ProcessManager(registry);

  // 1. Environment secret redaction
  const sanitized = sanitizeEnv({
    API_KEY: "secret_123",
    DATABASE_CONNECTION_STRING: "Server=myServerAddress;",
    USER_PASSWORD: "superpassword",
    AUTH_TOKEN: "bearer_xyz",
    NORMAL_VAR: "normal_value",
  });
  assert.equal(sanitized.API_KEY, "[REDACTED]");
  assert.equal(sanitized.DATABASE_CONNECTION_STRING, "[REDACTED]");
  assert.equal(sanitized.USER_PASSWORD, "[REDACTED]");
  assert.equal(sanitized.AUTH_TOKEN, "[REDACTED]");
  assert.equal(sanitized.NORMAL_VAR, "normal_value");
  assert.equal(
    redactProcessText("token=secret_123 normal=normal_value", { API_KEY: "secret_123" }),
    "token=[REDACTED] normal=normal_value",
  );
  assert.equal(
    redactProcessText("Authorization: Bearer abcdef123456"),
    "Authorization: Bearer [REDACTED]",
  );
  assert.equal(
    redactProcessText("password=hunter2 DATABASE_URL=postgres://secret-host/db"),
    "password=[REDACTED] DATABASE_URL=[REDACTED]",
  );
  assert.equal(
    redactProcessText("tool --token abcdef123 https://user:pass@example.com"),
    "tool --token [REDACTED] https://user:[REDACTED]@example.com",
  );

  // 2. Start process lifecycle
  const command = process.platform === "win32" ? "echo Hello Process && echo Server running on http://127.0.0.1:8080" : "echo 'Hello Process' && echo 'Server running on http://127.0.0.1:8080'";
  const startResult = manager.startProcess({
    workspaceId: ws1.id,
    command,
  });

  assert.match(startResult.processId, /^proc_/);
  assert.equal(startResult.status, "running");

  // Allow process output to arrive
  await new Promise((res) => setTimeout(res, 500));

  // 3. List processes
  const list = manager.listProcesses({ workspaceId: ws1.id });
  assert.equal(list.length, 1);
  assert.equal(list[0].processId, startResult.processId);

  // 4. Get process logs
  const logs = manager.getProcessLogs({
    workspaceId: ws1.id,
    processId: startResult.processId,
  });
  assert.ok(logs.lines.length > 0);
  assert.ok(logs.lines.some((l) => l.includes("Hello Process")));

  // 5. Workspace isolation check
  assert.throws(
    () => manager.getProcessLogs({ workspaceId: ws2.id, processId: startResult.processId }),
    /not found in workspace/i,
  );
  await assert.rejects(
    () => manager.stopProcess({ workspaceId: ws2.id, processId: startResult.processId }),
    /not found in workspace/i,
  );

  // 6. Stop process
  const stopResult = await manager.stopProcess({
    workspaceId: ws1.id,
    processId: startResult.processId,
  });
  assert.equal(stopResult.stopped, true);

  // 7. Simple Node commands run without a Windows shell window.
  const nodeResult = manager.startProcess({
    workspaceId: ws1.id,
    command: `node -e "console.log('Hidden Node Process')"`,
  });
  await new Promise((res) => setTimeout(res, 500));
  const nodeLogs = manager.getProcessLogs({ workspaceId: ws1.id, processId: nodeResult.processId });
  assert.ok(nodeLogs.lines.some((line) => line.includes("Hidden Node Process")));
  await manager.stopProcess({ workspaceId: ws1.id, processId: nodeResult.processId });

  if (process.platform === "win32") {
    const uncResult = manager.startProcess({
      workspaceId: ws1.id,
      command: 'node -e "console.log(process.argv[1])" "\\\\server\\share"',
    });
    const uncLines = await waitForLog(
      manager,
      ws1.id,
      uncResult.processId,
      (line) => line.includes("\\\\server\\share"),
    );
    assert.ok(uncLines.some((line) => line.includes("\\\\server\\share")));
    await manager.stopProcess({ workspaceId: ws1.id, processId: uncResult.processId });

    const envResult = manager.startProcess({
      workspaceId: ws1.id,
      command: `node -e "console.log(process.argv[1])" "%TEMP%"`,
    });
    assert.ok(process.env.TEMP);
    const envLines = await waitForLog(
      manager,
      ws1.id,
      envResult.processId,
      (line) => line.includes(process.env.TEMP!),
    );
    assert.ok(envLines.some((line) => line.includes(process.env.TEMP!)));
    assert.ok(envLines.every((line) => !line.includes("%TEMP%")));
    await manager.stopProcess({ workspaceId: ws1.id, processId: envResult.processId });

    const powershellResult = manager.startProcess({
      workspaceId: ws1.id,
      command: `powershell -NoProfile -NonInteractive -Command "Write-Output HiddenPowerShell"`,
    });
    const powershellLines = await waitForLog(
      manager,
      ws1.id,
      powershellResult.processId,
      (line) => line.includes("HiddenPowerShell"),
    );
    assert.ok(powershellLines.some((line) => line.includes("HiddenPowerShell")));
    await manager.stopProcess({ workspaceId: ws1.id, processId: powershellResult.processId });

    const npmResult = manager.startProcess({
      workspaceId: ws1.id,
      command: "npm --version",
    });
    const npmLines = await waitForLog(
      manager,
      ws1.id,
      npmResult.processId,
      (line) => /\d+\.\d+\.\d+/.test(line),
    );
    assert.ok(npmLines.some((line) => /\d+\.\d+\.\d+/.test(line)));
    await manager.stopProcess({ workspaceId: ws1.id, processId: npmResult.processId });
  }

  // 8. Invalid process ID check
  assert.throws(
    () => manager.getProcessLogs({ workspaceId: ws1.id, processId: "proc_invalid" }),
    /not found in workspace/i,
  );
  await manager.stopAllProcesses();
} finally {
  await rm(root1, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(root2, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
