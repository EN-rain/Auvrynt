import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../infrastructure/config.js";
import { WorkspaceRegistry } from "../workspace/workspaces.js";
import { ProcessManager } from "./processes.js";
import { startDevServer } from "../integrations/playwright/web-tools.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-ownership-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace: ws } = await registry.openWorkspace(root);
  const manager = new ProcessManager(registry);

  const echoCmd = process.platform === "win32"
    ? "echo Hello"
    : "echo Hello";

  const ownerA = "client-A";
  const ownerB = "client-B";

  const procA = manager.startProcess({
    workspaceId: ws.id,
    command: echoCmd,
    ownerClientId: ownerA,
  });
  assert.equal(procA.status, "running");

  await new Promise((r) => setTimeout(r, 500));

  const listB = manager.listProcesses({ workspaceId: ws.id, ownerClientId: ownerB });
  assert.equal(listB.length, 0);

  assert.throws(
    () => manager.getProcessLogs({ workspaceId: ws.id, processId: procA.processId, ownerClientId: ownerB }),
    /does not belong to this client/,
  );

  await assert.rejects(
    () => manager.stopProcess({ workspaceId: ws.id, processId: procA.processId, ownerClientId: ownerB }),
    /does not belong to this client/,
  );

  const listA = manager.listProcesses({ workspaceId: ws.id, ownerClientId: ownerA });
  assert.equal(listA.length, 1);
  assert.equal(listA[0].processId, procA.processId);

  const logsA = manager.getProcessLogs({ workspaceId: ws.id, processId: procA.processId, ownerClientId: ownerA });
  assert.ok(logsA.lines.length > 0);

  const stopA = await manager.stopProcess({ workspaceId: ws.id, processId: procA.processId, ownerClientId: ownerA });
  assert.equal(stopA.stopped, true);

  const legacy = manager.startProcess({
    workspaceId: ws.id,
    command: echoCmd,
  });
  assert.equal(legacy.status, "running");
  await new Promise((r) => setTimeout(r, 200));

  const listAll = manager.listProcesses({ workspaceId: ws.id });
  assert.ok(listAll.some((p) => p.processId === legacy.processId));

  await manager.stopProcess({ workspaceId: ws.id, processId: legacy.processId });

  const devServer = await startDevServer(
    registry,
    manager,
    { workspaceId: ws.id, command: echoCmd },
    ownerA,
  );
  const trackedDevServer = manager.getTrackedProcess(ws.id, devServer.processId, ownerA);
  assert.equal(trackedDevServer.ownerClientId, ownerA);
  assert.throws(
    () => manager.getTrackedProcess(ws.id, devServer.processId, ownerB),
    /does not belong to this client/,
  );
  await manager.stopProcess({ workspaceId: ws.id, processId: devServer.processId, ownerClientId: ownerA });

  const ownerCheckProc = manager.startProcess({
    workspaceId: ws.id,
    command: echoCmd,
    ownerClientId: ownerA,
  });
  await new Promise((r) => setTimeout(r, 200));

  assert.throws(
    () => manager.getTrackedProcess(ws.id, ownerCheckProc.processId, ownerB),
    /does not belong to this client/,
  );

  const tracked = manager.getTrackedProcess(ws.id, ownerCheckProc.processId, ownerA);
  assert.equal(tracked.ownerClientId, ownerA);

  const trackedNoOwner = manager.getTrackedProcess(ws.id, ownerCheckProc.processId);
  assert.equal(trackedNoOwner.ownerClientId, ownerA);

  await manager.stopProcess({ workspaceId: ws.id, processId: ownerCheckProc.processId, ownerClientId: ownerA });
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Process ownership tests passed!");
