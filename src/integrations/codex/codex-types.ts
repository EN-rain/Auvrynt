export type CodexRunState =
  | "planning"
  | "running"
  | "reviewing"
  | "integrating"
  | "completed"
  | "failed"
  | "cancelled";

export type CodexAgentState =
  | "creating"
  | "idle"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "closed";

export type CodexAgentRole =
  | "implementation"
  | "research"
  | "debug"
  | "test"
  | "review"
  | "security-review"
  | "integration"
  | "refactor"
  | "documentation"
  | "custom";

export interface CodexRunRecord {
  runId: string;
  ownerClientId: string;
  workspaceId: string;
  parentMcpSessionId: string;
  parentLogicalSessionId?: string;
  goal: string;
  state: CodexRunState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CodexAgentRecord {
  agentId: string;
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
  state: CodexAgentState;
  currentTurnId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  resultSummary?: string;
  error?: string;
}

export type CodexEventType =
  | "agent_message"
  | "thread_started"
  | "thread_status"
  | "turn_started"
  | "turn_completed"
  | "item_started"
  | "item_completed"
  | "diff"
  | "approval_required"
  | "approval_resolved"
  | "warning"
  | "error"
  | "raw_notification";

export interface CodexAgentEvent {
  sequence: number;
  runId: string;
  agentId?: string;
  threadId?: string;
  turnId?: string;
  type: CodexEventType;
  method: string;
  data: unknown;
  createdAt: string;
}

export interface CodexApprovalRecord {
  approvalKey: string;
  runId: string;
  agentId: string;
  ownerClientId: string;
  threadId: string;
  turnId?: string;
  requestId: string | number;
  method: string;
  params: unknown;
  state: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: string;
  resolvedAt?: string;
}

export interface CodexRunMonitor {
  run: CodexRunRecord;
  agents: Array<CodexAgentRecord & { lastEvent?: CodexAgentEvent }>;
  dispatcher: {
    capacity: number;
    activeForRun: number;
    available: number;
    elastic: true;
    lanes: Array<{ workerId: string; state: "available" | "active" | "occupied"; agentId?: string }>;
  };
  events: CodexAgentEvent[];
  nextSequence: number;
}

export interface CodexThreadStartOptions {
  cwd: string;
  model?: string;
  developerInstructions?: string;
  approvalPolicy?: "untrusted" | "on-request" | "never";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  ephemeral?: boolean;
}

export interface CodexTurnStartOptions {
  threadId: string;
  task: string;
  cwd?: string;
  model?: string;
  effort?: string;
}

export interface CodexAppNotification {
  method: string;
  params?: unknown;
  emittedAtMs?: number;
}

export interface CodexAppServerRequest {
  id: string | number;
  method: string;
  params?: unknown;
}
