import assert from "node:assert/strict";
import { BoundedMcpEventStore } from "./mcp-event-store.js";

let now = 1_000;
const store = new BoundedMcpEventStore({
  maxEvents: 3,
  retentionMs: 12 * 60 * 60 * 1000,
  now: () => now,
});

const first = await store.storeEvent("stream-a", { jsonrpc: "2.0", method: "first" });
now += 1;
const second = await store.storeEvent("stream-a", { jsonrpc: "2.0", method: "second" });
now += 1;
await store.storeEvent("stream-b", { jsonrpc: "2.0", method: "other" });

const replayed: string[] = [];
assert.equal(
  await store.replayEventsAfter(first, {
    send: async (_eventId, message) => {
      if ("method" in message) replayed.push(message.method);
    },
  }),
  "stream-a",
);
assert.deepEqual(replayed, ["second"]);
assert.equal(await store.getStreamIdForEventId(second), "stream-a");

now += 1;
await store.storeEvent("stream-a", { jsonrpc: "2.0", method: "third" });
assert.equal(store.size(), 3);
assert.equal(await store.getStreamIdForEventId(first), undefined);

now += 12 * 60 * 60 * 1000 + 1;
assert.equal(store.size(), 0);
assert.equal(store.byteSize(), 0);
assert.equal(await store.replayEventsAfter(second, { send: async () => undefined }), "");

{
  const byteBounded = new BoundedMcpEventStore({
    maxEvents: 100,
    maxBytes: 900,
    maxEventBytes: 500,
  });
  for (let index = 0; index < 20; index++) {
    await byteBounded.storeEvent("stream-byte", {
      jsonrpc: "2.0",
      id: index,
      result: { payload: "x".repeat(200) },
    });
  }
  assert.ok(byteBounded.byteSize() <= 900);
  assert.ok(byteBounded.size() < 20);
}

{
  const oversized = new BoundedMcpEventStore({
    maxBytes: 1_024,
    maxEventBytes: 200,
  });
  const marker = await oversized.storeEvent("stream-large", {
    jsonrpc: "2.0",
    id: 7,
    result: { payload: "y".repeat(1_000) },
  });
  const replayedMessages: unknown[] = [];
  await oversized.storeEvent("stream-large", {
    jsonrpc: "2.0",
    id: 8,
    result: { ok: true },
  });
  await oversized.replayEventsAfter(marker, {
    send: async (_eventId, message) => { replayedMessages.push(message); },
  });
  assert.equal(replayedMessages.length, 1);
  assert.ok(oversized.byteSize() <= 1_024);
}

console.log("MCP event store tests passed!");
