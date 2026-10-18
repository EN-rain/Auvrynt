import type { ServerConfig } from "../infrastructure/config.js";
import { JobsStore } from "../jobs/store.js";
import { TRACKER_STATUSES, type JobListQuery, type JobsDashboardView, type JobRecord, type TrackerStatus } from "../jobs/types.js";

export type { JobsDashboardView } from "../jobs/types.js";

export function createJobsDashboardView(store: JobsStore, config: ServerConfig, query: JobListQuery = {}): JobsDashboardView {
  const opportunities = store.listJobs(query);
  const trackerJobs = store.listAllJobs().slice(0, 500);
  const tracker = Object.fromEntries(TRACKER_STATUSES.map((status) => [status, trackerJobs.filter((job) => job.status === status).slice(0, 100)])) as JobsDashboardView["tracker"];
  const integrations = store.listIntegrations().map((integration) => {
    if (integration.provider !== "facebook") return integration;
    const facebookConfig = config.jobs.integrations.facebook;
    const enabled = facebookConfig.enabled;
    const configured = Boolean(facebookConfig.appId && facebookConfig.appSecret);
    const connected = integration.status === "connected";
    const status = !enabled
      ? "disabled" as const
      : !configured
        ? "needs_login" as const
        : connected
          ? "connected" as const
          : "available" as const;
    return {
      ...integration,
      enabled,
      status,
      configuration: configured ? "ready" as const : "missing" as const,
      connectUrl: enabled && configured && !connected ? "/__auvrynt/dashboard/jobs/facebook/connect" : undefined,
      disconnectUrl: enabled && connected ? "/__auvrynt/dashboard/jobs/facebook/disconnect" : undefined,
    };
  });
  return { summary: store.summary(), opportunities, tracker, integrations, recentActivity: store.listActivity(20), profile: store.getProfile() };
}

export function trackerStatuses(): readonly TrackerStatus[] {
  return TRACKER_STATUSES;
}

export function boundedJobPageQuery(query: Record<string, unknown>): JobListQuery {
  const allowed = new Set(["page", "pageSize", "query", "status", "source", "minimumMatchScore", "risk", "sortBy", "sortOrder"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) throw new Error("Unknown opportunity query field.");
  const page = parseStrictNumber(query.page, 1, 1, 10_000, "page");
  const pageSize = parseStrictNumber(query.pageSize, 50, 1, 50, "pageSize");
  const value = (key: string): string | undefined => {
    const raw = query[key];
    if (raw === undefined || raw === "") return undefined;
    if (typeof raw !== "string") throw new Error(`Invalid ${key}.`);
    return raw;
  };
  const status = value("status");
  const risk = value("risk");
  if (status && !TRACKER_STATUSES.includes(status as TrackerStatus)) throw new Error("Invalid status filter.");
  if (risk && !["NORMAL", "REVIEW", "HIGH_RISK", "AUTO_SKIP"].includes(risk)) throw new Error("Invalid risk filter.");
  const minimumMatchScore = query.minimumMatchScore === undefined || query.minimumMatchScore === "" ? undefined : parseStrictNumber(query.minimumMatchScore, 0, 0, 100, "minimumMatchScore");
  const sortByValue = value("sortBy");
  if (sortByValue && !["newest", "match", "deadline", "company", "status"].includes(sortByValue)) throw new Error("Invalid sort field.");
  const sortOrderValue = value("sortOrder");
  if (sortOrderValue && sortOrderValue !== "asc" && sortOrderValue !== "desc") throw new Error("Invalid sort order.");
  return {
    page, pageSize, query: value("query"), source: value("source"),
    status: status as TrackerStatus | undefined,
    risk: risk as JobListQuery["risk"],
    minimumMatchScore,
    sortBy: sortByValue as JobListQuery["sortBy"],
    sortOrder: sortOrderValue as JobListQuery["sortOrder"] ?? "desc",
  };
}

function parseStrictNumber(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`Invalid ${label}.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Invalid ${label}.`);
  return parsed;
}

export function serializeJobForDetail(job: JobRecord): JobRecord {
  return job;
}
