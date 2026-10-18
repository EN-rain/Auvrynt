import type { Request, Response } from "express";
import type { ServerConfig } from "../infrastructure/config.js";
import { isLoopbackRequest } from "../logger.js";
import { JobsStore } from "../jobs/store.js";
import { TRACKER_STATUSES } from "../jobs/types.js";
import { dashboardCsp } from "./dashboard.js";
import { createJobsDashboardView, boundedJobPageQuery, serializeJobForDetail } from "./jobs-dashboard.js";
import { jobsDashboardHtml } from "./jobs-dashboard-page.js";
import { FACEBOOK_CALLBACK_PATH, FacebookOAuthError, FacebookOAuthManager } from "../jobs/integrations/facebook/facebook-oauth.js";
import { httpUrl } from "../cli/runtime-support.js";

export interface JobsDashboardRouteApp {
  get(path: string, handler: (req: Request, res: Response) => void | Promise<void>): void;
}

export function registerJobsDashboardRoutes(options: {
  app: JobsDashboardRouteApp;
  config: ServerConfig;
  jobsStore?: JobsStore;
  nonce: () => string;
  dashboardControlToken: string;
  pid: number;
  facebookOAuth?: FacebookOAuthManager;
}): void {
  const { app, config, jobsStore, nonce, dashboardControlToken, pid, facebookOAuth } = options;
  if (!config.jobs.enabled || !jobsStore) return;
  const store = jobsStore;
  const json = (res: Response, value: unknown): void => { res.setHeader("Cache-Control", "no-store"); res.json(value); };

  app.get("/dashboard/jobs", (req, res) => {
    if (!isLoopbackRequest(req)) { res.status(404).end(); return; }
    const pageNonce = nonce();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", dashboardCsp(pageNonce));
    const view = createJobsDashboardView(store, config);
    res.type("html").send(jobsDashboardHtml(view, pageNonce, dashboardControlToken, pid));
  });

  app.get(FACEBOOK_CALLBACK_PATH, async (req, res) => {
    if (!isLoopbackRequest(req)) { res.status(404).end(); return; }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const redirectUri = facebookRedirectUri(config);
    const state = queryText(req.query.state);
    const providerError = queryText(req.query.error);
    if (providerError) facebookOAuth?.cancel(state);
    if (!facebookOAuth || providerError) {
      res.redirect(303, dashboardFacebookRedirect(providerError ? "denied" : "unavailable"));
      return;
    }
    try {
      await facebookOAuth.complete(config.jobs.integrations.facebook, store, {
        state,
        code: queryText(req.query.code),
        redirectUri,
      });
      res.redirect(303, dashboardFacebookRedirect("connected"));
    } catch (error) {
      const reason = error instanceof FacebookOAuthError ? callbackReason(error.code) : "failed";
      res.redirect(303, dashboardFacebookRedirect(reason));
    }
  });

  app.get("/dashboard/jobs/data", (req, res) => {
    if (!isLoopbackRequest(req)) { res.status(404).end(); return; }
    json(res, createJobsDashboardView(store, config));
  });

  app.get("/dashboard/jobs/opportunities", (req, res) => {
    if (!isLoopbackRequest(req)) { res.status(404).end(); return; }
    try {
      json(res, createJobsDashboardView(store, config, boundedJobPageQuery(req.query as Record<string, unknown>)).opportunities);
    } catch (error) {
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: error instanceof Error ? error.message : "Invalid opportunity query." } });
    }
  });

  app.get("/dashboard/jobs/opportunities/:id", (req, res) => {
    if (!isLoopbackRequest(req)) { res.status(404).end(); return; }
    const job = store.getJob(req.params.id as never);
    if (!job) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found." } }); return; }
    json(res, serializeJobForDetail(job));
  });

  app.get("/dashboard/jobs/integrations", (req, res) => {
    if (!isLoopbackRequest(req)) { res.status(404).end(); return; }
    json(res, createJobsDashboardView(store, config).integrations);
  });

  app.get("/dashboard/jobs/profile", (req, res) => {
    if (!isLoopbackRequest(req)) { res.status(404).end(); return; }
    json(res, createJobsDashboardView(store, config).profile);
  });
}

export function invalidJobStatus(value: unknown): boolean {
  return typeof value !== "string" || !TRACKER_STATUSES.includes(value as typeof TRACKER_STATUSES[number]);
}

export function facebookRedirectUri(config: ServerConfig): string {
  return httpUrl("127.0.0.1", config.port, FACEBOOK_CALLBACK_PATH);
}

function dashboardFacebookRedirect(status: string): string {
  return `/dashboard/jobs?facebook=${encodeURIComponent(status)}#integrations`;
}

function callbackReason(code: FacebookOAuthError["code"]): string {
  switch (code) {
    case "INVALID_CALLBACK": return "invalid";
    case "NOT_CONFIGURED": return "unavailable";
    case "PROFILE_FAILED": return "profile";
    case "STORE_FAILED": return "storage";
    default: return "failed";
  }
}

function queryText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
