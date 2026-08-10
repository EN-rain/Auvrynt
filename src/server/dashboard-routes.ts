import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { ServerConfig } from "../infrastructure/config.js";
import { isLoopbackRequest } from "../logger.js";
import {
  createDashboardToolsView,
  createDashboardView,
  dashboardCsp,
  dashboardHtml,
  type DashboardIntegrationKey,
  type DashboardRuntimeSnapshot,
} from "./dashboard.js";
import { integrationToolCounts } from "./mcp-tool-registrar.js";

export interface DashboardRouteApp {
  get(path: string, handler: (req: Request, res: Response) => void | Promise<void>): void;
}

export function registerDashboardRoutes(options: {
  app: DashboardRouteApp;
  config: ServerConfig;
  snapshot: () => DashboardRuntimeSnapshot;
  nonce: () => string;
}): void {
  const { app, config, snapshot, nonce } = options;

  app.get("/dashboard", async (req, res) => {
    if (!isLoopbackRequest(req)) {
      res.status(404).end();
      return;
    }
    const pageNonce = nonce();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", dashboardCsp(pageNonce));
    const view = await createDashboardView(config, snapshot());
    res.type("html").send(dashboardHtml(view, pageNonce));
  });

  app.get("/dashboard/data", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRequest(req)) {
      res.status(404).end();
      return;
    }
    res.json(await createDashboardView(config, snapshot()));
  });

  app.get("/dashboard/tools", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRequest(req)) {
      res.status(404).end();
      return;
    }
    const integration = typeof req.query.integration === "string" ? req.query.integration : "";
    const tools = createDashboardToolsView(config, integration as DashboardIntegrationKey);
    if (tools === undefined) {
      res.status(404).json({ error: "Unknown integration." });
      return;
    }
    res.json({ integration, tools, counts: integrationToolCounts(config) });
  });
}

export function randomNonce(): string {
  return randomBytes(18).toString("base64url");
}