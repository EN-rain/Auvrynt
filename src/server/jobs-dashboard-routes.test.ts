import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { loadConfig } from "../infrastructure/config.js";
import { ingestManualJob } from "../jobs/pipeline.js";
import { JobsStore } from "../jobs/store.js";
import { registerJobsDashboardRoutes } from "./jobs-dashboard-routes.js";

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-jobs-routes-"));
try {
  const config = loadConfig({ AUVRYNT_ALLOWED_ROOTS: stateDir, AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough", PORT: "1" });
  const store = new JobsStore(stateDir);
  ingestManualJob(store, { title: "Route Test Job", company: "Test Co", description: "A job description that is long enough for the route fixture.", url: "https://jobs.example/route" });
  const handlers = new Map<string, (req: Request, res: Response) => void | Promise<void>>();
  registerJobsDashboardRoutes({ app: { get(path, handler) { handlers.set(path, handler); } }, config, jobsStore: store, nonce: () => "route-test-nonce", dashboardControlToken: "route-test-token", pid: 1234 });
  const createRequest = (path: string, remoteAddress = "127.0.0.1"): Request => ({ path, url: path, query: {}, params: {}, socket: { remoteAddress } } as unknown as Request);
  const createResponse = (): any => {
    const response: any = { statusCode: 200, body: undefined, headers: {}, status(code: number) { response.statusCode = code; return response; }, json(body: unknown) { response.body = body; }, end() { response.ended = true; }, setHeader(name: string, value: string) { response.headers[name] = value; }, type() { return response; }, send(body: unknown) { response.body = body; } };
    return response;
  };
  const dataResponse = createResponse();
  await handlers.get("/dashboard/jobs/data")!(createRequest("/dashboard/jobs/data"), dataResponse);
  assert.equal(dataResponse.statusCode, 200);
  assert.equal(dataResponse.body.opportunities.pagination.totalItems, 1);
  assert.equal(dataResponse.body.integrations[1].provider, "facebook");
  const invalidQueryResponse = createResponse();
  await handlers.get("/dashboard/jobs/opportunities")!( { ...createRequest("/dashboard/jobs/opportunities"), query: { status: "NOT_A_STATUS" } } as unknown as Request, invalidQueryResponse);
  assert.equal(invalidQueryResponse.statusCode, 422);
  const unknownQueryResponse = createResponse();
  await handlers.get("/dashboard/jobs/opportunities")!( { ...createRequest("/dashboard/jobs/opportunities"), query: { unexpected: "1" } } as unknown as Request, unknownQueryResponse);
  assert.equal(unknownQueryResponse.statusCode, 422);
  const pageResponse = createResponse();
  await handlers.get("/dashboard/jobs")!(createRequest("/dashboard/jobs"), pageResponse);
  assert.match(pageResponse.body, /Auvrynt Jobs/);
  assert.match(pageResponse.body, /aria-label="Auvrynt product modes"/);
  const remoteResponse = createResponse();
  await handlers.get("/dashboard/jobs/data")!(createRequest("/dashboard/jobs/data", "192.0.2.10"), remoteResponse);
  assert.equal(remoteResponse.statusCode, 404);
  const detailResponse = createResponse();
  const job = store.listAllJobs()[0];
  await handlers.get("/dashboard/jobs/opportunities/:id")!( { ...createRequest("/dashboard/jobs/opportunities/" + job.id), params: { id: job.id } } as unknown as Request, detailResponse);
  assert.equal(detailResponse.body.id, job.id);
  store.close();
  console.log("jobs dashboard route tests passed");
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
