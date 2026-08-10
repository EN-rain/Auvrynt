import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  configureHttpSocket,
  hardenHttpServer,
  HTTP_REQUEST_TIMEOUT_MS,
  HTTP_HEADERS_TIMEOUT_MS,
  HTTP_KEEP_ALIVE_TIMEOUT_MS,
  HTTP_SOCKET_KEEP_ALIVE_DELAY_MS,
  HTTP_MAX_HEADERS_COUNT,
  HTTP_MAX_REQUESTS_PER_SOCKET,
} from "./http-server-hardening.js";

const server = createServer();
hardenHttpServer(server);

assert.equal(server.requestTimeout, HTTP_REQUEST_TIMEOUT_MS);
assert.equal(server.headersTimeout, HTTP_HEADERS_TIMEOUT_MS);
assert.equal(server.keepAliveTimeout, HTTP_KEEP_ALIVE_TIMEOUT_MS);
assert.equal(server.timeout, 0);
assert.equal(server.maxHeadersCount, HTTP_MAX_HEADERS_COUNT);
assert.equal(server.maxRequestsPerSocket, HTTP_MAX_REQUESTS_PER_SOCKET);

const calls: unknown[][] = [];
configureHttpSocket({
  setKeepAlive: (...args: unknown[]) => { calls.push(["keepAlive", ...args]); return undefined as never; },
  setNoDelay: (...args: unknown[]) => { calls.push(["noDelay", ...args]); return undefined as never; },
} as never);
assert.deepEqual(calls, [
  ["keepAlive", true, HTTP_SOCKET_KEEP_ALIVE_DELAY_MS],
  ["noDelay", true],
]);

console.log("HTTP server hardening tests passed!");
