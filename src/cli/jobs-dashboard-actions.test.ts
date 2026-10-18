import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { loadConfig } from "../infrastructure/config.js";
import { JobsStore } from "../jobs/store.js";
import { asJobId } from "../jobs/types.js";
import { registerJobsDashboardActions } from "./jobs-dashboard-actions.js";

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-jobs-action-"));
const token = "jobs-dashboard-control-token";
const config = loadConfig({ AUVRYNT_ALLOWED_ROOTS: stateDir, AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough", PORT: "1" });
const store = new JobsStore(stateDir);
const handlers = new Map<string, (req: Request, res: Response) => void | Promise<void>>();
const fakeApp = { post(path: string, handler: (req: Request, res: Response) => void | Promise<void>) { handlers.set(path, handler); } };
const runningServer = { app: fakeApp, jobsStore: store } as any;
registerJobsDashboardActions({ runningServer, config, dashboardControlToken: token });

interface FakeResponse {
  statusCode: number;
  body?: unknown;
  headers: Record<string, string>;
  status(code: number): FakeResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
}
function response(): FakeResponse {
  const result: FakeResponse = { statusCode: 200, headers: {}, status(code) { result.statusCode = code; return result; }, json(body) { result.body = body; }, setHeader(name, value) { result.headers[name] = value; }, end() {} };
  return result;
}
function request(body: unknown, headers: Record<string, string | undefined> = {}, params: Record<string, string> = {}): Request {
  const values = new Map(Object.entries({ "x-auvrynt-dashboard-token": token, origin: "http://127.0.0.1:1", ...headers }).map(([key, value]) => [key.toLowerCase(), value]));
  return { body, params, socket: { remoteAddress: "127.0.0.1" }, header: (name: string) => values.get(name.toLowerCase()) } as unknown as Request;
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const add = handlers.get("/__auvrynt/dashboard/jobs/add");
  const status = handlers.get("/__auvrynt/dashboard/jobs/:id/status");
  const archive = handlers.get("/__auvrynt/dashboard/jobs/:id/archive");
  const profile = handlers.get("/__auvrynt/dashboard/jobs/profile");
  assert.ok(add && status && archive && profile);

  const missingToken = response();
  await add(request({ title: "Bad", description: "This should be rejected because the token is missing." }, { "x-auvrynt-dashboard-token": undefined }), missingToken as unknown as Response);
  assert.equal(missingToken.statusCode, 404);
  await wait(550);

  const invalid = response();
  await add(request({ title: "", description: "A valid description that should not be accepted without a title." }), invalid as unknown as Response);
  assert.equal(invalid.statusCode, 422);
  assert.equal((invalid.body as any).error.code, "VALIDATION_ERROR");
  await wait(550);

  const invalidType = response();
  await add(request({ title: "Bad", description: "A valid description with a malformed company field.", company: 12 }), invalidType as unknown as Response);
  assert.equal(invalidType.statusCode, 422);
  await wait(550);

  const created = response();
  await add(request({ title: "Gameplay Programmer", company: "Studio", description: "Build gameplay systems with C# and Unity.", url: "https://jobs.example/gameplay", remoteStatus: "remote" }), created as unknown as Response);
  assert.equal(created.statusCode, 200);
  const jobId = (created.body as any).data.id as string;
  await wait(550);

  const changed = response();
  await status(request({ status: "SHORTLISTED" }, {}, { id: jobId }), changed as unknown as Response);
  assert.equal(changed.statusCode, 200);
  assert.equal((changed.body as any).data.status, "SHORTLISTED");
  await wait(550);

  const unknownStatusField = response();
  await status(request({ status: "OFFER", unexpected: true }, {}, { id: jobId }), unknownStatusField as unknown as Response);
  assert.equal(unknownStatusField.statusCode, 422);
  await wait(550);

  const unknownArchiveField = response();
  await archive(request({ unexpected: true }, {}, { id: jobId }), unknownArchiveField as unknown as Response);
  assert.equal(unknownArchiveField.statusCode, 422);
  await wait(550);

  const profileResponse = response();
  await profile(request({ targetRoles: ["Gameplay Programmer"], primarySkills: ["Unity"], secondarySkills: [], experienceLevels: [], negativeKeywords: [], minimumMatchScore: 70, remote: true, hybridAcceptable: true, onsiteOptional: false }), profileResponse as unknown as Response);
  assert.equal(profileResponse.statusCode, 200);
  assert.deepEqual((profileResponse.body as any).data.targetRoles, ["Gameplay Programmer"]);
  assert.equal(store.getJob(asJobId(jobId))?.matchLevel, "EXCELLENT");
  await wait(550);

  const hostileOrigin = response();
  await status(request({ status: "OFFER" }, { origin: "https://attacker.example" }, { id: jobId }), hostileOrigin as unknown as Response);
  assert.equal(hostileOrigin.statusCode, 404);
  console.log("jobs dashboard action tests passed");
} finally {
  store.close();
}
