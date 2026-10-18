import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeOpenPencilBridge } from "./open-pencil-health.js";

const root = mkdtempSync(join(tmpdir(), "auvrynt-open-pencil-health-"));
const discovery = join(root, "mcp.json");
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: serverState, version: "0.15.1" }));
});
let serverState = "no_app";
try {
  assert.equal((await probeOpenPencilBridge(discovery)).state, "not_running");
  writeFileSync(discovery, "{}");
  assert.equal((await probeOpenPencilBridge(discovery)).state, "invalid_discovery");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  writeFileSync(discovery, JSON.stringify({ httpPort: addr.port }));
  assert.equal((await probeOpenPencilBridge(discovery)).state, "no_app",
    "A running HTTP service without an attached editor must not appear connected");
  serverState = "ok";
  assert.equal((await probeOpenPencilBridge(discovery)).state, "connected");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
}
console.log("OpenPencil native editor health tests passed.");
