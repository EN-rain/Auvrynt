import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachSseHeartbeat } from "./sse-heartbeat.js";

class FakeResponse extends EventEmitter {
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  readonly headers = new Map<string, unknown>();
  readonly writes: string[] = [];

  getHeader(name: string): unknown {
    return this.headers.get(name.toLowerCase());
  }

  setHeader(name: string, value: unknown): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  write(chunk: unknown): boolean {
    this.writes.push(String(chunk));
    return true;
  }
}

{
  const response = new FakeResponse();
  const heartbeat = attachSseHeartbeat(response as never, 5);
  assert.equal(response.getHeader("cache-control"), "no-cache, no-transform");
  assert.equal(response.getHeader("x-accel-buffering"), "no");

  response.headersSent = true;
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  await new Promise((resolve) => setTimeout(resolve, 30));
  heartbeat.stop();
  assert.ok(response.writes.length >= 1);
  assert.ok(response.writes.every((value) => value.startsWith(": auvrynt-heartbeat ")));
}

{
  const response = new FakeResponse();
  const heartbeat = attachSseHeartbeat(response as never, 5);
  response.headersSent = true;
  response.setHeader("content-type", "application/json");
  await new Promise((resolve) => setTimeout(resolve, 12));
  response.emit("finish");
  heartbeat.stop();
  assert.equal(response.writes.length, 0);
}

{
  const response = new FakeResponse();
  const heartbeat = attachSseHeartbeat(response as never, 5);
  response.headersSent = true;
  response.setHeader("content-type", "text/event-stream");
  response.destroyed = true;
  await new Promise((resolve) => setTimeout(resolve, 10));
  heartbeat.stop();
  assert.equal(response.writes.length, 0);
}

console.log("SSE heartbeat tests passed!");
