import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
  headers: Record<string, string>;
  status(code: number): FakeRes;
  setHeader(name: string, value: string): FakeRes;
  json(payload: unknown): void;
  end(): void;
}

const createFakeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
    },
    end() {},
  };
  return res;
};

const DASHBOARD_CONTROL_TOKEN = "dashboard-test-control-token";

const createFakeReq = (
  body: unknown,
  path = "/__auvrynt/dashboard/tools",
  headers: Record<string, string | undefined> = {},
): Request => {
  const normalizedHeaders = new Map(
    Object.entries({
      "x-auvrynt-dashboard-token": DASHBOARD_CONTROL_TOKEN,
      origin: "http://127.0.0.1:1",
      ...headers,
    }).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const req = {
    body,
    path,
    url: path,
    method: "POST",
    header: (name: string) => normalizedHeaders.get(name.toLowerCase()),
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
    updateWorkspaceRoots: (roots: string[]) => {
      config.allowedRoots.splice(0, config.allowedRoots.length, ...roots);
      return { updated: true, activeToolCalls: 0, closedWorkspaces: 0 };
    },
    refreshToolAvailability: () => {
      refreshCalls += 1;
    },
  } as any;

  registerDashboardActions({
    runningServer,
    config,
    dashboardControlToken: DASHBOARD_CONTROL_TOKEN,
    requestShutdown: () => {},
  });

  const toolsHandler = handlers.get("/__auvrynt/dashboard/tools");
  assert.ok(toolsHandler, "tools action handler registered");

  const directoriesHandler = handlers.get("/__auvrynt/dashboard/directories");
  assert.ok(directoriesHandler, "directories action handler registered");
  const webAgentSecretHandler = handlers.get("/__auvrynt/dashboard/web-agent-secret");
  assert.ok(webAgentSecretHandler, "web-agent secret action handler registered");
  const webAgentSecretRes = createFakeRes();
  await webAgentSecretHandler(createFakeReq({}, "/__auvrynt/dashboard/web-agent-secret"), webAgentSecretRes as unknown as Response);
  assert.equal(webAgentSecretRes.statusCode, 200);
  assert.deepEqual(webAgentSecretRes.body, { secret: config.oauth.ownerToken });
  assert.equal(webAgentSecretRes.headers["cache-control"], "no-store");
  await sleep(550);
  const malformedWebAgentSecretRes = createFakeRes();
  await webAgentSecretHandler(
    createFakeReq({ unexpected: true }, "/__auvrynt/dashboard/web-agent-secret"),
    malformedWebAgentSecretRes as unknown as Response,
  );
  assert.equal(malformedWebAgentSecretRes.statusCode, 400, "web-agent secret action must reject unknown fields");
  await sleep(550);
  const unauthorizedWebAgentSecretRes = createFakeRes();
  await webAgentSecretHandler(
    createFakeReq({}, "/__auvrynt/dashboard/web-agent-secret", { origin: "https://attacker.example" }),
    unauthorizedWebAgentSecretRes as unknown as Response,
  );
  assert.equal(unauthorizedWebAgentSecretRes.statusCode, 404, "hostile Origin must not read the web-agent secret");
  await sleep(550);
  const extraRoot = join(root, "agent-assets");
  await mkdir(extraRoot);
  const malformedDirectoryRes = createFakeRes();
  await directoriesHandler(createFakeReq(null, "/__auvrynt/dashboard/directories"), malformedDirectoryRes as unknown as Response);
  assert.equal(malformedDirectoryRes.statusCode, 400, "null directory bodies must be rejected");
  const unknownDirectoryFieldRes = createFakeRes();
  await directoriesHandler(
    createFakeReq({ action: "add", path: extraRoot, unexpected: true }, "/__auvrynt/dashboard/directories"),
    unknownDirectoryFieldRes as unknown as Response,
  );
  assert.equal(unknownDirectoryFieldRes.statusCode, 400, "unknown directory fields must be rejected");
  const addDirectoryRes = createFakeRes();
  await directoriesHandler(createFakeReq({ action: "add", path: extraRoot }, "/__auvrynt/dashboard/directories"), addDirectoryRes as unknown as Response);
  assert.equal(addDirectoryRes.statusCode, 200);
  assert.deepEqual(config.allowedRoots, [root, extraRoot]);
  assert.deepEqual((addDirectoryRes.body as any).allowedRoots, [root, extraRoot]);

  const removeDirectoryRes = createFakeRes();
  await directoriesHandler(createFakeReq({ action: "remove", index: 1 }, "/__auvrynt/dashboard/directories"), removeDirectoryRes as unknown as Response);
  assert.equal(removeDirectoryRes.statusCode, 200);
  assert.deepEqual(config.allowedRoots, [root]);

  const concurrentRoot = join(root, "agent-assets-concurrent");
  const competingRoot = join(root, "agent-assets-competing");
  await mkdir(concurrentRoot);
  await mkdir(competingRoot);
  const concurrentAddRes = createFakeRes();
  const concurrentAdd = directoriesHandler(
    createFakeReq({ action: "add", path: concurrentRoot }, "/__auvrynt/dashboard/directories"),
    concurrentAddRes as unknown as Response,
  );
  const competingAddRes = createFakeRes();
  await directoriesHandler(
    createFakeReq({ action: "add", path: competingRoot }, "/__auvrynt/dashboard/directories"),
    competingAddRes as unknown as Response,
  );
  assert.equal(competingAddRes.statusCode, 409, "concurrent directory mutations must be serialized");
  await concurrentAdd;
  assert.equal(concurrentAddRes.statusCode, 200);
  assert.deepEqual(config.allowedRoots, [root, concurrentRoot]);

  const removeConcurrentRes = createFakeRes();
  await directoriesHandler(createFakeReq({ action: "remove", index: 1 }, "/__auvrynt/dashboard/directories"), removeConcurrentRes as unknown as Response);
  assert.equal(removeConcurrentRes.statusCode, 200);
  assert.deepEqual(config.allowedRoots, [root]);

  const removeLastDirectoryRes = createFakeRes();
  await directoriesHandler(createFakeReq({ action: "remove", index: 0 }, "/__auvrynt/dashboard/directories"), removeLastDirectoryRes as unknown as Response);
  assert.equal(removeLastDirectoryRes.statusCode, 400, "the last allowed root must be protected");
  assert.deepEqual(config.allowedRoots, [root]);
  await sleep(550);

  const maxExtraRoots: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const extra = join(root, `agent-assets-${index}`);
    await mkdir(extra);
    maxExtraRoots.push(extra);
  }
  for (const extra of maxExtraRoots) {
    const addRes = createFakeRes();
    await directoriesHandler(createFakeReq({ action: "add", path: extra }, "/__auvrynt/dashboard/directories"), addRes as unknown as Response);
    assert.equal(addRes.statusCode, 200);
  }
  assert.equal(config.allowedRoots.length, 5);
  const sixthRoot = join(root, "agent-assets-sixth");
  await mkdir(sixthRoot);
  const maxRes = createFakeRes();
  await directoriesHandler(createFakeReq({ action: "add", path: sixthRoot }, "/__auvrynt/dashboard/directories"), maxRes as unknown as Response);
  assert.equal(maxRes.statusCode, 409, "a sixth agent-access directory must be rejected");
  assert.match(String((maxRes.body as any).error), /maximum of 5/i);
  assert.equal(config.allowedRoots.length, 5);
  await sleep(550);

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

  const missingTokenRes = createFakeRes();
  await toolsHandler(
    createFakeReq(
      { integration: "blender", name: "blender_ping", enabled: false },
      undefined,
      { "x-auvrynt-dashboard-token": undefined },
    ),
    missingTokenRes as unknown as Response,
  );
  assert.equal(missingTokenRes.statusCode, 404, "missing dashboard control token must be rejected");

  const badTokenRes = createFakeRes();
  await toolsHandler(
    createFakeReq(
      { integration: "blender", name: "blender_ping", enabled: false },
      undefined,
      { "x-auvrynt-dashboard-token": "wrong-token" },
    ),
    badTokenRes as unknown as Response,
  );
  assert.equal(badTokenRes.statusCode, 404, "invalid dashboard control token must be rejected");

  const hostileOriginRes = createFakeRes();
  await toolsHandler(
    createFakeReq(
      { integration: "blender", name: "blender_ping", enabled: false },
      undefined,
      { origin: "https://attacker.example" },
    ),
    hostileOriginRes as unknown as Response,
  );
  assert.equal(hostileOriginRes.statusCode, 404, "hostile Origin must be rejected");

  const unauthorizedRes = createFakeRes();
  const externalReq = createFakeReq({ integration: "blender", name: "blender_ping", enabled: false });
  externalReq.socket = { remoteAddress: "203.0.113.7" } as any;
  (externalReq as any).ip = "127.0.0.1";
  await toolsHandler(externalReq, unauthorizedRes as unknown as Response);
  assert.equal(unauthorizedRes.statusCode, 404, "non-loopback socket must be rejected even if req.ip is spoofed");
  assert.equal("blender_ping" in config.toolToggles, false);
} finally {
  await rm(root, { recursive: true, force: true });
  delete process.env.AUVRYNT_CONFIG_DIR;
}

console.log("Dashboard tools action tests passed!");
