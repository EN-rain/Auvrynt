import { randomUUID } from "node:crypto";
import { openDatabase, type DatabaseHandle } from "../../db/client.js";
import type {
  CodexAgentEvent,
  CodexAgentRecord,
  CodexAgentRole,
  CodexAgentState,
  CodexApprovalRecord,
  CodexEventType,
  CodexRunRecord,
  CodexRunState,
} from "./codex-types.js";

const MAX_EVENT_JSON_BYTES = 64 * 1024;

export class CodexOrchestrationStore {
  private readonly database: DatabaseHandle;

  constructor(stateDir: string) {
    this.database = openDatabase(stateDir);
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  createRun(input: {
    ownerClientId: string;
    workspaceId: string;
    parentMcpSessionId: string;
    parentLogicalSessionId?: string;
    goal: string;
  }): CodexRunRecord {
    const now = new Date().toISOString();
    const run: CodexRunRecord = {
      runId: `run_${randomUUID()}`,
      ownerClientId: input.ownerClientId,
      workspaceId: input.workspaceId,
      parentMcpSessionId: input.parentMcpSessionId,
      parentLogicalSessionId: input.parentLogicalSessionId,
      goal: input.goal,
      state: "planning",
      createdAt: now,
      updatedAt: now,
    };
    this.database.sqlite.prepare(`
      insert into codex_runs (
        id, owner_client_id, workspace_id, parent_mcp_session_id,
        parent_logical_session_id, goal, state, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.runId,
      run.ownerClientId,
      run.workspaceId,
      run.parentMcpSessionId,
      run.parentLogicalSessionId ?? null,
      run.goal,
      run.state,
      run.createdAt,
      run.updatedAt,
    );
    return run;
  }

  getRunOwned(runId: string, ownerClientId: string): CodexRunRecord {
    const row = this.database.sqlite.prepare(`
      select * from codex_runs where id = ? and owner_client_id = ?
    `).get(runId, ownerClientId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Codex orchestration run not found or belongs to another OAuth client");
    return rowToRun(row);
  }

  updateRunState(runId: string, ownerClientId: string, state: CodexRunState): CodexRunRecord {
    const now = new Date().toISOString();
    const completedAt = ["completed", "failed", "cancelled"].includes(state) ? now : null;
    const result = this.database.sqlite.prepare(`
      update codex_runs
      set state = ?, updated_at = ?, completed_at = coalesce(?, completed_at)
      where id = ? and owner_client_id = ?
    `).run(state, now, completedAt, runId, ownerClientId);
    if (result.changes !== 1) throw new Error("Codex orchestration run not found or belongs to another OAuth client");
    return this.getRunOwned(runId, ownerClientId);
  }

  createAgent(input: {
    runId: string;
    ownerClientId: string;
    workspaceId: string;
    threadId: string;
    parentThreadId?: string;
    role: CodexAgentRole;
    task: string;
    model?: string;
    effort?: string;
    workerId?: string;
  }): CodexAgentRecord {
    this.getRunOwned(input.runId, input.ownerClientId);
    const now = new Date().toISOString();
    const agent: CodexAgentRecord = {
      agentId: `agent_${randomUUID()}`,
      runId: input.runId,
      ownerClientId: input.ownerClientId,
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      parentThreadId: input.parentThreadId,
      role: input.role,
      task: input.task,
      model: input.model,
      effort: input.effort,
      workerId: input.workerId,
      state: "creating",
      createdAt: now,
      updatedAt: now,
    };
    this.database.sqlite.prepare(`
      insert into codex_agents (
        id, run_id, owner_client_id, workspace_id, thread_id, parent_thread_id,
        role, task, model, effort, worker_id, state, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.agentId,
      agent.runId,
      agent.ownerClientId,
      agent.workspaceId,
      agent.threadId,
      agent.parentThreadId ?? null,
      agent.role,
      agent.task,
      agent.model ?? null,
      agent.effort ?? null,
      agent.workerId ?? null,
      agent.state,
      agent.createdAt,
      agent.updatedAt,
    );
    return agent;
  }

  getAgentOwned(agentId: string, ownerClientId: string): CodexAgentRecord {
    const row = this.database.sqlite.prepare(`
      select * from codex_agents where id = ? and owner_client_id = ?
    `).get(agentId, ownerClientId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Codex agent not found or belongs to another OAuth client");
    return rowToAgent(row);
  }

  findAgentByThread(threadId: string): CodexAgentRecord | undefined {
    const row = this.database.sqlite.prepare(`
      select * from codex_agents where thread_id = ? order by created_at desc limit 1
    `).get(threadId) as Record<string, unknown> | undefined;
    return row ? rowToAgent(row) : undefined;
  }

  findReusableWorkerAgent(input: {
    runId: string;
    ownerClientId: string;
    workspaceId: string;
    workerId: string;
  }): CodexAgentRecord | undefined {
    const run = this.getRunOwned(input.runId, input.ownerClientId);
    const sessionColumn = run.parentLogicalSessionId ? "r.parent_logical_session_id" : "r.parent_mcp_session_id";
    const sessionValue = run.parentLogicalSessionId ?? run.parentMcpSessionId;
    const row = this.database.sqlite.prepare(`
      select a.* from codex_agents a
      join codex_runs r on r.id = a.run_id
      where a.owner_client_id = ?
        and a.workspace_id = ?
        and a.worker_id = ?
        and ${sessionColumn} = ?
        and exists (
          select 1 from codex_agent_events e
          where e.thread_id = a.thread_id
            and e.method = 'orchestrator/thread-reusable'
        )
      order by a.created_at desc
      limit 1
    `).get(
      input.ownerClientId,
      input.workspaceId,
      input.workerId,
      sessionValue,
    ) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const agent = rowToAgent(row);
    return agent.state === "closed" ? undefined : agent;
  }

  listAgentsOwned(runId: string, ownerClientId: string): CodexAgentRecord[] {
    this.getRunOwned(runId, ownerClientId);
    const rows = this.database.sqlite.prepare(`
      select * from codex_agents
      where run_id = ? and owner_client_id = ?
      order by created_at asc
    `).all(runId, ownerClientId) as Array<Record<string, unknown>>;
    return rows.map(rowToAgent);
  }

  listActiveAgents(): CodexAgentRecord[] {
    const rows = this.database.sqlite.prepare(`
      select * from codex_agents
      where state not in ('completed', 'failed', 'cancelled', 'closed')
      order by created_at asc
    `).all() as Array<Record<string, unknown>>;
    return rows.map(rowToAgent);
  }

  updateAgent(
    agentId: string,
    ownerClientId: string,
    updates: {
      state?: CodexAgentState;
      currentTurnId?: string | null;
      resultSummary?: string | null;
      error?: string | null;
      workerId?: string | null;
    },
  ): CodexAgentRecord {
    const current = this.getAgentOwned(agentId, ownerClientId);
    const state = updates.state ?? current.state;
    const turnId = updates.currentTurnId === undefined ? current.currentTurnId ?? null : updates.currentTurnId;
    const resultSummary = updates.resultSummary === undefined ? current.resultSummary ?? null : updates.resultSummary;
    const error = updates.error === undefined ? current.error ?? null : updates.error;
    const workerId = updates.workerId === undefined ? current.workerId ?? null : updates.workerId;
    const now = new Date().toISOString();
    const completedAt = ["completed", "failed", "cancelled", "closed"].includes(state)
      ? current.completedAt ?? now
      : null;

    this.database.sqlite.prepare(`
      update codex_agents
      set state = ?, current_turn_id = ?, result_summary = ?, error = ?, worker_id = ?,
          updated_at = ?, completed_at = ?
      where id = ? and owner_client_id = ?
    `).run(state, turnId, resultSummary, error, workerId, now, completedAt, agentId, ownerClientId);
    return this.getAgentOwned(agentId, ownerClientId);
  }

  appendEvent(input: {
    runId: string;
    agentId?: string;
    threadId?: string;
    turnId?: string;
    type: CodexEventType;
    method: string;
    data: unknown;
  }): CodexAgentEvent {
    const createdAt = new Date().toISOString();
    const result = this.database.sqlite.prepare(`
      insert into codex_agent_events (
        run_id, agent_id, thread_id, turn_id, type, method, data_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runId,
      input.agentId ?? null,
      input.threadId ?? null,
      input.turnId ?? null,
      input.type,
      input.method,
      boundedJson(input.data),
      createdAt,
    );
    return {
      sequence: Number(result.lastInsertRowid),
      runId: input.runId,
      agentId: input.agentId,
      threadId: input.threadId,
      turnId: input.turnId,
      type: input.type,
      method: input.method,
      data: input.data,
      createdAt,
    };
  }

  readEventsOwned(
    runId: string,
    ownerClientId: string,
    afterSequence = 0,
    limit = 200,
  ): CodexAgentEvent[] {
    this.getRunOwned(runId, ownerClientId);
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const rows = this.database.sqlite.prepare(`
      select e.* from codex_agent_events e
      join codex_runs r on r.id = e.run_id
      where e.run_id = ? and r.owner_client_id = ? and e.sequence > ?
      order by e.sequence asc
      limit ?
    `).all(runId, ownerClientId, afterSequence, safeLimit) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  lastEventForAgent(agentId: string, ownerClientId: string): CodexAgentEvent | undefined {
    const agent = this.getAgentOwned(agentId, ownerClientId);
    const row = this.database.sqlite.prepare(`
      select * from codex_agent_events
      where run_id = ? and agent_id = ?
      order by sequence desc limit 1
    `).get(agent.runId, agentId) as Record<string, unknown> | undefined;
    return row ? rowToEvent(row) : undefined;
  }

  createApproval(input: {
    runId: string;
    agentId: string;
    ownerClientId: string;
    threadId: string;
    turnId?: string;
    requestId: string | number;
    method: string;
    params: unknown;
  }): CodexApprovalRecord {
    const approvalKey = `approval_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    this.database.sqlite.prepare(`
      insert into codex_approvals (
        id, run_id, agent_id, owner_client_id, thread_id, turn_id,
        request_id, method, params_json, state, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      approvalKey,
      input.runId,
      input.agentId,
      input.ownerClientId,
      input.threadId,
      input.turnId ?? null,
      JSON.stringify(input.requestId),
      input.method,
      boundedJson(input.params),
      createdAt,
    );
    return this.getApprovalOwned(approvalKey, input.ownerClientId);
  }

  getApprovalOwned(approvalKey: string, ownerClientId: string): CodexApprovalRecord {
    const row = this.database.sqlite.prepare(`
      select * from codex_approvals where id = ? and owner_client_id = ?
    `).get(approvalKey, ownerClientId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Codex approval not found or belongs to another OAuth client");
    return rowToApproval(row);
  }

  listPendingApprovalsOwned(runId: string, ownerClientId: string): CodexApprovalRecord[] {
    this.getRunOwned(runId, ownerClientId);
    const rows = this.database.sqlite.prepare(`
      select * from codex_approvals
      where run_id = ? and owner_client_id = ? and state = 'pending'
      order by created_at asc
    `).all(runId, ownerClientId) as Array<Record<string, unknown>>;
    return rows.map(rowToApproval);
  }

  resolveApproval(
    approvalKey: string,
    ownerClientId: string,
    state: "accepted" | "declined" | "cancelled",
  ): CodexApprovalRecord {
    const resolvedAt = new Date().toISOString();
    const result = this.database.sqlite.prepare(`
      update codex_approvals set state = ?, resolved_at = ?
      where id = ? and owner_client_id = ? and state = 'pending'
    `).run(state, resolvedAt, approvalKey, ownerClientId);
    if (result.changes !== 1) throw new Error("Codex approval is missing, already resolved, or belongs to another OAuth client");
    return this.getApprovalOwned(approvalKey, ownerClientId);
  }

  private migrate(): void {
    this.database.sqlite.exec(`
      create table if not exists codex_runs (
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
      create index if not exists codex_runs_owner_idx on codex_runs(owner_client_id, updated_at desc);
      create index if not exists codex_runs_chat_idx on codex_runs(owner_client_id, parent_logical_session_id, updated_at desc);

      create table if not exists codex_agents (
        id text primary key,
        run_id text not null references codex_runs(id) on delete cascade,
        owner_client_id text not null,
        workspace_id text not null,
        thread_id text not null,
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
      create index if not exists codex_agents_run_idx on codex_agents(run_id, created_at);
      create index if not exists codex_agents_owner_idx on codex_agents(owner_client_id, updated_at desc);

      create table if not exists codex_agent_events (
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
      create index if not exists codex_events_run_idx on codex_agent_events(run_id, sequence);
      create index if not exists codex_events_agent_idx on codex_agent_events(agent_id, sequence);

      create table if not exists codex_approvals (
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
      create index if not exists codex_approvals_run_idx on codex_approvals(run_id, state, created_at);
    `);
    this.addColumnIfMissing("codex_agents", "worker_id", "text");
    this.migrateReusableThreadAssignments();
    this.database.sqlite.exec(`
      create index if not exists codex_agents_run_idx on codex_agents(run_id, created_at);
      create index if not exists codex_agents_owner_idx on codex_agents(owner_client_id, updated_at desc);
      create index if not exists codex_agents_thread_idx on codex_agents(thread_id, created_at desc);
      create index if not exists codex_agents_worker_idx on codex_agents(worker_id, state);
    `);
  }

  private migrateReusableThreadAssignments(): void {
    const row = this.database.sqlite.prepare(`
      select sql from sqlite_master where type = 'table' and name = 'codex_agents'
    `).get() as { sql?: string } | undefined;
    const schemaSql = row?.sql?.toLowerCase() ?? "";
    if (!/thread_id\s+text\s+not\s+null\s+unique/.test(schemaSql)) return;

    this.database.sqlite.pragma("foreign_keys = OFF");
    try {
      this.database.sqlite.exec(`
        begin immediate;
        drop table if exists codex_agents_reusable;
        create table codex_agents_reusable (
          id text primary key,
          run_id text not null references codex_runs(id) on delete cascade,
          owner_client_id text not null,
          workspace_id text not null,
          thread_id text not null,
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
        insert into codex_agents_reusable (
          id, run_id, owner_client_id, workspace_id, thread_id, parent_thread_id,
          role, task, model, effort, worker_id, state, current_turn_id,
          result_summary, error, created_at, updated_at, completed_at
        )
        select
          id, run_id, owner_client_id, workspace_id, thread_id, parent_thread_id,
          role, task, model, effort, worker_id, state, current_turn_id,
          result_summary, error, created_at, updated_at, completed_at
        from codex_agents;
        drop table codex_agents;
        alter table codex_agents_reusable rename to codex_agents;
        commit;
      `);
    } catch (error) {
      if (this.database.sqlite.inTransaction) this.database.sqlite.exec("rollback");
      throw error;
    } finally {
      this.database.sqlite.pragma("foreign_keys = ON");
    }

    const violations = this.database.sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error("Codex reusable-thread migration failed foreign-key validation");
    }
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.database.sqlite.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((existing) => existing.name === column)) return;
    this.database.sqlite.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

function rowToRun(row: Record<string, unknown>): CodexRunRecord {
  return {
    runId: String(row.id),
    ownerClientId: String(row.owner_client_id),
    workspaceId: String(row.workspace_id),
    parentMcpSessionId: String(row.parent_mcp_session_id),
    parentLogicalSessionId: nullableString(row.parent_logical_session_id),
    goal: String(row.goal),
    state: String(row.state) as CodexRunState,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: nullableString(row.completed_at),
  };
}

function rowToAgent(row: Record<string, unknown>): CodexAgentRecord {
  return {
    agentId: String(row.id),
    runId: String(row.run_id),
    ownerClientId: String(row.owner_client_id),
    workspaceId: String(row.workspace_id),
    threadId: String(row.thread_id),
    parentThreadId: nullableString(row.parent_thread_id),
    role: String(row.role) as CodexAgentRole,
    task: String(row.task),
    model: nullableString(row.model),
    effort: nullableString(row.effort),
    workerId: nullableString(row.worker_id),
    state: String(row.state) as CodexAgentState,
    currentTurnId: nullableString(row.current_turn_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: nullableString(row.completed_at),
    resultSummary: nullableString(row.result_summary),
    error: nullableString(row.error),
  };
}

function rowToEvent(row: Record<string, unknown>): CodexAgentEvent {
  return {
    sequence: Number(row.sequence),
    runId: String(row.run_id),
    agentId: nullableString(row.agent_id),
    threadId: nullableString(row.thread_id),
    turnId: nullableString(row.turn_id),
    type: String(row.type) as CodexEventType,
    method: String(row.method),
    data: parseJson(String(row.data_json)),
    createdAt: String(row.created_at),
  };
}

function rowToApproval(row: Record<string, unknown>): CodexApprovalRecord {
  return {
    approvalKey: String(row.id),
    runId: String(row.run_id),
    agentId: String(row.agent_id),
    ownerClientId: String(row.owner_client_id),
    threadId: String(row.thread_id),
    turnId: nullableString(row.turn_id),
    requestId: parseRequestId(String(row.request_id)),
    method: String(row.method),
    params: parseJson(String(row.params_json)),
    state: String(row.state) as CodexApprovalRecord["state"],
    createdAt: String(row.created_at),
    resolvedAt: nullableString(row.resolved_at),
  };
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function boundedJson(value: unknown): string {
  const serialized = JSON.stringify(value ?? null);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_EVENT_JSON_BYTES) return serialized;
  const truncated = Buffer.from(serialized, "utf8").subarray(0, MAX_EVENT_JSON_BYTES - 256).toString("utf8");
  return JSON.stringify({ truncated: true, preview: truncated });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { parseError: true };
  }
}

function parseRequestId(value: string): string | number {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string" || typeof parsed === "number") return parsed;
  } catch {
    // Legacy rows stored the textual request id directly.
  }
  return value;
}
