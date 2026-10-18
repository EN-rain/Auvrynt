import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { loadConfig } from "../infrastructure/config.js";
import { JobsStore } from "../jobs/store.js";
import { FacebookOAuthManager } from "../jobs/integrations/facebook/facebook-oauth.js";
import { registerJobsDashboardActions } from "../cli/jobs-dashboard-actions.js";
import { registerJobsDashboardRoutes } from "./jobs-dashboard-routes.js";

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-facebook-routes-"));
const config = loadConfig({
  AUVRYNT_ALLOWED_ROOTS: stateDir,
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  AUVRYNT_JOBS_FACEBOOK_ENABLED: "1",
  AUVRYNT_JOBS_FACEBOOK_APP_ID: "test-app-id",
  AUVRYNT_JOBS_FACEBOOK_APP_SECRET: "test-app-secret",
  PORT: "49321",
});
const store = new JobsStore(stateDir);
const token = "facebook-dashboard-control-token";
const posts = new Map<string, (req: Request, res: Response) => void | Promise<void>>();
const gets = new Map<string, (req: Request, res: Response) => void | Promise<void>>();
const manager = new FacebookOAuthManager({
  fetch: async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth/access_token")) return { ok: true, status: 200, async json() { return { access_token: "route-token" }; } };
    if (url.includes("/me?fields=id%2Cname")) return { ok: true, status: 200, async json() { return { id: "route-account", name: "Route User" }; } };
    return { ok: false, status: 404, async json() { return {}; } };
  },
});
const app = {
  post(path: string, handler: (req: Request, res: Response) => void | Promise<void>) { posts.set(path, handler); },
  get(path: string, handler: (req: Request, res: Response) => void | Promise<void>) { gets.set(path, handler); },
};
const runningServer = { app, jobsStore: store, facebookOAuth: manager } as any;
registerJobsDashboardActions({ runningServer, config, dashboardControlToken: token, facebookOAuth: manager });
registerJobsDashboardRoutes({ app, config, jobsStore: store, nonce: () => "nonce", dashboardControlToken: token, pid: 1234, facebookOAuth: manager });

function request(body: unknown, headers: Record<string, string | undefined> = {}, query: Record<string, unknown> = {}): Request {
  const values = new Map(Object.entries({ "x-auvrynt-dashboard-token": token, origin: "http://127.0.0.1:49321", ...headers }).map(([key, value]) => [key.toLowerCase(), value]));
  return { body, query, params: {}, socket: { remoteAddress: "127.0.0.1" }, header: (name: string) => values.get(name.toLowerCase()) } as unknown as Request;
}
function response(): any {
  const result: any = { statusCode: 200, body: undefined, headers: {}, status(code: number) { result.statusCode = code; return result; }, json(body: unknown) { result.body = body; }, setHeader(name: string, value: string) { result.headers[name] = value; }, end() { result.ended = true; }, redirect(code: number, location: string) { result.redirectCode = code; result.location = location; } };
  return result;
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const connect = posts.get("/__auvrynt/dashboard/jobs/facebook/connect");
  const disconnect = posts.get("/__auvrynt/dashboard/jobs/facebook/disconnect");
  const callback = gets.get("/dashboard/jobs/integrations/facebook/callback");
  assert.ok(connect && disconnect && callback);

  const started = response();
  await connect(request({}), started as unknown as Response);
  assert.equal(started.statusCode, 200);
  const authorizationUrl = new URL((started.body as any).data.authorizationUrl);
  assert.equal(authorizationUrl.searchParams.get("client_id"), "test-app-id");
  await wait(550);

  const completed = response();
  await callback(request(undefined, {}, { state: authorizationUrl.searchParams.get("state")!, code: "route-code" }), completed as unknown as Response);
  assert.equal(completed.redirectCode, 303);
  assert.match(completed.location, /facebook=connected/);
  assert.equal(store.listIntegrations().find((item) => item.provider === "facebook")?.status, "connected");
  await wait(550);

  const disconnected = response();
  await disconnect(request({}), disconnected as unknown as Response);
  assert.equal(disconnected.statusCode, 200);
  assert.equal((disconnected.body as any).data.status, "disabled");
  await wait(550);

  const malformed = response();
  await connect(request({ unexpected: true }), malformed as unknown as Response);
  assert.equal(malformed.statusCode, 422);
  console.log("jobs dashboard facebook route tests passed");
} finally {
  store.close();
  rmSync(stateDir, { recursive: true, force: true });
}
