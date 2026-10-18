import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { logEvent, sessionIdPrefix } from "../logger.js";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_MCP_SESSIONS,
  DEFAULT_MCP_SESSIONS_PER_CLIENT,
  MAX_MCP_SESSIONS,
  MAX_SESSION_IDLE_TIMEOUT_MS,
  MIN_SESSION_IDLE_TIMEOUT_MS,
  type ServerConfig,
} from "../config.js";

export { DEFAULT_SESSION_IDLE_TIMEOUT_MS } from "../config.js";

export type SessionState = "creating" | "active" | "disconnected" | "closing" | "expired";
export type SessionCloseReason =
  | "client_delete"
  | "server_shutdown"
  | "transport_closed"
  | "idle_timeout"
  | "disconnect_grace_expired"
  | "capacity_recovery"
  | "never_initialized"
  | "initialization_failed"
  | "superseded_by_logical_session"
  | "closing_stuck";

type Transport = StreamableHTTPServerTransport;

export interface SessionRecord {
  sessionId: string;
  ownerClientId: string;
  state: SessionState;
  transport: Transport;
  mcpServer: McpServer;
  roomId?: string;
  workspaceId?: string;
  createdAt: number;
  ordinal: number;
  lastActivityAt: number;
  disconnectedAt?: number;
  logicalSessionId?: string;
  supersededBySessionId?: string;
  inFlightRequests: number;
  inFlightToolCalls: number;
  closingReason?: SessionCloseReason;
}

export interface SessionReservation {
  reservationId: string;
  ownerClientId: string;
  createdAt: number;
}

export interface SessionRegistryOptions {
  now?: () => number;
  sessionIdleTimeoutMs?: number;
  disconnectGraceMs?: number;
  reservationTimeoutMs?: number;
  closeTimeoutMs?: number;
  cleanupIntervalMs?: number;
  maxSessions?: number;
  maxSessionsPerOwner?: number;
  startCleanupTimer?: boolean;
}

export const DEFAULT_DISCONNECT_GRACE_MS = 0;
export const DEFAULT_SESSION_RESERVATION_TIMEOUT_MS = 60 * 1000;
export const DEFAULT_SESSION_CLOSE_TIMEOUT_MS = 5 * 1000;
export const DEFAULT_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;
export const HARD_MAX_SESSIONS = MAX_MCP_SESSIONS;
export const DEFAULT_MAX_SESSIONS = DEFAULT_MCP_SESSIONS;
export const DEFAULT_MAX_SESSIONS_PER_OWNER = DEFAULT_MCP_SESSIONS_PER_CLIENT;

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly reservations = new Map<string, SessionReservation>();
  private readonly closingPromises = new Map<string, Promise<void>>();
  private readonly cleanupTimer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private sessionIdleTimeoutMs: number;
  private readonly disconnectGraceMs: number;
  private readonly reservationTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly cleanupIntervalMs: number;
  private maxSessions: number;
  private maxSessionsPerOwner: number;
  private cleanupInFlight = false;
  private nextSessionOrdinal = 1;

  constructor(
    private readonly config: Pick<ServerConfig, "logging">,
    options: SessionRegistryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sessionIdleTimeoutMs = boundedPositiveMs(
      options.sessionIdleTimeoutMs,
      positiveEnvMs("AUVRYNT_SESSION_IDLE_MS", DEFAULT_SESSION_IDLE_TIMEOUT_MS),
      MIN_SESSION_IDLE_TIMEOUT_MS,
      MAX_SESSION_IDLE_TIMEOUT_MS,
    );
    this.disconnectGraceMs = nonNegativeMs(
      options.disconnectGraceMs,
      nonNegativeEnvMs("AUVRYNT_DISCONNECT_GRACE_MS", DEFAULT_DISCONNECT_GRACE_MS),
    );
    this.reservationTimeoutMs = positiveMs(
      options.reservationTimeoutMs,
      DEFAULT_SESSION_RESERVATION_TIMEOUT_MS,
    );
    this.closeTimeoutMs = positiveMs(options.closeTimeoutMs, DEFAULT_SESSION_CLOSE_TIMEOUT_MS);
    this.cleanupIntervalMs = positiveMs(options.cleanupIntervalMs, DEFAULT_SESSION_CLEANUP_INTERVAL_MS);
    this.maxSessions = Math.min(
      HARD_MAX_SESSIONS,
      positiveInteger(
        options.maxSessions,
        positiveEnvInteger("AUVRYNT_MAX_SESSIONS", DEFAULT_MAX_SESSIONS),
      ),
    );
    this.maxSessionsPerOwner = Math.min(
      HARD_MAX_SESSIONS,
      this.maxSessions,
      positiveInteger(
        options.maxSessionsPerOwner,
        positiveEnvInteger("AUVRYNT_MAX_SESSIONS_PER_CLIENT", DEFAULT_MAX_SESSIONS_PER_OWNER),
      ),
    );

    if (options.startCleanupTimer !== false) {
      this.cleanupTimer = setInterval(() => void this.cleanupSafely(), this.cleanupIntervalMs);
      this.cleanupTimer.unref();
    }
  }

  reserve(ownerClientId: string): SessionReservation | undefined {
    this.reclaimCapacity(ownerClientId);
    if (!this.hasCapacity(ownerClientId)) return undefined;

    const reservation: SessionReservation = {
      reservationId: `reservation_${randomUUID()}`,
      ownerClientId,
      createdAt: this.now(),
    };
    this.reservations.set(reservation.reservationId, reservation);
    return reservation;
  }

  create(
    reservation: SessionReservation,
    transport: Transport,
    mcpServer: McpServer,
    roomId?: string,
    workspaceId?: string,
  ): SessionRecord {
    const storedReservation = this.reservations.get(reservation.reservationId);
    if (!storedReservation || storedReservation.ownerClientId !== reservation.ownerClientId) {
      throw new Error("Unknown or released session reservation");
    }

    const sessionId = transport.sessionId;
    if (!sessionId) throw new Error("Transport has no sessionId");
    if (this.sessions.has(sessionId)) throw new Error(`Duplicate session: ${sessionId}`);

    this.reservations.delete(reservation.reservationId);
    const now = this.now();
    const record: SessionRecord = {
      sessionId,
      ownerClientId: storedReservation.ownerClientId,
      state: "creating",
      transport,
      mcpServer,
      roomId,
      workspaceId,
      createdAt: now,
      ordinal: this.nextSessionOrdinal++,
      lastActivityAt: now,
      inFlightRequests: 0,
      inFlightToolCalls: 0,
    };

    this.sessions.set(sessionId, record);
    return record;
  }

  release(reservation: SessionReservation | undefined): boolean {
    if (!reservation) return false;
    const stored = this.reservations.get(reservation.reservationId);
    if (!stored || stored.ownerClientId !== reservation.ownerClientId) return false;
    return this.reservations.delete(reservation.reservationId);
  }

  canCreate(ownerClientId?: string): boolean {
    return this.hasCapacity(ownerClientId);
  }

  isAtCapacity(): boolean {
    return this.occupiedCount() >= this.maxSessions;
  }

  updateLimits(maxSessions: number, maxSessionsPerOwner = maxSessions): void {
    this.maxSessions = Math.min(HARD_MAX_SESSIONS, positiveInteger(maxSessions, DEFAULT_MAX_SESSIONS));
    this.maxSessionsPerOwner = Math.min(
      this.maxSessions,
      HARD_MAX_SESSIONS,
      positiveInteger(maxSessionsPerOwner, this.maxSessions),
    );
  }

  updateSessionIdleTimeout(timeoutMs: number): void {
    this.sessionIdleTimeoutMs = boundedPositiveMs(
      timeoutMs,
      DEFAULT_SESSION_IDLE_TIMEOUT_MS,
      MIN_SESSION_IDLE_TIMEOUT_MS,
      MAX_SESSION_IDLE_TIMEOUT_MS,
    );
  }

  occupiedCount(): number {
    return this.occupyingSessionCount() + this.reservations.size;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  require(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown session: ${sessionId}`);
    return record;
  }

  transition(sessionId: string, newState: SessionState): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    const oldState = record.state;
    const now = this.now();
    record.state = newState;
    record.lastActivityAt = now;
    record.disconnectedAt = newState === "disconnected" ? now : undefined;
    if (newState !== "closing") record.closingReason = undefined;
    logEvent(this.config.logging, "debug", "session_state", {
      sessionIdPrefix: sessionIdPrefix(sessionId),
      oldState,
      newState,
    });
  }

  touch(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.state === "closing" || record.state === "expired") return false;
    record.lastActivityAt = this.now();
    if (record.state === "disconnected") {
      record.state = "active";
      record.disconnectedAt = undefined;
    }
    return true;
  }

  canTerminate(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    return record.state !== "closing" && record.inFlightToolCalls === 0;
  }

  beginRequest(sessionId: string, isToolCall = false): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.state === "closing" || record.state === "expired") return false;
    record.inFlightRequests += 1;
    if (isToolCall) record.inFlightToolCalls += 1;
    this.touch(sessionId);
    return true;
  }

  endRequest(sessionId: string, isToolCall = false): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.inFlightRequests = Math.max(0, record.inFlightRequests - 1);
    if (isToolCall) record.inFlightToolCalls = Math.max(0, record.inFlightToolCalls - 1);
    record.lastActivityAt = this.now();
    if (record.supersededBySessionId && record.inFlightRequests === 0) {
      void this.closeSession(record.sessionId, "superseded_by_logical_session");
    }
  }

  bindLogicalSession(sessionId: string, logicalSessionId: string): boolean {
    const normalized = logicalSessionId.trim();
    if (!normalized || normalized.length > 256) return false;

    const record = this.sessions.get(sessionId);
    if (!record || record.state === "closing" || record.state === "expired") return false;
    if (record.logicalSessionId && record.logicalSessionId !== normalized) {
      logEvent(this.config.logging, "warn", "logical_session_rebind_rejected", {
        sessionIdPrefix: sessionIdPrefix(sessionId),
      });
      return false;
    }

    record.logicalSessionId = normalized;
    record.lastActivityAt = this.now();
    const matching = [...this.sessions.values()].filter((candidate) =>
      candidate.ownerClientId === record.ownerClientId
      && candidate.logicalSessionId === normalized
      && candidate.state !== "closing"
      && candidate.state !== "expired"
    );
    if (matching.length < 2) return true;

    const newest = matching.reduce((current, candidate) =>
      candidate.ordinal > current.ordinal ? candidate : current
    );
    for (const candidate of matching) {
      if (candidate.sessionId === newest.sessionId) continue;
      if (candidate.supersededBySessionId === newest.sessionId) continue;
      candidate.supersededBySessionId = newest.sessionId;
      logEvent(this.config.logging, "info", "mcp_session_superseded", {
        sessionIdPrefix: sessionIdPrefix(candidate.sessionId),
        replacementSessionIdPrefix: sessionIdPrefix(newest.sessionId),
        reason: "same_logical_chat",
        inFlightRequests: candidate.inFlightRequests,
        inFlightToolCalls: candidate.inFlightToolCalls,
      });
      if (candidate.inFlightRequests === 0) {
        void this.closeSession(candidate.sessionId, "superseded_by_logical_session");
      }
    }
    return true;
  }

  bindWorkspace(sessionId: string, roomId: string, workspaceId: string): void {
    const record = this.require(sessionId);
    if (record.state === "closing" || record.state === "expired") {
      throw new Error(`Session ${sessionId} is closing`);
    }
    record.roomId = roomId;
    record.workspaceId = workspaceId;
    record.lastActivityAt = this.now();
  }

  unbindWorkspace(sessionId: string, workspaceId?: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    if (workspaceId !== undefined && record.workspaceId !== workspaceId) return false;
    if (record.workspaceId === undefined && record.roomId === undefined) return false;
    record.roomId = undefined;
    record.workspaceId = undefined;
    record.lastActivityAt = this.now();
    return true;
  }

  unbindWorkspaceEverywhere(workspaceId: string): number {
    let unbound = 0;
    for (const record of this.sessions.values()) {
      if (record.workspaceId !== workspaceId) continue;
      if (this.unbindWorkspace(record.sessionId, workspaceId)) unbound++;
    }
    return unbound;
  }

  markClosing(sessionId: string, reason: SessionCloseReason): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    if (record.state !== "closing") {
      const oldState = record.state;
      record.state = "closing";
      record.closingReason = reason;
      record.lastActivityAt = this.now();
      logEvent(this.config.logging, "debug", "session_state", {
        sessionIdPrefix: sessionIdPrefix(sessionId),
        oldState,
        newState: "closing",
        reason,
      });
    } else if (!record.closingReason) {
      record.closingReason = reason;
    }
    return true;
  }

  handleTransportClosed(
    sessionId: string,
    fallbackReason: SessionCloseReason = "transport_closed",
  ): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;

    this.sessions.delete(sessionId);
    record.state = "expired";
    const reason = record.closingReason ?? fallbackReason;
    logEvent(this.config.logging, "info", "mcp_session_closed", {
      sessionIdPrefix: sessionIdPrefix(sessionId),
      reason,
      inFlightRequests: record.inFlightRequests,
      inFlightToolCalls: record.inFlightToolCalls,
    });
    return true;
  }

  async closeSession(sessionId: string, reason: SessionCloseReason): Promise<boolean> {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    this.markClosing(sessionId, reason);
    await this.closeRecord(record);
    return true;
  }

  async closeAll(reason: SessionCloseReason = "server_shutdown"): Promise<void> {
    this.reservations.clear();
    const records = [...this.sessions.values()];
    await Promise.allSettled(records.map((record) => this.closeSession(record.sessionId, reason)));
  }

  remove(sessionId: string): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    if (record) this.sessions.delete(sessionId);
    return record;
  }

  findByOwner(ownerClientId: string): SessionRecord[] {
    return [...this.sessions.values()].filter((record) => record.ownerClientId === ownerClientId);
  }

  findByRoom(roomId: string): SessionRecord[] {
    return [...this.sessions.values()].filter((record) => record.roomId === roomId);
  }

  activeCount(): number {
    let count = 0;
    for (const record of this.sessions.values()) {
      if (record.state === "active" || record.state === "disconnected") count++;
    }
    return count;
  }

  connectedCount(): number {
    let count = 0;
    for (const record of this.sessions.values()) {
      if (record.state === "active") count++;
    }
    return count;
  }

  countByState(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of this.sessions.values()) {
      counts[record.state] = (counts[record.state] || 0) + 1;
    }
    if (this.reservations.size > 0) counts.reserved = this.reservations.size;
    return counts;
  }

  allRecords(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  close(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.reservations.clear();
  }

  async cleanupNow(now = this.now()): Promise<number> {
    let cleaned = 0;

    for (const [reservationId, reservation] of this.reservations) {
      if (now - reservation.createdAt < this.reservationTimeoutMs) continue;
      this.reservations.delete(reservationId);
      cleaned++;
      logEvent(this.config.logging, "warn", "session_reservation_expired", {
        reservationIdPrefix: reservationId.slice(0, 20),
      });
    }

    const closePromises: Promise<unknown>[] = [];
    for (const record of this.sessions.values()) {
      if (record.state === "expired") {
        closePromises.push(this.closeSession(record.sessionId, record.closingReason ?? "transport_closed"));
        cleaned++;
        continue;
      }

      if (record.state === "disconnected" && record.disconnectedAt !== undefined) {
        if (now - record.disconnectedAt >= this.disconnectGraceMs && record.inFlightRequests === 0) {
          closePromises.push(this.closeSession(record.sessionId, "disconnect_grace_expired"));
          cleaned++;
        }
        continue;
      }

      if (
        record.state === "active"
        && record.inFlightRequests === 0
        && now - record.lastActivityAt >= this.sessionIdleTimeoutMs
      ) {
        if (this.disconnectGraceMs === 0) {
          closePromises.push(this.closeSession(record.sessionId, "idle_timeout"));
          cleaned++;
          continue;
        }
        const oldState = record.state;
        record.state = "disconnected";
        record.disconnectedAt = now;
        record.lastActivityAt = now;
        logEvent(this.config.logging, "info", "session_disconnected", {
          sessionIdPrefix: sessionIdPrefix(record.sessionId),
          oldState,
          reason: "idle_timeout",
        });
        continue;
      }

      if (record.state === "creating" && now - record.lastActivityAt >= this.reservationTimeoutMs) {
        closePromises.push(this.closeSession(record.sessionId, "never_initialized"));
        cleaned++;
        continue;
      }

      if (record.state === "closing" && now - record.lastActivityAt >= this.cleanupIntervalMs) {
        record.closingReason ??= "closing_stuck";
        closePromises.push(this.closeRecord(record));
      }
    }

    await Promise.allSettled(closePromises);
    return cleaned;
  }

  private async cleanupSafely(): Promise<void> {
    if (this.cleanupInFlight) return;
    this.cleanupInFlight = true;
    try {
      await this.cleanupNow();
    } finally {
      this.cleanupInFlight = false;
    }
  }

  private hasCapacity(ownerClientId?: string): boolean {
    if (this.occupiedCount() >= this.maxSessions) return false;
    if (!ownerClientId) return true;
    return this.ownerOccupancy(ownerClientId) < this.maxSessionsPerOwner;
  }

  private reclaimCapacity(ownerClientId: string): void {
    const ownerOverage = this.ownerOccupancy(ownerClientId) - this.maxSessionsPerOwner + 1;
    if (ownerOverage > 0) this.reclaimSessions(ownerOverage, ownerClientId);

    const globalOverage = this.occupiedCount() - this.maxSessions + 1;
    if (globalOverage > 0) this.reclaimSessions(globalOverage);
  }

  private reclaimSessions(count: number, ownerClientId?: string): void {
    if (count <= 0) return;
    const now = this.now();
    const candidates = [...this.sessions.values()]
      .filter((record) => {
        if (ownerClientId && record.ownerClientId !== ownerClientId) return false;
        if (record.inFlightRequests > 0 || record.state === "closing") return false;
        return record.state === "expired" || record.state === "disconnected";
      })
      .sort((left, right) => {
        const stateDifference = recoveryPriority(left.state) - recoveryPriority(right.state);
        return stateDifference || evictionTimestamp(left) - evictionTimestamp(right);
      })
      .slice(0, count);

    for (const record of candidates) {
      const previousState = record.state;
      const idleMs = Math.max(0, now - record.lastActivityAt);
      this.markClosing(record.sessionId, "capacity_recovery");
      logEvent(this.config.logging, "info", "session_reclaimed", {
        sessionIdPrefix: sessionIdPrefix(record.sessionId),
        reason: "capacity_recovery",
        previousState,
        idleMs,
      });
      void this.closeRecord(record);
    }
  }

  private ownerOccupancy(ownerClientId: string): number {
    let count = 0;
    for (const record of this.sessions.values()) {
      if (record.ownerClientId === ownerClientId && occupiesCapacity(record)) count++;
    }
    for (const reservation of this.reservations.values()) {
      if (reservation.ownerClientId === ownerClientId) count++;
    }
    return count;
  }

  private occupyingSessionCount(): number {
    let count = 0;
    for (const record of this.sessions.values()) {
      if (occupiesCapacity(record)) count++;
    }
    return count;
  }

  private closeRecord(record: SessionRecord): Promise<void> {
    const existing = this.closingPromises.get(record.sessionId);
    if (existing) return existing;

    const promise = (async () => {
      try {
        await withTimeout(
          record.mcpServer.close(),
          this.closeTimeoutMs,
          `Timed out closing MCP session ${sessionIdPrefix(record.sessionId)}`,
        );
      } catch (error) {
        logEvent(this.config.logging, "warn", "session_close_failed", {
          sessionIdPrefix: sessionIdPrefix(record.sessionId),
          reason: record.closingReason,
          error: error instanceof Error ? error.message : String(error),
        });
        await record.transport.close().catch(() => undefined);
      } finally {
        this.handleTransportClosed(record.sessionId, record.closingReason ?? "transport_closed");
      }
    })();

    this.closingPromises.set(record.sessionId, promise);
    void promise.finally(() => {
      if (this.closingPromises.get(record.sessionId) === promise) {
        this.closingPromises.delete(record.sessionId);
      }
    });
    return promise;
  }
}

function occupiesCapacity(record: SessionRecord): boolean {
  return record.state !== "closing" && record.state !== "expired";
}

function evictionTimestamp(record: SessionRecord): number {
  return record.disconnectedAt ?? record.lastActivityAt;
}

function recoveryPriority(state: SessionState): number {
  if (state === "expired") return 0;
  if (state === "disconnected") return 1;
  if (state === "creating") return 2;
  if (state === "active") return 3;
  return 4;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function positiveEnvMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeEnvMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveEnvInteger(name: string, fallback: number): number {
  return positiveInteger(Number(process.env[name]), fallback);
}

function positiveMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function boundedPositiveMs(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const resolved = positiveMs(value, fallback);
  return Math.min(maximum, Math.max(minimum, resolved));
}

function nonNegativeMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 0 ? value! : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}
