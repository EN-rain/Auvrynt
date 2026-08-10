import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { loadConfig } from "../config.js";
import { registerDashboardActions } from "./dashboard-actions.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-dashboard-tools-"));
const configDir = join(root, "config");
process.env.AUVRYNT_CONFIG_DIR = configDir;

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): void;
  end(): void;
}

const createFakeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
    },
    end() {},
  };
  return res;
};

const createFakeReq = (body: unknown, path = "/__auvrynt/dashboard/tools"): Request => {
  const req = {
    body,
    path,
    url: path,
    method: "POST",
    header: (name: string) => (name.toLowerCase() === "x-auvrynt-dashboard" ? "1" : undefined),
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
  return req;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const handlers = new Map<string, (req: Request, res: Response) => void | Promise<void>>();
  const fakeApp = {
    post: (path: string, handler: (req: Request, res: Response) => void | Promise<void>) => {
      handlers.set(path, handler);
    },
    get: () => {},
  } as unknown as { post: ReturnType<typeof fakeAppPost> };
  function fakeAppPost() {}

  let refreshCalls = 0;
  const runningServer = {
    app: fakeApp,
    refreshToolAvailability: () => {
      refreshCalls += 1;
    },
  } as any;

  registerDashboardActions({ runningServer, config, requestShutdown: () => {} });

  const toolsHandler = handlers.get("/__auvrynt/dashboard/tools");
  assert.ok(toolsHandler, "tools action handler registered");

  const disableRes = createFakeRes();
  await toolsHandler(createFakeReq({ integration: "blender", name: "blender_ping", enabled: false }), disableRes as unknown as Response);
  assert.equal(disableRes.statusCode, 200);
  assert.equal(config.toolToggles["blender_ping"], false);
  assert.equal(refreshCalls, 1);
  assert.deepEqual((disableRes.body as any).toolToggles, { blender_ping: false });
  await sleep(550);

  const enableRes = createFakeRes();
  await toolsHandler(createFakeReq({ integration: "blender", name: "blender_ping", enabled: true }), enableRes as unknown as Response);
  assert.equal(enableRes.statusCode, 200);
  assert.equal("blender_ping" in config.toolToggles, false, "re-enabling must delete the toggle key");
  assert.equal(refreshCalls, 2);
  await sleep(550);

  const invalidRes = createFakeRes();
  await toolsHandler(createFakeReq({ integration: "blender", name: "blender_ping" }), invalidRes as unknown as Response);
  assert.equal(invalidRes.statusCode, 400, "missing enabled boolean must be rejected");
  await sleep(550);

  const badIntegrationRes = createFakeRes();
  await toolsHandler(createFakeReq({ integration: "not-an-integration", name: "blender_ping", enabled: false }), badIntegrationRes as unknown as Response);
  assert.equal(badIntegrationRes.statusCode, 400, "unknown integration must be rejected");
  await sleep(550);

  const groupRes = createFakeRes();
  await toolsHandler(createFakeReq({ integration: "serena", group: "Sessions", groupEnabled: false }), groupRes as unknown as Response);
  assert.equal(groupRes.statusCode, 200);
  assert.equal(refreshCalls, 3);
  await sleep(550);

  const bareRes = createFakeRes();
  await toolsHandler(createFakeReq({ integration: "serena" }), bareRes as unknown as Response);
  assert.equal(bareRes.statusCode, 400, "body without name or group must be rejected");
  await sleep(550);

  const unauthorizedRes = createFakeRes();
  const externalReq = createFakeReq({ integration: "blender", name: "blender_ping", enabled: false });
  externalReq.socket = { remoteAddress: "203.0.113.7" } as any;
  await toolsHandler(externalReq, unauthorizedRes as unknown as Response);
  assert.equal(unauthorizedRes.statusCode, 404, "non-loopback requests must be rejected");
  assert.equal("blender_ping" in config.toolToggles, false);
} finally {
  await rm(root, { recursive: true, force: true });
  delete process.env.AUVRYNT_CONFIG_DIR;
}

console.log("Dashboard tools action tests passed!");
