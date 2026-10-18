import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RecoveryState =
  | "HEALTHY"
  | "DEGRADED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "RECONCILING"
  | "READY"
  | "RECOVERY_REQUIRED"
  | "STOPPED";

export type ReplayPolicy = "SAFE_REPLAY" | "VERIFY_BEFORE_REPLAY" | "NEVER_BLIND_REPLAY";
export type RecoveryActionState = "pending" | "delivery_unknown" | "completed" | "threw" | "reconciled";
export type ReconciliationOutcome =
  | "verified_applied"
  | "verified_no_effect"
  | "restored_checkpoint"
  | "user_resolved";

export interface RecoveryToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface RecoveryActionRecord {
  actionId: string;
  attemptId: string;
  instanceId: string;
  pid: number;
  workspaceId: string;
  sessionId?: string;
  integration: string;
  toolName: string;
  replayPolicy: ReplayPolicy;
  targetHints: Record<string, string | number | boolean>;
  inputFingerprint: string;
  state: RecoveryActionState;
  startedAt: string;
  finishedAt?: string;
  deliveryUnknownAt?: string;
  reconciledAt?: string;
  reconciliationOutcome?: ReconciliationOutcome;
  reconciliationEvidence?: string;
  errorName?: string;
}

export interface RecoveryLease {
  instanceId: string;
  pid: number;
  acquiredAt: string;
  renewedAt: string;
}

export interface WorkspaceRecoveryJournal {
  schemaVersion: 1;
  workspaceId: string;
  recoveryGeneration: number;
  state: RecoveryState;
  updatedAt: string;
  lease?: RecoveryLease;
  actions: RecoveryActionRecord[];
}

export interface RecoveryStatus {
  workspaceId: string;
  recoveryGeneration: number;
  state: RecoveryState;
  unknownActions: RecoveryActionRecord[];
  inFlightActions: RecoveryActionRecord[];
  recentActions: RecoveryActionRecord[];
  lease?: RecoveryLease;
  safeToResumeMutations: boolean;
}

export interface BeginRecoveryTrackedCallInput {
  workspaceId: string;
  sessionId?: string;
  integration: string;
  toolName: string;
  input: unknown;
  annotations?: RecoveryToolAnnotations;
}

export interface RecoveryTrackedCall {
  actionId: string;
  recoveryGeneration: number;
}

export interface ReconcileRecoveryInput {
  workspaceId: string;
  actionId: string;
  expectedRecoveryGeneration: number;
  outcome: ReconciliationOutcome;
  evidence: string;
}

const MAX_ACTION_HISTORY = 200;
const MAX_TARGET_HINT_LENGTH = 512;
const MAX_EVIDENCE_LENGTH = 2_000;
const RECENT_DELIVERY_WINDOW_MS = 5_000;
const PRIVATE_KEY_RE = /(password|passwd|secret|token|authorization|cookie|clipboard|base64|data|content|text|prompt|command|script|code)/i;
const TARGET_KEY_RE = /(path|file|project|scene|output|destination|source|document|workspace)/i;

export class RecoveryRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryRequiredError";
  }
}

export class RecoveryCoordinator {
  readonly instanceId: string;
  readonly pid: number;
  private readonly journalDir: string;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    stateDir: string,
    options: { instanceId?: string; pid?: number } = {},
  ) {
    this.instanceId = options.instanceId ?? `instance_${randomUUID()}`;
    this.pid = options.pid ?? process.pid;
    this.journalDir = join(stateDir, "recovery");
  }

  async beginToolCall(input: BeginRecoveryTrackedCallInput): Promise<RecoveryTrackedCall | undefined> {
    const replayPolicy = replayPolicyForAnnotations(input.annotations);
    if (input.annotations?.readOnlyHint === true) return undefined;

    return this.withWorkspaceLock(input.workspaceId, async () => {
      const journal = await this.loadAndNormalize(input.workspaceId);
      this.assertLeaseAvailable(journal);
      const unknown = unresolvedRecoveryActions(journal, this.instanceId);
      if (unknown.length > 0) {
        journal.state = "RECOVERY_REQUIRED";
        journal.updatedAt = nowIso();
        await this.persist(journal);
        throw new RecoveryRequiredError(recoveryRequiredMessage(input.workspaceId, unknown));
      }

      this.claimLease(journal);
      const action: RecoveryActionRecord = {
        actionId: `action_${randomUUID()}`,
        attemptId: `attempt_${randomUUID()}`,
        instanceId: this.instanceId,
        pid: this.pid,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        integration: input.integration,
        toolName: input.toolName,
        replayPolicy,
        targetHints: extractTargetHints(input.input),
        inputFingerprint: fingerprintInput(input.input),
        state: "pending",
        startedAt: nowIso(),
      };
      journal.actions.push(action);
      trimHistory(journal);
      journal.state = "HEALTHY";
      journal.updatedAt = nowIso();
      await this.persist(journal);
      return { actionId: action.actionId, recoveryGeneration: journal.recoveryGeneration };
    });
  }

  async finishToolCall(workspaceId: string, actionId: string, error?: unknown): Promise<void> {
    await this.withWorkspaceLock(workspaceId, async () => {
      const journal = await this.loadAndNormalize(workspaceId);
      const action = journal.actions.find((candidate) => candidate.actionId === actionId);
      if (!action || !["pending", "delivery_unknown"].includes(action.state) || action.instanceId !== this.instanceId) return;

      const deliveryUnknown = action.state === "delivery_unknown" || action.deliveryUnknownAt !== undefined;
      action.state = deliveryUnknown ? "delivery_unknown" : error ? "threw" : "completed";
      action.finishedAt = nowIso();
      if (error) action.errorName = error instanceof Error ? error.name : typeof error;
      this.claimLease(journal);
      journal.state = unresolvedRecoveryActions(journal, this.instanceId).length > 0
        ? "RECOVERY_REQUIRED"
        : "HEALTHY";
      journal.updatedAt = nowIso();
      trimHistory(journal);
      await this.persist(journal);
    });
  }

  async markSessionDisconnected(workspaceId: string, sessionId: string): Promise<number> {
    return this.withWorkspaceLock(workspaceId, async () => {
      const journal = await this.loadAndNormalize(workspaceId);
      const now = Date.now();
      const nowText = new Date(now).toISOString();
      let marked = 0;
      for (const action of journal.actions) {
        if (action.instanceId !== this.instanceId || action.sessionId !== sessionId) continue;
        if (action.state === "pending") {
          action.state = "delivery_unknown";
          action.deliveryUnknownAt = nowText;
          marked++;
          continue;
        }
        if (
          (action.state === "completed" || action.state === "threw")
          && action.finishedAt
          && now - Date.parse(action.finishedAt) <= RECENT_DELIVERY_WINDOW_MS
        ) {
          action.state = "delivery_unknown";
          action.deliveryUnknownAt = nowText;
          marked++;
        }
      }
      if (marked > 0) {
        journal.recoveryGeneration += 1;
        journal.state = "RECOVERY_REQUIRED";
      } else if (journal.state !== "RECOVERY_REQUIRED") {
        journal.state = "DISCONNECTED";
      }
      journal.updatedAt = nowText;
      await this.persist(journal);
      return marked;
    });
  }

  async status(workspaceId: string): Promise<RecoveryStatus> {
    return this.withWorkspaceLock(workspaceId, async () => {
      const journal = await this.loadAndNormalize(workspaceId);
      const unknownActions = unresolvedRecoveryActions(journal, this.instanceId);
      const inFlightActions = journal.actions.filter(
        (action) => action.state === "pending" && action.instanceId === this.instanceId,
      );
      if (unknownActions.length > 0 && journal.state !== "RECOVERY_REQUIRED") {
        journal.state = "RECOVERY_REQUIRED";
        journal.updatedAt = nowIso();
        await this.persist(journal);
      }
      return {
        workspaceId,
        recoveryGeneration: journal.recoveryGeneration,
        state: unknownActions.length > 0 ? "RECOVERY_REQUIRED" : journal.state,
        unknownActions,
        inFlightActions,
        recentActions: journal.actions.slice(-25),
        lease: journal.lease,
        safeToResumeMutations: unknownActions.length === 0 && this.leaseAvailable(journal),
      };
    });
  }

  async reconcile(input: ReconcileRecoveryInput): Promise<RecoveryStatus> {
    const evidence = input.evidence.trim();
    if (!evidence) throw new Error("Recovery reconciliation requires non-empty evidence.");

    return this.withWorkspaceLock(input.workspaceId, async () => {
      const journal = await this.loadAndNormalize(input.workspaceId);
      this.assertLeaseAvailable(journal);
      if (journal.recoveryGeneration !== input.expectedRecoveryGeneration) {
        throw new RecoveryRequiredError(
          `Recovery generation changed for ${input.workspaceId}: expected ${input.expectedRecoveryGeneration}, current ${journal.recoveryGeneration}. Re-read recovery status before reconciling.`,
        );
      }
      const action = journal.actions.find((candidate) => candidate.actionId === input.actionId);
      if (!action) throw new Error(`Unknown recovery action ${input.actionId}.`);
      if (!isUnresolvedRecoveryAction(action, this.instanceId)) {
        throw new Error(`Action ${input.actionId} is not an unresolved recovery action.`);
      }

      action.state = "reconciled";
      action.reconciledAt = nowIso();
      action.reconciliationOutcome = input.outcome;
      action.reconciliationEvidence = evidence.slice(0, MAX_EVIDENCE_LENGTH);
      journal.recoveryGeneration += 1;
      this.claimLease(journal);
      const unknownActions = unresolvedRecoveryActions(journal, this.instanceId);
      journal.state = unknownActions.length > 0 ? "RECOVERY_REQUIRED" : "READY";
      journal.updatedAt = nowIso();
      trimHistory(journal);
      await this.persist(journal);

      return {
        workspaceId: input.workspaceId,
        recoveryGeneration: journal.recoveryGeneration,
        state: journal.state,
        unknownActions,
        inFlightActions: journal.actions.filter(
          (candidate) => candidate.state === "pending" && candidate.instanceId === this.instanceId,
        ),
        recentActions: journal.actions.slice(-25),
        lease: journal.lease,
        safeToResumeMutations: unknownActions.length === 0,
      };
    });
  }

  private async loadAndNormalize(workspaceId: string): Promise<WorkspaceRecoveryJournal> {
    const journal = await this.readJournal(workspaceId);
    const unknown = unresolvedRecoveryActions(journal, this.instanceId);
    if (unknown.length > 0) journal.state = "RECOVERY_REQUIRED";
    return journal;
  }

  private async readJournal(workspaceId: string): Promise<WorkspaceRecoveryJournal> {
    const path = this.journalPath(workspaceId);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as WorkspaceRecoveryJournal;
      if (parsed.schemaVersion !== 1 || parsed.workspaceId !== workspaceId || !Array.isArray(parsed.actions)) {
        throw new Error("invalid recovery journal shape");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        schemaVersion: 1,
        workspaceId,
        recoveryGeneration: 1,
        state: "HEALTHY",
        updatedAt: nowIso(),
        actions: [],
      };
    }
  }

  private async persist(journal: WorkspaceRecoveryJournal): Promise<void> {
    await mkdir(this.journalDir, { recursive: true, mode: 0o700 });
    const path = this.journalPath(journal.workspaceId);
    const tempPath = `${path}.${this.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(journal, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
  }

  private journalPath(workspaceId: string): string {
    const digest = createHash("sha256").update(workspaceId).digest("hex");
    return join(this.journalDir, `${digest}.json`);
  }

  private claimLease(journal: WorkspaceRecoveryJournal): void {
    const now = nowIso();
    journal.lease = journal.lease?.instanceId === this.instanceId
      ? { ...journal.lease, renewedAt: now }
      : { instanceId: this.instanceId, pid: this.pid, acquiredAt: now, renewedAt: now };
  }

  private assertLeaseAvailable(journal: WorkspaceRecoveryJournal): void {
    if (!this.leaseAvailable(journal)) {
      throw new RecoveryRequiredError(
        `Recovery mutation lease for ${journal.workspaceId} is owned by another live Auvrynt instance (pid ${journal.lease?.pid}). Refusing split-brain mutation.`,
      );
    }
  }

  private leaseAvailable(journal: WorkspaceRecoveryJournal): boolean {
    if (!journal.lease || journal.lease.instanceId === this.instanceId) return true;
    return !processAlive(journal.lease.pid);
  }

  private async withWorkspaceLock<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const key = this.journalPath(workspaceId);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const marker = run.then(() => undefined, () => undefined);
    this.queues.set(key, marker);
    try {
      return await run;
    } finally {
      if (this.queues.get(key) === marker) this.queues.delete(key);
    }
  }
}

const coordinatorCache = new Map<string, RecoveryCoordinator>();

export function recoveryCoordinatorForStateDir(stateDir: string): RecoveryCoordinator {
  const cached = coordinatorCache.get(stateDir);
  if (cached) return cached;
  const coordinator = new RecoveryCoordinator(stateDir);
  coordinatorCache.set(stateDir, coordinator);
  return coordinator;
}

export function replayPolicyForAnnotations(annotations?: RecoveryToolAnnotations): ReplayPolicy {
  if (annotations?.readOnlyHint === true) return "SAFE_REPLAY";
  if (annotations?.idempotentHint === true) return "SAFE_REPLAY";
  if (annotations?.destructiveHint === true) return "NEVER_BLIND_REPLAY";
  return "VERIFY_BEFORE_REPLAY";
}

function unresolvedRecoveryActions(
  journal: WorkspaceRecoveryJournal,
  currentInstanceId: string,
): RecoveryActionRecord[] {
  return journal.actions.filter((action) => isUnresolvedRecoveryAction(action, currentInstanceId));
}

function isUnresolvedRecoveryAction(action: RecoveryActionRecord, currentInstanceId: string): boolean {
  if (action.state === "delivery_unknown") return true;
  return action.state === "pending" && action.instanceId !== currentInstanceId;
}

function extractTargetHints(input: unknown): Record<string, string | number | boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const hints: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!TARGET_KEY_RE.test(key) || PRIVATE_KEY_RE.test(key)) continue;
    if (typeof value === "string") hints[key] = value.slice(0, MAX_TARGET_HINT_LENGTH);
    else if (typeof value === "number" || typeof value === "boolean") hints[key] = value;
  }
  return hints;
}

function fingerprintInput(input: unknown): string {
  const safe = sanitizeForFingerprint(input, 0);
  return createHash("sha256").update(JSON.stringify(safe)).digest("hex");
}

function sanitizeForFingerprint(value: unknown, depth: number): unknown {
  if (depth > 4) return "[depth-limit]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 512 ? `${value.slice(0, 512)}[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeForFingerprint(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value;

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (PRIVATE_KEY_RE.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeForFingerprint((value as Record<string, unknown>)[key], depth + 1);
  }
  return output;
}

function trimHistory(journal: WorkspaceRecoveryJournal): void {
  if (journal.actions.length <= MAX_ACTION_HISTORY) return;
  const unresolved = journal.actions.filter((action) => action.state === "pending" || action.state === "delivery_unknown");
  const settled = journal.actions.filter((action) => action.state !== "pending" && action.state !== "delivery_unknown");
  const keepSettled = settled.slice(-Math.max(0, MAX_ACTION_HISTORY - unresolved.length));
  journal.actions = [...keepSettled, ...unresolved].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function recoveryRequiredMessage(workspaceId: string, actions: RecoveryActionRecord[]): string {
  const summary = actions.slice(0, 5).map((action) => `${action.actionId}:${action.toolName}:${action.replayPolicy}`).join(", ");
  return `Recovery required for workspace ${workspaceId}. ${actions.length} mutation(s) have unknown outcome (${summary}). Read current state first, then reconcile each action before issuing further mutations.`;
}

function nowIso(): string {
  return new Date().toISOString();
}
