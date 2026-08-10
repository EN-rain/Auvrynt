import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  HARD_MAX_SESSIONS,
  SessionRegistry,
  type SessionRecord,
} from "./session-registry.js";

const loggingConfig = {
  level: "silent" as const,
  format: "json" as const,
  requests: false,
  assets: false,
  toolCalls: false,
  shellCommands: false,
};
const config = { logging: loggingConfig };
assert.equal(HARD_MAX_SESSIONS, 99999, "the MCP server must never allow more than 99999 sessions");
assert.equal(DEFAULT_SESSION_IDLE_TIMEOUT_MS, 12 * 60 * 60 * 1000, "idle sessions should remain available for 12 hours");
assert.equal(DEFAULT_DISCONNECT_GRACE_MS, 0, "idle cleanup should not add a grace period");

function makeTransport(closeCounter?: { value: number }): any {
  return {
    sessionId: `sess_${randomUUID()}`,
    close: async () => { if (closeCounter) closeCounter.value++; },
  };
}

function makeServer(closeCounter?: { value: number }): any {
  return {
    close: async () => { if (closeCounter) closeCounter.value++; },
  };
}

function createSession(
  registry: SessionRegistry,
  ownerClientId: string,
  closeCounter?: { value: number },
): SessionRecord {
  const reservation = registry.reserve(ownerClientId);
  assert.ok(reservation, `expected capacity for ${ownerClientId}`);
  return registry.create(
    reservation,
    makeTransport(),
    makeServer(closeCounter),
  );
}

{
  let now = 0;
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, { now: () => now, startCleanupTimer: false });
  const session = createSession(registry, "client1", closed);
  registry.transition(session.sessionId, "active");

  now = DEFAULT_SESSION_IDLE_TIMEOUT_MS - 1;
  await registry.cleanupNow();
  assert.equal(registry.get(session.sessionId)?.state, "active", "active session must survive until the 12-hour idle deadline");

  now = DEFAULT_SESSION_IDLE_TIMEOUT_MS;
  assert.equal(await registry.cleanupNow(), 1);
  assert.equal(registry.get(session.sessionId), undefined, "idle session should close immediately at the deadline");
  assert.equal(closed.value, 1, "idle session server must be closed");
  registry.close();
}

{
  let now = 0;
  const registry = new SessionRegistry(config, { now: () => now, startCleanupTimer: false });
  const session = createSession(registry, "client1");
  registry.transition(session.sessionId, "active");
  assert.equal(registry.beginRequest(session.sessionId, true), true);

  now = DEFAULT_SESSION_IDLE_TIMEOUT_MS + DEFAULT_DISCONNECT_GRACE_MS + 1;
  await registry.cleanupNow();
  assert.equal(
    registry.get(session.sessionId)?.state,
    "active",
    "an in-flight QA tool call must not be disconnected or expired",
  );

  registry.endRequest(session.sessionId, true);
  await registry.cleanupNow();
  assert.equal(registry.get(session.sessionId)?.state, "active", "request completion refreshes activity");
  registry.close();
}

{
  let now = 0;
  const closed = { value: 0 };
  const disconnectGraceMs = 1_000;
  const registry = new SessionRegistry(config, {
    now: () => now,
    disconnectGraceMs,
    startCleanupTimer: false,
  });
  const session = createSession(registry, "client1", closed);
  registry.transition(session.sessionId, "active");
  registry.transition(session.sessionId, "disconnected");

  now = disconnectGraceMs - 1;
  await registry.cleanupNow();
  assert.equal(registry.get(session.sessionId)?.state, "disconnected");

  now = disconnectGraceMs;
  assert.equal(await registry.cleanupNow(), 1);
  assert.equal(registry.get(session.sessionId), undefined);
  assert.equal(closed.value, 1, "expired session server must be closed");
  registry.close();
}

{
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, {
    maxSessions: 1,
    maxSessionsPerOwner: 1,
    startCleanupTimer: false,
  });
  const active = createSession(registry, "client1", closed);
  registry.transition(active.sessionId, "active");

  assert.equal(registry.canCreate("client1"), false);
  assert.equal(registry.reserve("client1"), undefined);
  assert.ok(registry.get(active.sessionId), "capacity checks must not evict an active session");
  assert.equal(closed.value, 0, "capacity checks must be side-effect free for recent active sessions");
  registry.close();
}

{
  let now = 0;
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, {
    now: () => now,
    maxSessions: 2,
    maxSessionsPerOwner: 2,
    startCleanupTimer: false,
  });
  const oldest = createSession(registry, "client1", closed);
  registry.transition(oldest.sessionId, "active");
  now = 50;
  const current = createSession(registry, "client1", closed);
  registry.transition(current.sessionId, "active");

  now = 60_000;
  assert.equal(registry.reserve("client1"), undefined, "active sessions must never be reclaimed for capacity");
  assert.ok(registry.get(oldest.sessionId));
  assert.ok(registry.get(current.sessionId));

  registry.transition(oldest.sessionId, "disconnected");
  const replacement = registry.reserve("client1");
  assert.ok(replacement, "an already disconnected session should be recoverable under capacity pressure");
  assert.equal(registry.get(oldest.sessionId)?.state, "closing");
  assert.ok(registry.get(current.sessionId));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registry.get(oldest.sessionId), undefined);
  assert.equal(closed.value, 1);
  registry.release(replacement);
  registry.close();
}

{
  const registry = new SessionRegistry(config, {
    maxSessions: 4,
    maxSessionsPerOwner: 4,
    startCleanupTimer: false,
  });

  const reservations = await Promise.all(
    Array.from({ length: 20 }, async () => registry.reserve("client1")),
  );
  const accepted = reservations.filter((reservation) => reservation !== undefined);
  assert.equal(accepted.length, 4, "concurrent initialization reservations must not oversubscribe capacity");
  assert.equal(registry.occupiedCount(), 4);
  for (const reservation of accepted) registry.release(reservation);
  assert.equal(registry.occupiedCount(), 0);
  registry.close();
}

{
  const registry = new SessionRegistry(config, {
    maxSessions: 5,
    maxSessionsPerOwner: 5,
    startCleanupTimer: false,
  });
  registry.updateLimits(1);
  const first = registry.reserve("client1");
  assert.ok(first);
  assert.equal(registry.reserve("client1"), undefined, "lowering the live limit must apply immediately");
  registry.updateLimits(3);
  const second = registry.reserve("client1");
  const third = registry.reserve("client1");
  assert.ok(second);
  assert.ok(third);
  assert.equal(registry.reserve("client1"), undefined, "raising the live limit must stop at the new value");
  registry.release(first);
  registry.release(second);
  registry.release(third);
  registry.close();
}

{
  let now = 0;
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, {
    now: () => now,
    maxSessions: HARD_MAX_SESSIONS,
    maxSessionsPerOwner: HARD_MAX_SESSIONS,
    startCleanupTimer: false,
  });
  const sessions = Array.from({ length: 3 }, () => {
    const session = createSession(registry, "client1", closed);
    registry.transition(session.sessionId, "active");
    assert.equal(registry.beginRequest(session.sessionId), true);
    return session;
  });

  now = 60_000;
  const remainingReservations = Array.from(
    { length: HARD_MAX_SESSIONS - sessions.length },
    () => registry.reserve("client1"),
  );
  assert.ok(remainingReservations.every((reservation) => reservation !== undefined));
  assert.equal(
    registry.reserve("client1"),
    undefined,
    "the 1000th slot must be rejected at the hard maximum of 999",
  );
  assert.equal(closed.value, 0);
  assert.ok(sessions.every((session) => registry.get(session.sessionId)?.state === "active"));
  assert.equal(registry.occupiedCount(), HARD_MAX_SESSIONS);

  await Promise.all(sessions.map(async (session, index) => {
    await new Promise((resolve) => setTimeout(resolve, index % 3));
    registry.endRequest(session.sessionId);
  }));
  assert.ok(sessions.every((session) => registry.get(session.sessionId)?.inFlightRequests === 0));
  for (const reservation of remainingReservations) registry.release(reservation);
  registry.close();
}

{
  const registry = new SessionRegistry(config, {
    maxSessions: 1,
    maxSessionsPerOwner: 1,
    startCleanupTimer: false,
  });
  const abandoned = registry.reserve("client1");
  assert.ok(abandoned);
  assert.equal(registry.reserve("client1"), undefined);
  assert.equal(registry.release(abandoned), true);
  assert.ok(registry.reserve("client1"), "released initialization must free its reserved slot");
  registry.close();
}

{
  const registry = new SessionRegistry(config, { startCleanupTimer: false });
  const session = createSession(registry, "owner1");
  registry.transition(session.sessionId, "active");
  assert.equal(registry.beginRequest(session.sessionId), true);
  assert.equal(registry.markClosing(session.sessionId, "client_delete"), true);
  assert.equal(registry.handleTransportClosed(session.sessionId), true);
  assert.equal(registry.get(session.sessionId), undefined, "a truly closed transport must be removed immediately");
  registry.endRequest(session.sessionId);
  registry.close();
}

{
  const transportClosed = { value: 0 };
  const registry = new SessionRegistry(config, {
    closeTimeoutMs: 10,
    startCleanupTimer: false,
  });
  const reservation = registry.reserve("owner1");
  assert.ok(reservation);
  const session = registry.create(
    reservation,
    makeTransport(transportClosed),
    { close: () => new Promise<void>(() => {}) } as any,
  );
  registry.transition(session.sessionId, "active");

  await registry.closeSession(session.sessionId, "server_shutdown");
  assert.equal(registry.get(session.sessionId), undefined);
  assert.equal(transportClosed.value, 1, "a stuck MCP server close must fall back to transport close");
  registry.close();
}

{
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, { startCleanupTimer: false });
  const sessions = Array.from({ length: 5 }, () => {
    const session = createSession(registry, "owner1", closed);
    registry.transition(session.sessionId, "active");
    return session;
  });

  await registry.closeAll("server_shutdown");
  assert.equal(registry.allRecords().length, 0);
  assert.equal(closed.value, sessions.length);
  registry.close();
}

{
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, { startCleanupTimer: false });
  const original = createSession(registry, "owner1", closed);
  const replacement = createSession(registry, "owner1", closed);
  registry.transition(original.sessionId, "active");
  registry.transition(replacement.sessionId, "active");

  assert.equal(registry.beginRequest(original.sessionId, true), true);
  assert.equal(registry.bindLogicalSession(original.sessionId, "chat-session-1"), true);
  assert.equal(registry.beginRequest(replacement.sessionId, true), true);
  assert.equal(registry.bindLogicalSession(replacement.sessionId, "chat-session-1"), true);
  assert.ok(registry.get(original.sessionId), "an in-flight predecessor must not close immediately");
  assert.equal(closed.value, 0);

  registry.endRequest(replacement.sessionId, true);
  assert.ok(registry.get(replacement.sessionId));
  registry.endRequest(original.sessionId, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registry.get(original.sessionId), undefined, "completed reconnect predecessor should be retired");
  assert.equal(registry.get(replacement.sessionId)?.state, "active");
  assert.equal(closed.value, 1);
  registry.close();
}

{
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, { startCleanupTimer: false });
  let latestSessionId = "";
  for (let index = 0; index < 10; index++) {
    const session = createSession(registry, "owner1", closed);
    latestSessionId = session.sessionId;
    registry.transition(session.sessionId, "active");
    assert.equal(registry.beginRequest(session.sessionId, true), true);
    assert.equal(registry.bindLogicalSession(session.sessionId, "single-chat"), true);
    registry.endRequest(session.sessionId, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(registry.activeCount(), 1, "same-chat reconnects must not accumulate active transports");
    assert.equal(registry.get(latestSessionId)?.state, "active");
  }
  assert.equal(closed.value, 9);
  registry.close();
}

{
  const registry = new SessionRegistry(config, { startCleanupTimer: false });
  const session = createSession(registry, "owner1");
  registry.bindWorkspace(session.sessionId, "myroom", "workspace1");
  assert.equal(registry.get(session.sessionId)?.roomId, "myroom");
  assert.equal(registry.get(session.sessionId)?.workspaceId, "workspace1");
  registry.transition(session.sessionId, "disconnected");
  assert.equal(registry.activeCount(), 1, "disconnected grace records still occupy the registry");
  assert.equal(registry.connectedCount(), 0, "disconnected grace records must not appear as connected agents");
  assert.equal(registry.touch(session.sessionId), true);

  assert.equal(registry.get(session.sessionId)?.state, "active");
  assert.equal(registry.connectedCount(), 1);
  assert.equal(registry.get(session.sessionId)?.disconnectedAt, undefined);
  assert.equal(registry.findByOwner("owner1").length, 1);
  assert.equal(registry.findByRoom("myroom").length, 1);
  assert.ok(registry.remove(session.sessionId));
  assert.equal(registry.get(session.sessionId), undefined);
  registry.close();
}

console.log("Session registry tests passed!");
