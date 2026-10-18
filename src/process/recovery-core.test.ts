import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RecoveryCoordinator,
  RecoveryRequiredError,
  replayPolicyForAnnotations,
} from "./recovery-core.js";

assert.equal(replayPolicyForAnnotations({ readOnlyHint: true }), "SAFE_REPLAY");
assert.equal(replayPolicyForAnnotations({ idempotentHint: true }), "SAFE_REPLAY");
assert.equal(replayPolicyForAnnotations({ destructiveHint: true }), "NEVER_BLIND_REPLAY");
assert.equal(replayPolicyForAnnotations({ readOnlyHint: false }), "VERIFY_BEFORE_REPLAY");

const stateDir = await mkdtemp(join(tmpdir(), "auvrynt-recovery-core-"));
try {
  const crashed = new RecoveryCoordinator(stateDir, { instanceId: "instance_crashed", pid: 999_999_999 });
  const pending = await crashed.beginToolCall({
    workspaceId: "workspace-a",
    integration: "blender",
    toolName: "blender_save_file_as",
    input: {
      workspaceId: "workspace-a",
      taskId: "task-should-not-be-file-identity",
      filePath: "assets/character_master.blend",
      password: "must-not-be-journaled",
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  });
  assert.ok(pending);

  const recovered = new RecoveryCoordinator(stateDir, { instanceId: "instance_recovered", pid: process.pid });
  const status = await recovered.status("workspace-a");
  assert.equal(status.state, "RECOVERY_REQUIRED");
  assert.equal(status.safeToResumeMutations, false);
  assert.equal(status.unknownActions.length, 1);
  assert.equal(status.unknownActions[0]?.replayPolicy, "NEVER_BLIND_REPLAY");
  assert.equal(status.unknownActions[0]?.targetHints.filePath, "assets/character_master.blend");
  assert.equal("taskId" in (status.unknownActions[0]?.targetHints ?? {}), false);
  assert.equal("password" in (status.unknownActions[0]?.targetHints ?? {}), false);

  await assert.rejects(
    () => recovered.beginToolCall({
      workspaceId: "workspace-a",
      integration: "krita",
      toolName: "krita_save",
      input: { workspaceId: "workspace-a", filePath: "art/main.kra" },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    }),
    (error: unknown) => error instanceof RecoveryRequiredError && /unknown outcome/i.test(error.message),
  );

  const reconciled = await recovered.reconcile({
    workspaceId: "workspace-a",
    actionId: status.unknownActions[0]!.actionId,
    expectedRecoveryGeneration: status.recoveryGeneration,
    outcome: "verified_applied",
    evidence: "Verified the exact .blend destination exists and Blender reports that same file as current.",
  });
  assert.equal(reconciled.state, "READY");
  assert.equal(reconciled.safeToResumeMutations, true);
  assert.equal(reconciled.unknownActions.length, 0);
  assert.equal(reconciled.recoveryGeneration, status.recoveryGeneration + 1);

  const next = await recovered.beginToolCall({
    workspaceId: "workspace-a",
    integration: "godot",
    toolName: "godot_import_assets",
    input: { workspaceId: "workspace-a", projectPath: "game" },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  });
  assert.ok(next);
  await recovered.finishToolCall("workspace-a", next!.actionId);
  const healthy = await recovered.status("workspace-a");
  assert.equal(healthy.unknownActions.length, 0);
  assert.equal(healthy.inFlightActions.length, 0);

  const readOnly = await recovered.beginToolCall({
    workspaceId: "workspace-a",
    integration: "serena",
    toolName: "serena_find_symbol",
    input: { workspaceId: "workspace-a" },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  });
  assert.equal(readOnly, undefined);
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

const splitBrainDir = await mkdtemp(join(tmpdir(), "auvrynt-recovery-lease-"));
try {
  const owner = new RecoveryCoordinator(splitBrainDir, { instanceId: "instance_owner", pid: process.pid });
  const owned = await owner.beginToolCall({
    workspaceId: "workspace-b",
    integration: "desktop",
    toolName: "desktop_mouse_click",
    input: { workspaceId: "workspace-b" },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  });
  assert.ok(owned);

  const contender = new RecoveryCoordinator(splitBrainDir, { instanceId: "instance_contender", pid: process.pid });
  await assert.rejects(
    () => contender.beginToolCall({
      workspaceId: "workspace-b",
      integration: "blender",
      toolName: "blender_save_file_as",
      input: { workspaceId: "workspace-b", filePath: "scene.blend" },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    }),
    (error: unknown) => error instanceof RecoveryRequiredError && /split-brain mutation/i.test(error.message),
  );

  await owner.finishToolCall("workspace-b", owned!.actionId);
} finally {
  await rm(splitBrainDir, { recursive: true, force: true });
}

const disconnectDir = await mkdtemp(join(tmpdir(), "auvrynt-recovery-disconnect-"));
try {
  const coordinator = new RecoveryCoordinator(disconnectDir, { instanceId: "instance_live", pid: process.pid });
  const pending = await coordinator.beginToolCall({
    workspaceId: "workspace-c",
    sessionId: "session-c",
    integration: "krita",
    toolName: "krita_save",
    input: { workspaceId: "workspace-c", filePath: "art/main.kra" },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  });
  assert.ok(pending);

  assert.equal(await coordinator.markSessionDisconnected("workspace-c", "session-c"), 1);
  await coordinator.finishToolCall("workspace-c", pending!.actionId);

  const disconnected = await coordinator.status("workspace-c");
  assert.equal(disconnected.state, "RECOVERY_REQUIRED");
  assert.equal(disconnected.unknownActions.length, 1);
  assert.equal(disconnected.unknownActions[0]?.state, "delivery_unknown");
  assert.equal(disconnected.safeToResumeMutations, false);

  await assert.rejects(
    () => coordinator.beginToolCall({
      workspaceId: "workspace-c",
      sessionId: "session-new",
      integration: "blender",
      toolName: "blender_save_file_as",
      input: { workspaceId: "workspace-c", filePath: "scene.blend" },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    }),
    (error: unknown) => error instanceof RecoveryRequiredError && /unknown outcome/i.test(error.message),
  );

  const reconciled = await coordinator.reconcile({
    workspaceId: "workspace-c",
    actionId: disconnected.unknownActions[0]!.actionId,
    expectedRecoveryGeneration: disconnected.recoveryGeneration,
    outcome: "verified_applied",
    evidence: "Verified the exact target document and saved file after reconnect.",
  });
  assert.equal(reconciled.state, "READY");
  assert.equal(reconciled.safeToResumeMutations, true);
} finally {
  await rm(disconnectDir, { recursive: true, force: true });
}

console.log("Recovery core tests passed!");
