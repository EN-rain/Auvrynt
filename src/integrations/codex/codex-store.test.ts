import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CodexOrchestrationStore } from "./codex-store.js";

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-codex-store-"));
const store = new CodexOrchestrationStore(stateDir);

try {
  const run = store.createRun({
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    parentMcpSessionId: "mcp-a",
    parentLogicalSessionId: "chat-a",
    goal: "parallel implementation",
  });
  assert.equal(run.state, "planning");
  assert.throws(() => store.getRunOwned(run.runId, "owner-b"), /another OAuth client/);

  const agent = store.createAgent({
    runId: run.runId,
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    threadId: "thread-a",
    role: "implementation",
    task: "implement A",
    workerId: "W1",
  });
  assert.equal(agent.state, "creating");
  assert.equal(agent.workerId, "W1");
  assert.equal(store.listActiveAgents().length, 1);
  assert.equal(store.findAgentByThread("thread-a")?.agentId, agent.agentId);
  assert.equal(store.findReusableWorkerAgent({
    runId: run.runId,
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    workerId: "W1",
  }), undefined);
  assert.throws(() => store.getAgentOwned(agent.agentId, "owner-b"), /another OAuth client/);

  store.appendEvent({
    runId: run.runId,
    agentId: agent.agentId,
    threadId: agent.threadId,
    type: "raw_notification",
    method: "orchestrator/thread-reusable",
    data: { workerId: "W1", version: 1 },
  });
  assert.equal(store.findReusableWorkerAgent({
    runId: run.runId,
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    workerId: "W1",
  })?.agentId, agent.agentId);

  const secondRun = store.createRun({
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    parentMcpSessionId: "mcp-b",
    parentLogicalSessionId: "chat-a",
    goal: "reuse worker chat",
  });
  assert.equal(store.findReusableWorkerAgent({
    runId: secondRun.runId,
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    workerId: "W1",
  })?.threadId, "thread-a");
  const otherConversation = store.createRun({
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    parentMcpSessionId: "mcp-c",
    parentLogicalSessionId: "chat-b",
    goal: "do not cross conversations",
  });
  assert.equal(store.findReusableWorkerAgent({
    runId: otherConversation.runId,
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    workerId: "W1",
  }), undefined);

  const first = store.appendEvent({
    runId: run.runId,
    agentId: agent.agentId,
    threadId: agent.threadId,
    type: "turn_started",
    method: "turn/started",
    data: { turnId: "turn-a" },
  });
  const second = store.appendEvent({
    runId: run.runId,
    agentId: agent.agentId,
    threadId: agent.threadId,
    type: "agent_message",
    method: "item/completed",
    data: { text: "done" },
  });
  assert.ok(second.sequence > first.sequence);
  assert.deepEqual(store.readEventsOwned(run.runId, "owner-a", first.sequence).map((event) => event.sequence), [second.sequence]);

  const approval = store.createApproval({
    runId: run.runId,
    agentId: agent.agentId,
    ownerClientId: "owner-a",
    threadId: agent.threadId,
    turnId: "turn-a",
    requestId: 42,
    method: "item/commandExecution/requestApproval",
    params: { command: "npm test" },
  });
  assert.equal(approval.requestId, 42);
  assert.equal(store.listPendingApprovalsOwned(run.runId, "owner-a").length, 1);
  const resolved = store.resolveApproval(approval.approvalKey, "owner-a", "declined");
  assert.equal(resolved.state, "declined");
  assert.equal(store.listPendingApprovalsOwned(run.runId, "owner-a").length, 0);

  const completedAgent = store.updateAgent(agent.agentId, "owner-a", {
    state: "completed",
    currentTurnId: null,
    resultSummary: "done",
  });
  assert.equal(completedAgent.state, "completed");
  assert.equal(completedAgent.resultSummary, "done");
  assert.ok(completedAgent.completedAt);
  assert.equal(store.listActiveAgents().length, 0);

  const completedRun = store.updateRunState(run.runId, "owner-a", "completed");
  assert.equal(completedRun.state, "completed");
  assert.ok(completedRun.completedAt);

  console.log("Codex orchestration store tests passed!");
} finally {
  store.close();
  rmSync(stateDir, { recursive: true, force: true });
}

const legacyStateDir = mkdtempSync(join(tmpdir(), "auvrynt-codex-store-legacy-"));
const legacyDb = new Database(join(legacyStateDir, "auvrynt.sqlite"));
const legacyCreatedAt = "2026-09-14T00:00:00.000Z";
legacyDb.exec(`
  pragma foreign_keys = on;
  create table codex_runs (
    id text primary key,
    owner_client_id text not null,
    workspace_id text not null,
    parent_mcp_session_id text not null,
    parent_logical_session_id text,
    goal text not null,
    state text not null,
    created_at text not null,
    updated_at text not null,
    completed_at text
  );
  create table codex_agents (
    id text primary key,
    run_id text not null references codex_runs(id) on delete cascade,
    owner_client_id text not null,
    workspace_id text not null,
    thread_id text not null unique,
    parent_thread_id text,
    role text not null,
    task text not null,
    model text,
    effort text,
    worker_id text,
    state text not null,
    current_turn_id text,
    result_summary text,
    error text,
    created_at text not null,
    updated_at text not null,
    completed_at text
  );
  create table codex_agent_events (
    sequence integer primary key autoincrement,
    run_id text not null references codex_runs(id) on delete cascade,
    agent_id text references codex_agents(id) on delete cascade,
    thread_id text,
    turn_id text,
    type text not null,
    method text not null,
    data_json text not null,
    created_at text not null
  );
  create table codex_approvals (
    id text primary key,
    run_id text not null references codex_runs(id) on delete cascade,
    agent_id text not null references codex_agents(id) on delete cascade,
    owner_client_id text not null,
    thread_id text not null,
    turn_id text,
    request_id text not null,
    method text not null,
    params_json text not null,
    state text not null,
    created_at text not null,
    resolved_at text
  );
`);
legacyDb.prepare(`
  insert into codex_runs (
    id, owner_client_id, workspace_id, parent_mcp_session_id, parent_logical_session_id,
    goal, state, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run("legacy-run", "owner-a", "ws-a", "mcp-a", "chat-a", "legacy goal", "completed", legacyCreatedAt, legacyCreatedAt);
legacyDb.prepare(`
  insert into codex_agents (
    id, run_id, owner_client_id, workspace_id, thread_id, role, task, worker_id,
    state, created_at, updated_at, completed_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  "legacy-agent",
  "legacy-run",
  "owner-a",
  "ws-a",
  "legacy-thread",
  "implementation",
  "legacy task",
  "W1",
  "completed",
  legacyCreatedAt,
  legacyCreatedAt,
  legacyCreatedAt,
);
legacyDb.prepare(`
  insert into codex_agent_events (
    run_id, agent_id, thread_id, type, method, data_json, created_at
  ) values (?, ?, ?, ?, ?, ?, ?)
`).run("legacy-run", "legacy-agent", "legacy-thread", "agent_message", "item/completed", "{}", legacyCreatedAt);
legacyDb.prepare(`
  insert into codex_approvals (
    id, run_id, agent_id, owner_client_id, thread_id, request_id, method,
    params_json, state, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  "legacy-approval",
  "legacy-run",
  "legacy-agent",
  "owner-a",
  "legacy-thread",
  "1",
  "item/commandExecution/requestApproval",
  "{}",
  "pending",
  legacyCreatedAt,
);
legacyDb.close();

const migratedStore = new CodexOrchestrationStore(legacyStateDir);
try {
  assert.equal(migratedStore.findAgentByThread("legacy-thread")?.agentId, "legacy-agent");
  assert.equal(migratedStore.readEventsOwned("legacy-run", "owner-a", 0).length, 1);
  assert.equal(migratedStore.listPendingApprovalsOwned("legacy-run", "owner-a").length, 1);

  const migratedRun = migratedStore.createRun({
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    parentMcpSessionId: "mcp-b",
    parentLogicalSessionId: "chat-a",
    goal: "post-migration reuse",
  });
  const reusedAssignment = migratedStore.createAgent({
    runId: migratedRun.runId,
    ownerClientId: "owner-a",
    workspaceId: "ws-a",
    threadId: "legacy-thread",
    role: "test",
    task: "reuse legacy thread",
    workerId: "W1",
  });
  assert.equal(reusedAssignment.threadId, "legacy-thread");
  assert.notEqual(reusedAssignment.agentId, "legacy-agent");
  console.log("Codex legacy reusable-thread migration tests passed!");
} finally {
  migratedStore.close();
  rmSync(legacyStateDir, { recursive: true, force: true });
}
