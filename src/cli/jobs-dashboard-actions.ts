import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { isLoopbackRequest, logEvent } from "../logger.js";
import { ingestManualJob, refreshProfileMatches, updateManualJob } from "../jobs/pipeline.js";
import { asJobId, asProfileId, TRACKER_STATUSES, type JobInput, type JobProfile, type JobUpdateInput } from "../jobs/types.js";
import type { ServerConfig } from "../infrastructure/config.js";
import type { RunningServer } from "../server.js";
import { httpUrl } from "./runtime-support.js";
import { FACEBOOK_CALLBACK_PATH, FacebookOAuthError, type FacebookOAuthManager } from "../jobs/integrations/facebook/facebook-oauth.js";

export function registerJobsDashboardActions(options: {
  runningServer: RunningServer;
  config: ServerConfig;
  dashboardControlToken: string;
  facebookOAuth?: FacebookOAuthManager;
}): void {
  const { runningServer, config, dashboardControlToken, facebookOAuth } = options;
  const store = runningServer.jobsStore;
  if (!store) return;
  const origins = new Set([httpUrl("127.0.0.1", config.port), httpUrl("localhost", config.port), httpUrl(config.host, config.port)]);
  let lastActionAt = 0;
  const authorized = (req: Request): boolean => {
    if (!isLoopbackRequest(req)) return false;
    const provided = req.header("x-auvrynt-dashboard-token");
    if (!provided) return false;
    const actual = Buffer.from(provided); const expected = Buffer.from(dashboardControlToken);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const origin = req.header("origin");
    return Boolean(origin && origins.has(origin));
  };
  const guard = (req: Request, res: Response): boolean => {
    if (!authorized(req)) { res.status(404).end(); return false; }
    const now = Date.now();
    if (now - lastActionAt < 500) { res.status(429).json(apiError("RATE_LIMITED", "Please wait before repeating a Jobs action.")); return false; }
    lastActionAt = now;
    return true;
  };
  const success = (res: Response, data: unknown): void => { res.setHeader("Cache-Control", "no-store"); res.json(data); };
  const app = runningServer.app;

  app.post("/__auvrynt/dashboard/jobs/facebook/connect", async (req, res) => {
    if (!guard(req, res)) return;
    if (!isRecord(req.body) || Object.keys(req.body).length > 0) { res.status(422).json(apiError("VALIDATION_ERROR", "Connect requests do not accept fields.")); return; }
    if (!facebookOAuth) { res.status(409).json(apiError("NOT_CONFIGURED", "Facebook linking is not configured.")); return; }
    try {
      const authorizationUrl = facebookOAuth.begin(config.jobs.integrations.facebook, httpUrl("127.0.0.1", config.port, FACEBOOK_CALLBACK_PATH));
      success(res, { data: { authorizationUrl } });
    } catch (error) {
      const code = error instanceof FacebookOAuthError ? error.code : "NOT_CONFIGURED";
      if (code === "NOT_CONFIGURED") {
        res.status(409).json(apiError("NOT_CONFIGURED", "Set the Facebook app id and app secret before linking an account."));
        return;
      }
      res.status(500).json(apiError("FACEBOOK_LINK_FAILED", "Facebook linking could not be started."));
    }
  });

  app.post("/__auvrynt/dashboard/jobs/facebook/disconnect", (req, res) => {
    if (!guard(req, res)) return;
    if (!isRecord(req.body) || Object.keys(req.body).length > 0) { res.status(422).json(apiError("VALIDATION_ERROR", "Disconnect requests do not accept fields.")); return; }
    const integration = store.disconnectFacebook();
    if (!integration) { res.status(404).json(apiError("NOT_FOUND", "Facebook integration is unavailable.")); return; }
    logEvent(config.logging, "info", "jobs_facebook_disconnected", { provider: "facebook" });
    success(res, { data: integration });
  });

  app.post("/__auvrynt/dashboard/jobs/add", (req, res) => {
    if (!guard(req, res)) return;
    const parsed = parseJobInput(req.body);
    if (!parsed.ok) { res.status(422).json(apiError("VALIDATION_ERROR", parsed.message)); return; }
    try {
      const result = ingestManualJob(store, parsed.value);
      logEvent(config.logging, "info", result.duplicate ? "job_duplicate_merged" : "job_added", { jobId: result.job.id, provider: "manual" });
      success(res, { data: result.job, duplicate: result.duplicate });
    } catch (error) {
      res.status(500).json(apiError("JOBS_WRITE_FAILED", "The job could not be saved."));
      logEvent(config.logging, "error", "job_write_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/__auvrynt/dashboard/jobs/:id/update", (req, res) => {
    if (!guard(req, res)) return;
    const parsed = parseJobUpdate(req.body);
    if (!parsed.ok) { res.status(422).json(apiError("VALIDATION_ERROR", parsed.message)); return; }
    const job = updateManualJob(store, req.params.id, parsed.value);
    if (!job) { res.status(404).json(apiError("NOT_FOUND", "Job not found.")); return; }
    success(res, { data: job });
  });

  app.post("/__auvrynt/dashboard/jobs/:id/status", (req, res) => {
    if (!guard(req, res)) return;
    if (!isRecord(req.body) || !hasOnly(req.body, ["status"]) || !isStatus(req.body.status)) { res.status(422).json(apiError("VALIDATION_ERROR", "Invalid tracker status.")); return; }
    const job = store.setStatus(asJobId(req.params.id), req.body.status);
    if (!job) { res.status(404).json(apiError("NOT_FOUND", "Job not found.")); return; }
    logEvent(config.logging, "info", "job_status_changed", { jobId: job.id, status: job.status });
    success(res, { data: job });
  });

  app.post("/__auvrynt/dashboard/jobs/:id/archive", (req, res) => {
    if (!guard(req, res)) return;
    if (!isRecord(req.body) || Object.keys(req.body).length > 0) { res.status(422).json(apiError("VALIDATION_ERROR", "Archive requests do not accept fields.")); return; }
    const job = store.archiveJob(asJobId(req.params.id));
    if (!job) { res.status(404).json(apiError("NOT_FOUND", "Job not found.")); return; }
    logEvent(config.logging, "info", "job_archived", { jobId: job.id });
    success(res, { data: job });
  });

  app.post("/__auvrynt/dashboard/jobs/profile", (req, res) => {
    if (!guard(req, res)) return;
    const parsed = parseProfile(req.body);
    if (!parsed.ok) { res.status(422).json(apiError("VALIDATION_ERROR", parsed.message)); return; }
    const profile = store.saveProfile(parsed.value);
    refreshProfileMatches(store);
    store.addActivity({ type: "profile_updated", message: "Jobs profile updated.", createdAt: profile.updatedAt });
    success(res, { data: profile });
  });
}

function apiError(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function parseJobInput(body: unknown): { ok: true; value: JobInput } | { ok: false; message: string } {
  if (!isRecord(body) || !hasOnly(body, ["title", "company", "url", "description", "location", "remoteStatus", "employmentType", "salary", "deadline", "notes", "initialStatus"])) return { ok: false, message: "Unexpected job fields." };
  if (!requiredText(body.title, 200) || !requiredText(body.description, 20_000)) return { ok: false, message: "Title and description are required." };
  if (!optionalFieldsValid(body, [["company", 200], ["location", 200], ["employmentType", 100], ["salary", 200], ["deadline", 40], ["notes", 5_000]])) return { ok: false, message: "Invalid optional job field." };
  if (body.url !== undefined && !validUrl(body.url)) return { ok: false, message: "URL must be an http(s) URL." };
  if (body.remoteStatus !== undefined && !["remote", "hybrid", "onsite", "unknown"].includes(String(body.remoteStatus))) return { ok: false, message: "Invalid work arrangement." };
  if (body.initialStatus !== undefined && !isStatus(body.initialStatus)) return { ok: false, message: "Invalid initial status." };
  return { ok: true, value: { title: String(body.title), description: String(body.description), company: optionalText(body.company, 200), url: optionalText(body.url, 2048), location: optionalText(body.location, 200), remoteStatus: body.remoteStatus as JobInput["remoteStatus"], employmentType: optionalText(body.employmentType, 100), salary: optionalText(body.salary, 200), deadline: optionalText(body.deadline, 40), notes: optionalText(body.notes, 5_000), initialStatus: body.initialStatus as JobInput["initialStatus"] } };
}

function parseJobUpdate(body: unknown): { ok: true; value: JobUpdateInput } | { ok: false; message: string } {
  if (!isRecord(body) || !hasOnly(body, ["title", "company", "url", "description", "location", "remoteStatus", "employmentType", "salary", "deadline", "notes"])) return { ok: false, message: "Unexpected job fields." };
  if (body.title !== undefined && !requiredText(body.title, 200)) return { ok: false, message: "Invalid title." };
  if (body.description !== undefined && !requiredText(body.description, 20_000)) return { ok: false, message: "Invalid description." };
  if (!optionalFieldsValid(body, [["title", 200], ["company", 200], ["description", 20_000], ["location", 200], ["employmentType", 100], ["salary", 200], ["deadline", 40], ["notes", 5_000]])) return { ok: false, message: "Invalid optional job field." };
  if (body.url !== undefined && !validUrl(body.url)) return { ok: false, message: "URL must be an http(s) URL." };
  if (body.remoteStatus !== undefined && !["remote", "hybrid", "onsite", "unknown"].includes(String(body.remoteStatus))) return { ok: false, message: "Invalid work arrangement." };
  return { ok: true, value: { title: optionalText(body.title, 200), company: updateText(body.company, 200), url: updateText(body.url, 2048), description: optionalText(body.description, 20_000), location: updateText(body.location, 200), remoteStatus: body.remoteStatus as JobUpdateInput["remoteStatus"], employmentType: updateText(body.employmentType, 100), salary: updateText(body.salary, 200), deadline: updateText(body.deadline, 40), notes: updateText(body.notes, 5_000) } };
}

function parseProfile(body: unknown): { ok: true; value: Omit<JobProfile, "updatedAt"> } | { ok: false; message: string } {
  if (!isRecord(body) || !hasOnly(body, ["targetRoles", "primarySkills", "secondarySkills", "experienceLevels", "country", "remote", "hybridAcceptable", "onsiteOptional", "salaryPreference", "employmentPreference", "negativeKeywords", "minimumMatchScore"])) return { ok: false, message: "Unexpected profile fields." };
  const arrays = ["targetRoles", "primarySkills", "secondarySkills", "experienceLevels", "negativeKeywords"] as const;
  for (const key of arrays) if (!Array.isArray(body[key]) || body[key].length > 100 || body[key].some((item) => typeof item !== "string" || item.length > 200)) return { ok: false, message: `Invalid ${key}.` };
  if (!optionalFieldsValid(body, [["country", 200], ["salaryPreference", 200], ["employmentPreference", 200]])) return { ok: false, message: "Invalid profile field." };
  for (const key of ["remote", "hybridAcceptable", "onsiteOptional"] as const) if (body[key] !== undefined && typeof body[key] !== "boolean") return { ok: false, message: `Invalid ${key}.` };
  const score = Number(body.minimumMatchScore);
  if (!Number.isInteger(score) || score < 0 || score > 100) return { ok: false, message: "Minimum match score must be between 0 and 100." };
  return { ok: true, value: { id: asProfileId("default"), targetRoles: body.targetRoles as string[], primarySkills: body.primarySkills as string[], secondarySkills: body.secondarySkills as string[], experienceLevels: body.experienceLevels as string[], country: optionalText(body.country, 200), remote: body.remote !== false, hybridAcceptable: body.hybridAcceptable !== false, onsiteOptional: body.onsiteOptional === true, salaryPreference: optionalText(body.salaryPreference, 200), employmentPreference: optionalText(body.employmentPreference, 200), negativeKeywords: body.negativeKeywords as string[], minimumMatchScore: score } };
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function hasOnly(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function requiredText(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function optionalText(value: unknown, max: number): string | undefined { return value === undefined || value === null || value === "" ? undefined : typeof value === "string" && value.length <= max ? value.trim() : undefined; }
function updateText(value: unknown, max: number): string | undefined { return value === undefined ? undefined : value === null || value === "" ? "" : typeof value === "string" && value.length <= max ? value.trim() : undefined; }
function optionalFieldsValid(value: Record<string, unknown>, fields: Array<[string, number]>): boolean { return fields.every(([key, max]) => value[key] === undefined || value[key] === null || value[key] === "" || (typeof value[key] === "string" && value[key].length <= max)); }
function validUrl(value: unknown): boolean { if (typeof value !== "string" || value.length > 2048) return false; try { const parsed = new URL(value); return parsed.protocol === "http:" || parsed.protocol === "https:"; } catch { return false; } }
function isStatus(value: unknown): value is typeof TRACKER_STATUSES[number] { return typeof value === "string" && TRACKER_STATUSES.includes(value as typeof TRACKER_STATUSES[number]); }
