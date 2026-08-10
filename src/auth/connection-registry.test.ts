import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { identifyProvider, readConnectedClients, recordConnectedClient } from "./connection-registry.js";

assert.equal(identifyProvider("ChatGPT Desktop", "mcp-client/1.0"), "ChatGPT");
assert.equal(identifyProvider("Grok", "xai-mcp-client/1.0"), "Grok");
assert.equal(identifyProvider(undefined, "xai/1.0"), "Grok / xAI");
assert.equal(identifyProvider(undefined, "Kimi/1.2"), "Kimi");
assert.equal(identifyProvider("custom-agent", undefined), "custom-agent");

const stateDir = mkdtempSync(`${tmpdir()}\\auvrynt-connections-test-`);
recordConnectedClient(stateDir, { clientName: "ChatGPT", userAgent: "ChatGPT/1.0\nsecret" });
recordConnectedClient(stateDir, { clientName: "ChatGPT", userAgent: "ChatGPT/1.1" });
const clients = readConnectedClients(stateDir);
assert.equal(clients.length, 1);
assert.equal(clients[0].requestCount, 2);
assert.equal(clients[0].userAgent?.includes("\n"), false);
assert.equal(readFileSync(`${stateDir}\\connections.json`, "utf8").includes("secret"), false);

writeFileSync(`${stateDir}\\connections.json`, JSON.stringify([
  { provider: "valid", lastSeen: new Date().toISOString(), requestCount: 1 },
  { provider: 42, lastSeen: "not-a-date", requestCount: "many" },
]));
const recovered = readConnectedClients(stateDir);
assert.equal(recovered.length, 1);
assert.equal(recovered[0].provider, "valid");

console.log("Connection registry unit tests passed!");
