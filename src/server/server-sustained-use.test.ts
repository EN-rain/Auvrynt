import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../infrastructure/config.js";
import { hardenHttpServer } from "../infrastructure/http-server-hardening.js";
import { createServer } from "../server.js";

const stateDir = await mkdtemp(join(tmpdir(), "auvrynt-server-soak-"));
const config = loadConfig({
  AUVRYNT_ALLOWED_ROOTS: process.cwd(),
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  AUVRYNT_STATE_DIR: stateDir,
  AUVRYNT_LOG_LEVEL: "silent",
  AUVRYNT_LOG_REQUESTS: "0",
  AUVRYNT_SKILLS: "0",
  PORT: "1",
});

const running = createServer(config);
const httpServer = running.app.listen(0, "127.0.0.1");
hardenHttpServer(httpServer);

try {
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let batch = 0; batch < 20; batch++) {
    const responses = await Promise.all(
      Array.from({ length: 25 }, async (_value, index) => {
        if (index % 3 === 0) return fetch(`${baseUrl}/healthz`);
        if (index % 3 === 1) return fetch(`${baseUrl}/readyz`);
        return fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: batch * 25 + index, method: "initialize", params: {} }),
        });
      }),
    );

    for (const response of responses) {
      assert.notEqual(response.status, 502);
      assert.ok(response.status === 200 || response.status === 401);
      await response.arrayBuffer();
    }

    const profileUpdate = await running.updateIntegrations({
      godotGdscript: batch % 2 === 0,
      godotCsharp: batch % 3 === 0,
      blender: batch % 2 === 1,
      aseprite: batch % 5 === 0,
      serena: false,
      playwright: batch % 4 === 0,
      context7: false,
      obsidian: false,
      roblox: false,
    });
    assert.equal(profileUpdate.updated, true);
    assert.equal(profileUpdate.closedSessions, 0);
  }

  const ready = await fetch(`${baseUrl}/readyz`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json() as { ready?: boolean }).ready, true);
} finally {
  httpServer.closeIdleConnections();
  await new Promise<void>((resolve) => {
    const forceClose = setTimeout(() => httpServer.closeAllConnections(), 1_000);
    httpServer.close(() => {
      clearTimeout(forceClose);
      resolve();
    });
  });
  await running.close();
  await rm(stateDir, { recursive: true, force: true });
}

console.log("Server sustained-use HTTP soak tests passed!");
