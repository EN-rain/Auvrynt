import assert from "node:assert/strict";
import { McpRequestTimingWindow, mcpRequestKind } from "./request-timing.js";

assert.equal(mcpRequestKind({ method: "initialize" }), "initialize");
assert.equal(mcpRequestKind({ method: "tools/list" }), "tools/list");
assert.equal(mcpRequestKind({ method: "tools/call", params: { name: "read" } }), "tools/call:read");
assert.equal(mcpRequestKind(undefined, "GET"), "transport:get");
assert.equal(mcpRequestKind([{ method: "tools/call" }, { method: "tools/list" }]), "batch:2");
assert.equal(mcpRequestKind(null), "unknown");

const window = new McpRequestTimingWindow(8);
for (let index = 1; index <= 10; index++) {
  window.record("tools/call:read", {
    authMs: index,
    preDispatchMs: index * 2,
    dispatchMs: index * 3,
    totalMs: index * 4,
  });
}
const snapshot = window.snapshot();
const bucket = snapshot.kinds["tools/call:read"]!;
assert.equal(bucket.samples, 8, "window must retain only the newest bounded samples");
assert.equal(bucket.totalMs.count, 8);
assert.equal(bucket.totalMs.p50, 24);
assert.equal(bucket.totalMs.p95, 40);
assert.equal(bucket.authMs?.p99, 10);

console.log("MCP request timing tests passed!");
