import type { ServerConfig } from "../../config.js";
import { WorkerLanePool } from "../../infrastructure/worker-lanes.js";
import { CodexAppServerClient } from "./codex-app-server-client.js";
import { CodexOrchestrationStore } from "./codex-store.js";
import type {
  CodexAgentEvent,
  CodexAgentRecord,
  CodexAgentRole,
  CodexAppNotification,
  CodexAppServerRequest,
  CodexApprovalRecord,
  CodexRunMonitor,
  CodexRunRecord,
} from "./codex-types.js";

const TERMINAL_AGENT_STATES = new Set(["completed", "failed", "cancelled", "closed"]);
const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);

export class CodexOrchestrator {
  readonly client: CodexAppServerClient;
  readonly store: CodexOrchestrationStore;
  readonly workers = new WorkerLanePool(4);
  private nextSpawnReservation = 1;

  constructor(readonly stateDir: string) {
    this.store = new CodexOrchestrationStore(stateDir);
    this.restoreWorkerAssignments();
    this.client = new CodexAppServerClient();
    this.client.on("notification", (notification: CodexAppNotification) => {
      this.handleNotification(notification);
    });
    this.client.on("serverRequest", (request: CodexAppServerRequest) => {
      this.handleServerRequest(request);
    });
    this.client.on("warning", (error: Error) => {
      this.handleClientWarning(error);
    });
    this.client.on("exit", (error: Error) => {
      this.handleClientWarning(error);
    });
  }

  async ensureAvailable(): Promise<{ running: boolean }> {
    await this.client.ensureStarted();
    return { running: this.client.isRunning() };
  }

  createRun(input: {
    ownerClientId: string;
    workspaceId: string;
    parentMcpSessionId: string;
    parentLogicalSessionId?: string;
    goal: string;
  }): CodexRunRecord {
    const goal = input.goal.trim();
    if (!goal) throw new Error("Codex orchestration goal must not be empty");
    return this.store.createRun({ ...input, goal });
  }

  async spawnAgent(input: {
    ownerClientId: string;
    runId: string;
    workspaceId: string;
    cwd: string;
    role: CodexAgentRole;
    task: string;
    chatName?: string;
    model?: string;
    effort?: string;
  }): Promise<CodexAgentRecord> {
    const [result] = await this.spawnAgents({
      ownerClientId: input.ownerClientId,
      runId: input.runId,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      agents: [{
        role: input.role,
        task: input.task,
        chatName: input.chatName,
        model: input.model,
        effort: input.effort,
      }],
    });
    if (!result || !result.ok) throw new Error(result?.error ?? "Codex worker chat failed to start");
    return result.agent;
  }

  async spawnAgents(input: {
    ownerClientId: string;
    runId: string;
    workspaceId: string;
    cwd: string;
    agents: Array<{
      role: CodexAgentRole;
      task: string;
      chatName?: string;
      model?: string;
      effort?: string;
    }>;
  }): Promise<Array<
    | { ok: true; agent: CodexAgentRecord }
    | { ok: false; role: CodexAgentRole; task: string; error: string }
  >> {
    const run = this.store.getRunOwned(input.runId, input.ownerClientId);
    if (run.workspaceId !== input.workspaceId) {
      throw new Error("Codex run belongs to a different Auvrynt workspace");
    }
    if (input.agents.length < 1) {
      throw new Error("Deploy at least one Codex worker chat per batch");
    }
    const specs = input.agents.map((spec) => ({
      ...spec,
      task: spec.task.trim(),
      chatName: spec.chatName?.trim() || undefined,
    }));
    if (specs.some((spec) => !spec.task)) throw new Error("Codex worker tasks must not be empty");

    const leases = this.workers.reserveMany(specs.map(() => `spawn:${run.runId}:${this.nextSpawnReservation++}`));
    try {
      await this.client.ensureStarted();
    } catch (error) {
      for (const lease of leases) this.workers.release(lease.leaseId);
      throw error;
    }
    this.store.updateRunState(run.runId, input.ownerClientId, "running");

    const results = await Promise.all(specs.map(async (spec, index) => {
      const lease = leases[index]!;
      const chatName = visibleCodexChatName(spec.role, spec.task, lease.workerId, spec.chatName);
      let threadId: string | undefined;
      let visibleThread: Record<string, unknown> | undefined;
      let agent: CodexAgentRecord | undefined;
      let createdThread = false;
      let reusedThread = false;
      try {
        const reusable = this.store.findReusableWorkerAgent({
          runId: run.runId,
          ownerClientId: input.ownerClientId,
          workspaceId: input.workspaceId,
          workerId: lease.workerId,
        });
        if (reusable) {
          try {
            threadId = reusable.threadId;
            const readResponse = await this.client.readThread(threadId, false);
            visibleThread = objectValue(readResponse.thread, "thread/read did not return the reusable Codex chat");
            const existingName = optionalString(visibleThread.name);
            const desiredName = spec.chatName ? chatName : existingName ?? chatName;
            if (existingName !== desiredName) {
              await this.client.setThreadName(threadId, desiredName);
              const renamedResponse = await this.client.readThread(threadId, false);
              visibleThread = objectValue(renamedResponse.thread, "thread/read did not return the renamed reusable Codex chat");
            }
            assertVisibleCodexChat(visibleThread, threadId, desiredName);
            reusedThread = true;
          } catch {
            threadId = undefined;
            visibleThread = undefined;
          }
        }

        if (!threadId || !visibleThread) {
          const threadResponse = await this.client.startThread({
            cwd: input.cwd,
            model: spec.model,
            approvalPolicy: "on-request",
            sandbox: "workspace-write",
            developerInstructions: sharedWorkerInstructions(),
            ephemeral: false,
          });
          const startedThread = objectValue(threadResponse.thread, "thread/start did not return a thread");
          threadId = stringValue(startedThread.id, "thread/start did not return a thread id");
          createdThread = true;

          await this.client.setThreadName(threadId, chatName);
          const readResponse = await this.client.readThread(threadId, false);
          visibleThread = objectValue(readResponse.thread, "thread/read did not return the created Codex chat");
          assertVisibleCodexChat(visibleThread, threadId, chatName);
        }

        this.workers.rebind(lease.leaseId, threadId);
        const parentThreadId = optionalString(visibleThread.parentThreadId);
        agent = this.store.createAgent({
          runId: run.runId,
          ownerClientId: input.ownerClientId,
          workspaceId: input.workspaceId,
          threadId,
          parentThreadId,
          role: spec.role,
          task: spec.task,
          model: spec.model,
          effort: spec.effort,
          workerId: lease.workerId,
        });
        this.store.appendEvent({
          runId: run.runId,
          agentId: agent.agentId,
          threadId,
          type: "thread_started",
          method: reusedThread ? "thread/reuse" : "thread/start",
          data: { ...threadSummary(visibleThread), workerId: lease.workerId, reused: reusedThread },
        });
        if (createdThread) {
          this.store.appendEvent({
            runId: run.runId,
            agentId: agent.agentId,
            threadId,
            type: "raw_notification",
            method: "orchestrator/thread-reusable",
            data: { workerId: lease.workerId, version: 1 },
          });
        }

        const turnResponse = await this.client.startTurn({
          threadId,
          task: workerTurnTask(spec.role, spec.task),
          cwd: input.cwd,
          model: spec.model,
          effort: spec.effort,
        });
        const turn = objectValue(turnResponse.turn, "turn/start did not return a turn");
        const turnId = stringValue(turn.id, "turn/start did not return a turn id");
        agent = this.store.updateAgent(agent.agentId, input.ownerClientId, {
          state: "running",
          currentTurnId: turnId,
        });
        this.store.appendEvent({
          runId: run.runId,
          agentId: agent.agentId,
          threadId,
          turnId,
          type: "turn_started",
          method: "turn/start",
          data: { ...turnSummary(turn), workerId: lease.workerId },
        });
        return { ok: true as const, agent };
      } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        this.workers.release(lease.leaseId);
        if (agent) {
          this.store.updateAgent(agent.agentId, input.ownerClientId, { state: "failed", error: message });
          this.store.appendEvent({
            runId: run.runId,
            agentId: agent.agentId,
            threadId,
            type: "error",
            method: "spawn",
            data: { message, workerId: lease.workerId },
          });
        } else if (threadId && createdThread) {
          try {
            await this.client.deleteThread(threadId);
          } catch (cleanupError) {
            message = `${message}; failed to delete unverified Codex chat: ${stringifyUnknown(cleanupError)}`;
          }
        }
        return { ok: false as const, role: spec.role, task: spec.task, error: message };
      }
    }));

    if (results.every((result) => !result.ok)) {
      this.store.updateRunState(run.runId, input.ownerClientId, "failed");
    }
    return results;
  }

  async send(input: {
    ownerClientId: string;
    agentId: string;
    instruction: string;
    cwd?: string;
  }): Promise<CodexAgentRecord> {
    let agent = this.store.getAgentOwned(input.agentId, input.ownerClientId);
    const instruction = input.instruction.trim();
    if (!instruction) throw new Error("Codex instruction must not be empty");
    if (agent.state === "closed") throw new Error("Codex agent is closed");

    if (agent.state === "running" && agent.currentTurnId) {
      await this.client.steerTurn(agent.threadId, agent.currentTurnId, instruction);
      this.store.appendEvent({
        runId: agent.runId,
        agentId: agent.agentId,
        threadId: agent.threadId,
        turnId: agent.currentTurnId,
        type: "raw_notification",
        method: "turn/steer",
        data: { instructionAccepted: true },
      });
      return agent;
    }

    let acquiredLeaseId: string | undefined;
    if (!this.workers.leaseForTask(agent.threadId)) {
      const lease = this.workers.reserve(agent.threadId);
      acquiredLeaseId = lease.leaseId;
      agent = this.store.updateAgent(agent.agentId, input.ownerClientId, { workerId: lease.workerId });
    }

    let response: Awaited<ReturnType<CodexAppServerClient["startTurn"]>>;
    try {
      response = await this.client.startTurn({
        threadId: agent.threadId,
        task: instruction,
        cwd: input.cwd,
        model: agent.model,
        effort: agent.effort,
      });
    } catch (error) {
      if (acquiredLeaseId) this.workers.release(acquiredLeaseId);
      throw error;
    }
    const turn = objectValue(response.turn, "turn/start did not return a turn");
    const turnId = stringValue(turn.id, "turn/start did not return a turn id");
    const updated = this.store.updateAgent(agent.agentId, input.ownerClientId, {
      state: "running",
      currentTurnId: turnId,
      error: null,
    });
    this.store.appendEvent({
      runId: agent.runId,
      agentId: agent.agentId,
      threadId: agent.threadId,
      turnId,
      type: "turn_started",
      method: "turn/start",
      data: { ...turnSummary(turn), workerId: updated.workerId ?? null },
    });
    return updated;
  }

  status(ownerClientId: string, agentId: string): CodexAgentRecord {
    return this.store.getAgentOwned(agentId, ownerClientId);
  }

  listAgents(ownerClientId: string, runId: string): CodexAgentRecord[] {
    return this.store.listAgentsOwned(runId, ownerClientId);
  }

  monitorRun(ownerClientId: string, runId: string, afterSequence = 0, limit = 200): CodexRunMonitor {
    const run = this.store.getRunOwned(runId, ownerClientId);
    const agents = this.store.listAgentsOwned(runId, ownerClientId).map((agent) => ({
      ...agent,
      lastEvent: this.store.lastEventForAgent(agent.agentId, ownerClientId),
    }));
    const events = this.store.readEventsOwned(runId, ownerClientId, afterSequence, limit);
    const nextSequence = events.length > 0 ? events[events.length - 1]!.sequence : afterSequence;
    const activeAgents = agents.filter((agent) => !TERMINAL_AGENT_STATES.has(agent.state));
    const byWorker = new Map(activeAgents.flatMap((agent) => agent.workerId ? [[agent.workerId, agent] as const] : []));
    const workerSnapshot = this.workers.snapshot();
    const dispatcher = {
      capacity: workerSnapshot.capacity,
      activeForRun: activeAgents.length,
      available: workerSnapshot.available,
      elastic: workerSnapshot.elastic,
      lanes: workerSnapshot.lanes.map((lane) => {
        const ownedAgent = byWorker.get(lane.workerId);
        if (ownedAgent) return { workerId: lane.workerId, state: "active" as const, agentId: ownedAgent.agentId };
        return { workerId: lane.workerId, state: lane.busy ? "occupied" as const : "available" as const };
      }),
    };
    return { run, agents, dispatcher, events, nextSequence };
  }

  readEvents(ownerClientId: string, runId: string, afterSequence = 0, limit = 200): CodexAgentEvent[] {
    return this.store.readEventsOwned(runId, ownerClientId, afterSequence, limit);
  }

  pendingApprovals(ownerClientId: string, runId: string): CodexApprovalRecord[] {
    return this.store.listPendingApprovalsOwned(runId, ownerClientId);
  }

  async resolveApproval(
    ownerClientId: string,
    approvalKey: string,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ): Promise<CodexApprovalRecord> {
    const approval = this.store.getApprovalOwned(approvalKey, ownerClientId);
    if (approval.state !== "pending") throw new Error("Codex approval is already resolved");
    if (!APPROVAL_METHODS.has(approval.method)) {
      throw new Error(`Codex approval method is not yet resolvable by Auvrynt: ${approval.method}`);
    }

    await this.client.respondToServerRequest(approval.requestId, { decision });
    const state = decision === "accept" || decision === "acceptForSession"
      ? "accepted"
      : decision === "decline"
        ? "declined"
        : "cancelled";
    const resolved = this.store.resolveApproval(approvalKey, ownerClientId, state);
    const agent = this.store.getAgentOwned(approval.agentId, ownerClientId);
    this.store.updateAgent(agent.agentId, ownerClientId, {
      state: agent.currentTurnId ? "running" : "idle",
    });
    this.store.appendEvent({
      runId: approval.runId,
      agentId: approval.agentId,
      threadId: approval.threadId,
      turnId: approval.turnId,
      type: "approval_resolved",
      method: approval.method,
      data: { approvalKey, decision },
    });
    return resolved;
  }

  async interrupt(ownerClientId: string, agentId: string): Promise<CodexAgentRecord> {
    const agent = this.store.getAgentOwned(agentId, ownerClientId);
    if (!agent.currentTurnId) return agent;
    await this.client.interruptTurn(agent.threadId, agent.currentTurnId);
    const updated = this.store.updateAgent(agent.agentId, ownerClientId, { state: "cancelled", currentTurnId: null });
    this.workers.releaseByTask(agent.threadId);
    return updated;
  }

  async closeAgent(ownerClientId: string, agentId: string): Promise<CodexAgentRecord> {
    const agent = this.store.getAgentOwned(agentId, ownerClientId);
    if (agent.currentTurnId && agent.state === "running") {
      await this.client.interruptTurn(agent.threadId, agent.currentTurnId).catch(() => undefined);
    }
    const updated = this.store.updateAgent(agent.agentId, ownerClientId, { state: "closed", currentTurnId: null });
    this.workers.releaseByTask(agent.threadId);
    return updated;
  }

  async getResult(ownerClientId: string, agentId: string): Promise<{
    agent: CodexAgentRecord;
    finalMessage?: string;
    thread: unknown;
  }> {
    const agent = this.store.getAgentOwned(agentId, ownerClientId);
    const response = await this.client.readThread(agent.threadId, true);
    const thread = objectValue(response.thread, "thread/read did not return a thread");
    return {
      agent,
      finalMessage: finalAgentMessageFromThread(thread) ?? agent.resultSummary,
      thread,
    };
  }

  completeRun(ownerClientId: string, runId: string): CodexRunRecord {
    const agents = this.store.listAgentsOwned(runId, ownerClientId);
    if (agents.some((agent) => !TERMINAL_AGENT_STATES.has(agent.state))) {
      throw new Error("Cannot complete a Codex run while subagents are still active");
    }
    return this.store.updateRunState(runId, ownerClientId, "completed");
  }

  async shutdown(): Promise<void> {
    await this.client.close();
    this.store.close();
  }

  private restoreWorkerAssignments(): void {
    for (const agent of this.store.listActiveAgents()) {
      try {
        const lease = agent.workerId
          ? this.workers.restore(agent.workerId, agent.threadId)
          : this.workers.reserve(agent.threadId);
        if (agent.workerId !== lease.workerId) {
          this.store.updateAgent(agent.agentId, agent.ownerClientId, { workerId: lease.workerId });
        }
      } catch (error) {
        const message = `Worker dispatcher recovery failed: ${error instanceof Error ? error.message : String(error)}`;
        this.store.updateAgent(agent.agentId, agent.ownerClientId, {
          state: "failed",
          currentTurnId: null,
          error: message,
        });
        this.store.appendEvent({
          runId: agent.runId,
          agentId: agent.agentId,
          threadId: agent.threadId,
          type: "error",
          method: "dispatcher/restore",
          data: { message },
        });
      }
    }
  }

  private handleNotification(notification: CodexAppNotification): void {
    const params = asRecord(notification.params);
    const threadId = optionalString(params?.threadId);
    if (!threadId) return;
    const agent = this.store.findAgentByThread(threadId);
    if (!agent) return;
    const turnId = optionalString(params?.turnId)
      ?? optionalString(asRecord(params?.turn)?.id)
      ?? agent.currentTurnId;

    switch (notification.method) {
      case "thread/status/changed": {
        const status = asRecord(params?.status);
        const type = optionalString(status?.type);
        if (!TERMINAL_AGENT_STATES.has(agent.state)) {
          if (type === "active") this.store.updateAgent(agent.agentId, agent.ownerClientId, { state: "running" });
          if (type === "idle" && agent.state !== "blocked") {
            this.store.updateAgent(agent.agentId, agent.ownerClientId, { state: "idle" });
          }
          if (type === "systemError") {
            this.store.updateAgent(agent.agentId, agent.ownerClientId, { state: "failed", currentTurnId: null });
            this.workers.releaseByTask(agent.threadId);
          }
        }
        this.appendNotificationEvent(agent, turnId, "thread_status", notification, { status: params?.status });
        break;
      }
      case "turn/started": {
        const turn = asRecord(params?.turn);
        const actualTurnId = optionalString(turn?.id) ?? turnId;
        this.store.updateAgent(agent.agentId, agent.ownerClientId, {
          state: "running",
          currentTurnId: actualTurnId ?? null,
        });
        this.appendNotificationEvent(agent, actualTurnId, "turn_started", notification, turnSummary(turn ?? {}));
        break;
      }
      case "turn/completed": {
        const turn = asRecord(params?.turn) ?? {};
        const status = optionalString(turn.status);
        const actualTurnId = optionalString(turn.id) ?? turnId;
        const resultSummary = finalAgentMessageFromTurn(turn);
        const nextState = status === "failed" ? "failed" : status === "interrupted" ? "cancelled" : "completed";
        this.store.updateAgent(agent.agentId, agent.ownerClientId, {
          state: nextState,
          currentTurnId: null,
          resultSummary: resultSummary ?? agent.resultSummary ?? null,
          error: status === "failed" ? stringifyUnknown(turn.error) : null,
        });
        this.workers.releaseByTask(agent.threadId);
        this.appendNotificationEvent(agent, actualTurnId, "turn_completed", notification, {
          status,
          durationMs: turn.durationMs ?? null,
          resultSummary,
          error: status === "failed" ? turn.error ?? null : null,
        });
        break;
      }
      case "item/started":
        this.appendNotificationEvent(agent, turnId, "item_started", notification, summarizeItem(params?.item));
        break;
      case "item/completed": {
        const item = asRecord(params?.item);
        if (item?.type === "agentMessage") {
          const text = optionalString(item.text) ?? "";
          this.store.updateAgent(agent.agentId, agent.ownerClientId, { resultSummary: text || agent.resultSummary || null });
          this.appendNotificationEvent(agent, turnId, "agent_message", notification, { text });
        } else {
          this.appendNotificationEvent(agent, turnId, "item_completed", notification, summarizeItem(item));
        }
        break;
      }
      case "turn/diff/updated":
        this.appendNotificationEvent(agent, turnId, "diff", notification, { diff: params?.diff ?? "" });
        break;
      case "error":
        this.store.updateAgent(agent.agentId, agent.ownerClientId, { error: stringifyUnknown(params?.error) });
        this.appendNotificationEvent(agent, turnId, "error", notification, {
          error: params?.error,
          willRetry: params?.willRetry ?? false,
        });
        break;
      case "warning":
        this.appendNotificationEvent(agent, turnId, "warning", notification, { message: params?.message ?? "Codex warning" });
        break;
      default:
        // High-volume token/reasoning deltas are intentionally not persisted.
        break;
    }
  }

  private handleServerRequest(request: CodexAppServerRequest): void {
    const params = asRecord(request.params);
    const threadId = optionalString(params?.threadId);
    if (!threadId) return;
    const agent = this.store.findAgentByThread(threadId);
    if (!agent) return;

    const approval = this.store.createApproval({
      runId: agent.runId,
      agentId: agent.agentId,
      ownerClientId: agent.ownerClientId,
      threadId,
      turnId: optionalString(params?.turnId),
      requestId: request.id,
      method: request.method,
      params: sanitizeServerRequestParams(params ?? {}),
    });
    this.store.updateAgent(agent.agentId, agent.ownerClientId, { state: "blocked" });
    this.store.appendEvent({
      runId: agent.runId,
      agentId: agent.agentId,
      threadId,
      turnId: approval.turnId,
      type: "approval_required",
      method: request.method,
      data: {
        approvalKey: approval.approvalKey,
        method: request.method,
        params: approval.params,
        resolvable: APPROVAL_METHODS.has(request.method),
      },
    });
  }

  private handleClientWarning(error: Error): void {
    // Client-level failures are intentionally not assigned to another OAuth
    // owner's run without a thread id. Targeted thread failures arrive as
    // Codex notifications and are persisted by handleNotification.
    void error;
  }

  private appendNotificationEvent(
    agent: CodexAgentRecord,
    turnId: string | undefined,
    type: Parameters<CodexOrchestrationStore["appendEvent"]>[0]["type"],
    notification: CodexAppNotification,
    data: unknown,
  ): void {
    this.store.appendEvent({
      runId: agent.runId,
      agentId: agent.agentId,
      threadId: agent.threadId,
      turnId,
      type,
      method: notification.method,
      data,
    });
  }
}

const orchestrators = new Map<string, CodexOrchestrator>();

export function getCodexOrchestrator(config: Pick<ServerConfig, "stateDir">): CodexOrchestrator {
  const existing = orchestrators.get(config.stateDir);
  if (existing) return existing;
  const created = new CodexOrchestrator(config.stateDir);
  orchestrators.set(config.stateDir, created);
  return created;
}

export async function shutdownCodexOrchestrator(stateDir: string): Promise<void> {
  const orchestrator = orchestrators.get(stateDir);
  if (!orchestrator) return;
  orchestrators.delete(stateDir);
  await orchestrator.shutdown();
}

const INTERACTIVE_CODEX_CHAT_SOURCES = new Set(["vscode", "cli"]);
const VISIBLE_CODEX_CHAT_NAME_MAX = 96;

function visibleCodexChatName(
  role: CodexAgentRole,
  task: string,
  workerId: string,
  requestedName?: string,
): string {
  const requested = requestedName?.replace(/\s+/g, " ").trim();
  const taskTitle = task.replace(/\s+/g, " ").trim();
  const base = requested || `Sol ${workerId} — ${role} — ${taskTitle}`;
  if (base.length <= VISIBLE_CODEX_CHAT_NAME_MAX) return base;
  return `${base.slice(0, VISIBLE_CODEX_CHAT_NAME_MAX - 1).trimEnd()}…`;
}

function assertVisibleCodexChat(
  thread: Record<string, unknown>,
  expectedThreadId: string,
  expectedName: string,
): void {
  if (thread.id !== expectedThreadId) {
    throw new Error("Codex visibility verification returned a different thread");
  }
  if (thread.name !== expectedName) {
    throw new Error("Codex chat title was not persisted; refusing to start a hidden worker");
  }
  if (thread.ephemeral !== false) {
    throw new Error("Codex chat is ephemeral; refusing to start a hidden worker");
  }
  if (thread.historyMode !== "legacy") {
    throw new Error("Codex chat is not using the verified persisted history mode");
  }
  if (thread.parentThreadId !== null && thread.parentThreadId !== undefined) {
    throw new Error("Codex chat is nested under another thread; refusing hidden subagent placement");
  }
  if (typeof thread.source !== "string" || !INTERACTIVE_CODEX_CHAT_SOURCES.has(thread.source)) {
    throw new Error(`Codex chat source is not interactive (${stringifyUnknown(thread.source)})`);
  }
  if (typeof thread.path !== "string" || !thread.path.trim()) {
    throw new Error("Codex chat is not materialized on disk");
  }
}

function sharedWorkerInstructions(): string {
  return "You are a Codex subagent controlled by Auvrynt. Work only on the current assigned scoped task. Auvrynt may reuse this same visible worker chat for later assignments, so do not continue an older assignment unless the current task explicitly references it. Do not spawn additional agents unless the parent task explicitly asks you to. Report verification and blockers clearly.";
}

function roleInstructions(role: CodexAgentRole): string {
  const shared = sharedWorkerInstructions();
  switch (role) {
    case "review":
    case "security-review":
      return `${shared} Review first; do not modify files unless the task explicitly authorizes changes.`;
    case "test":
      return `${shared} Focus on reproducible verification and targeted tests. Avoid unrelated refactors.`;
    case "integration":
      return `${shared} Integrate only accepted worker results and verify the combined state before reporting completion.`;
    default:
      return shared;
  }
}

function workerTurnTask(role: CodexAgentRole, task: string): string {
  return `${roleInstructions(role)}\n\nCurrent assignment:\n${task}`;
}

function threadSummary(thread: Record<string, unknown>): Record<string, unknown> {
  return {
    id: thread.id,
    parentThreadId: thread.parentThreadId ?? null,
    agentNickname: thread.agentNickname ?? null,
    agentRole: thread.agentRole ?? null,
    cwd: thread.cwd ?? null,
    status: thread.status ?? null,
  };
}

function turnSummary(turn: Record<string, unknown>): Record<string, unknown> {
  return {
    id: turn.id ?? null,
    status: turn.status ?? null,
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    durationMs: turn.durationMs ?? null,
  };
}

function summarizeItem(value: unknown): Record<string, unknown> {
  const item = asRecord(value);
  if (!item) return { type: "unknown" };
  const type = optionalString(item.type) ?? "unknown";
  switch (type) {
    case "agentMessage":
      return { type, text: item.text ?? "" };
    case "commandExecution":
      return {
        type,
        command: item.command ?? "",
        cwd: item.cwd ?? null,
        status: item.status ?? null,
        exitCode: item.exitCode ?? null,
        durationMs: item.durationMs ?? null,
        aggregatedOutput: item.aggregatedOutput ?? null,
      };
    case "fileChange":
      return { type, status: item.status ?? null, changes: item.changes ?? [] };
    case "mcpToolCall":
      return {
        type,
        server: item.server ?? null,
        tool: item.tool ?? null,
        status: item.status ?? null,
        durationMs: item.durationMs ?? null,
        error: item.error ?? null,
      };
    case "collabAgentToolCall":
      return {
        type,
        tool: item.tool ?? null,
        status: item.status ?? null,
        senderThreadId: item.senderThreadId ?? null,
        receiverThreadIds: item.receiverThreadIds ?? [],
        model: item.model ?? null,
        reasoningEffort: item.reasoningEffort ?? null,
      };
    case "reasoning":
      return { type, redacted: true };
    default:
      return { type, id: item.id ?? null };
  }
}

function sanitizeServerRequestParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    threadId: params.threadId ?? null,
    turnId: params.turnId ?? null,
    itemId: params.itemId ?? null,
    reason: params.reason ?? null,
    command: params.command ?? null,
    cwd: params.cwd ?? null,
    commandActions: params.commandActions ?? null,
    grantRoot: params.grantRoot ?? null,
    availableDecisions: params.availableDecisions ?? null,
  };
}

function finalAgentMessageFromTurn(turn: Record<string, unknown>): string | undefined {
  const items = Array.isArray(turn.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index--) {
    const item = asRecord(items[index]);
    if (item?.type === "agentMessage" && typeof item.text === "string" && item.text.trim()) {
      return item.text;
    }
  }
  return undefined;
}

function finalAgentMessageFromThread(thread: Record<string, unknown>): string | undefined {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = asRecord(turns[index]);
    if (!turn) continue;
    const message = finalAgentMessageFromTurn(turn);
    if (message) return message;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new Error(message);
  return record;
}

function stringValue(value: unknown, message: string): string {
  if (typeof value !== "string" || !value) throw new Error(message);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}
