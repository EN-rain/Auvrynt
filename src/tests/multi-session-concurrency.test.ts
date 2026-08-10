import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SessionRegistry } from "../auth/session-registry.js";
import { getRequestContext, runWithContext } from "../infrastructure/request-context.js";

const config = {
  logging: {
    level: "silent" as const,
    format: "json" as const,
    requests: false,
    assets: false,
    toolCalls: false,
    shellCommands: false,
  },
};

const closedSessions = new Set<string>();
const registry = new SessionRegistry(config, {
  maxSessions: 5,
  maxSessionsPerOwner: 5,
  startCleanupTimer: false,
});

function createActiveSession(ownerClientId: string): string {
  const reservation = registry.reserve(ownerClientId);
  assert.ok(reservation);
  const sessionId = `sess_${randomUUID()}`;
  const transport = {
    sessionId,
    close: async () => { closedSessions.add(sessionId); },
  } as any;
  const server = {
    close: async () => { closedSessions.add(sessionId); },
  } as any;
  registry.create(reservation, transport, server);
  registry.transition(sessionId, "active");
  return sessionId;
}

const ownerClientId = "shared-openai-oauth-client";
const sessionIds = Array.from({ length: 5 }, () => createActiveSession(ownerClientId));

const concurrentToolCalls = sessionIds.map((sessionId, index) => {
  assert.equal(registry.beginRequest(sessionId, true), true);
  assert.equal(registry.bindLogicalSession(sessionId, `chat-${index + 1}`), true);
  return runWithContext(
    {
      sessionId,
      ownerClientId,
      authScopes: ["auvrynt:read"],
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 5 + (index % 3)));
      assert.equal(getRequestContext()?.sessionId, sessionId, "request context must remain isolated after awaits");
      assert.equal(registry.get(sessionId)?.state, "active");
      assert.equal(registry.get(sessionId)?.inFlightRequests, 1);
      assert.equal(registry.get(sessionId)?.inFlightToolCalls, 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return sessionId;
    },
  ).finally(() => registry.endRequest(sessionId, true));
});

const spareReservations = Array.from({ length: 20 }, () => registry.reserve(ownerClientId));
assert.equal(
  spareReservations.filter(Boolean).length,
  0,
  "the hard five-session limit must reject every additional initialization",
);
assert.ok(
  sessionIds.every((sessionId) => registry.get(sessionId)?.state === "active"),
  "capacity pressure must not close sessions with concurrent tool calls",
);
assert.equal(closedSessions.size, 0);
assert.ok(
  sessionIds.every((sessionId) => !registry.canTerminate(sessionId)),
  "client termination must be blocked while tool calls are active",
);

const completed = await Promise.all(concurrentToolCalls);
assert.deepEqual(new Set(completed), new Set(sessionIds));
assert.ok(sessionIds.every((sessionId) => registry.get(sessionId)?.inFlightRequests === 0));
assert.ok(sessionIds.every((sessionId) => registry.get(sessionId)?.inFlightToolCalls === 0));
assert.ok(sessionIds.every((sessionId) => registry.get(sessionId)?.state === "active"));
assert.ok(sessionIds.every((sessionId) => registry.canTerminate(sessionId)));
assert.equal(closedSessions.size, 0, "five simultaneous tool calls must complete without disconnection");

for (const reservation of spareReservations) registry.release(reservation);
await registry.closeAll("server_shutdown");
registry.close();

console.log("Multi-session concurrency tests passed!");
