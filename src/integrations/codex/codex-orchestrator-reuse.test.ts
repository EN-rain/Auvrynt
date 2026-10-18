import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexOrchestrator } from "./codex-orchestrator.js";

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-codex-reuse-"));
const orchestrator = new CodexOrchestrator(stateDir);
const client = orchestrator.client as any;
const threads = new Map<string, Record<string, unknown>>();
const turnTasks: string[] = [];
let threadCounter = 0;
let turnCounter = 0;
let startThreadCalls = 0;

client.ensureStarted = async () => undefined;
client.startThread = async () => {
  startThreadCalls++;
  const id = `thread-${++threadCounter}`;
  threads.set(id, {
    id,
    name: null,
    ephemeral: false,
    historyMode: "legacy",
    parentThreadId: null,
    source: "cli",
    path: join(stateDir, `${id}.jsonl`),
    turns: [],
  });
  return { thread: { id } };
};
client.setThreadName = async (threadId: string, name: string) => {
  const thread = threads.get(threadId);
  if (!thread) throw new Error("missing fake thread");
  thread.name = name;
};
client.readThread = async (threadId: string) => {
  const thread = threads.get(threadId);
  if (!thread) throw new Error("missing fake thread");
  return { thread: { ...thread } };
};
client.startTurn = async (input: { task: string }) => {
  turnTasks.push(input.task);
  return { turn: { id: `turn-${++turnCounter}`, status: "inProgress" } };
};
client.deleteThread = async (threadId: string) => {
  threads.delete(threadId);
};

const finish = (threadId: string, turnId: string | undefined) => {
  (orchestrator as any).handleNotification({
    method: "turn/completed",
    params: {
      threadId,
      turnId,
      turn: { id: turnId, status: "completed", items: [] },
    },
  });
};

try {
  const firstRun = orchestrator.createRun({
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    parentMcpSessionId: "mcp-a",
    parentLogicalSessionId: "chat-a",
    goal: "first task",
  });
  const first = await orchestrator.spawnAgent({
    ownerClientId: "owner-a",
    runId: firstRun.runId,
    workspaceId: "ws-a",
    cwd: stateDir,
    role: "implementation",
    task: "Implement the first thing",
  });
  assert.equal(startThreadCalls, 1);
  assert.equal(first.workerId, "W1");
  assert.match(turnTasks[0]!, /Current assignment:\nImplement the first thing/);
  finish(first.threadId, first.currentTurnId);

  const secondRun = orchestrator.createRun({
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    parentMcpSessionId: "mcp-b",
    parentLogicalSessionId: "chat-a",
    goal: "second task",
  });
  const second = await orchestrator.spawnAgent({
    ownerClientId: "owner-a",
    runId: secondRun.runId,
    workspaceId: "ws-a",
    cwd: stateDir,
    role: "test",
    task: "Verify the second thing",
  });
  assert.equal(startThreadCalls, 1, "same Sol conversation and worker lane should reuse the visible Codex chat");
  assert.equal(second.threadId, first.threadId);
  assert.equal(second.workerId, "W1");
  assert.match(turnTasks[1]!, /Focus on reproducible verification/);
  finish(second.threadId, second.currentTurnId);

  const thirdRun = orchestrator.createRun({
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    parentMcpSessionId: "mcp-c",
    parentLogicalSessionId: "chat-b",
    goal: "separate conversation",
  });
  const third = await orchestrator.spawnAgent({
    ownerClientId: "owner-a",
    runId: thirdRun.runId,
    workspaceId: "ws-a",
    cwd: stateDir,
    role: "implementation",
    task: "Do not reuse across ChatGPT conversations",
  });
  assert.equal(startThreadCalls, 2, "different Sol conversations must not share a Codex chat");
  assert.notEqual(third.threadId, first.threadId);
  finish(third.threadId, third.currentTurnId);

  console.log("Codex orchestrator reuse tests passed!");
} finally {
  await orchestrator.shutdown();
  rmSync(stateDir, { recursive: true, force: true });
}
