import type { Request } from "express";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
export type LogFormat = "json" | "pretty";

export interface LoggingConfig {
  level: LogLevel;
  format: LogFormat;
  requests: boolean;
  assets: boolean;
  toolCalls: boolean;
  shellCommands: boolean;
}

type LogFields = Record<string, unknown>;

export interface RecentLogEntry {
  id: number;
  ts: string;
  level: Exclude<LogLevel, "silent">;
  event: string;
  fields: LogFields;
}

const MAX_RECENT_LOG_ENTRIES = 500;
const recentEntries: RecentLogEntry[] = [];
let nextRecentLogId = 1;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export function shouldLog(config: LoggingConfig, level: Exclude<LogLevel, "silent">): boolean {
  return LEVEL_WEIGHT[config.level] >= LEVEL_WEIGHT[level];
}

export function logEvent(
  config: LoggingConfig,
  level: Exclude<LogLevel, "silent">,
  event: string,
  fields: LogFields = {},
): void {
  if (!shouldLog(config, level)) return;

  const ts = new Date().toISOString();
  const safeFields = sanitizeLogFields(fields);
  recentEntries.push({ id: nextRecentLogId++, ts, level, event, fields: safeFields });
  if (recentEntries.length > MAX_RECENT_LOG_ENTRIES) {
    recentEntries.splice(0, recentEntries.length - MAX_RECENT_LOG_ENTRIES);
  }

  if (process.env.AUVRYNT_START_MODE === "true") {
    const emitter = (global as any).auvryntLogEmitter;
    if (typeof emitter === "function") {
      emitter(level, event, safeFields);
    }
    return;
  }

  const entry = {
    ts,
    level,
    event,
    ...safeFields,
  };

  const line = config.format === "pretty" ? formatPretty(entry) : JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function recentLogEntries(limit = 200): RecentLogEntry[] {
  const boundedLimit = Number.isInteger(limit)
    ? Math.max(1, Math.min(limit, MAX_RECENT_LOG_ENTRIES))
    : 200;
  return recentEntries.slice(-boundedLimit).map((entry) => ({
    ...entry,
    fields: { ...entry.fields },
  }));
}

export function requestIp(req: Request): string | undefined {
  // Security-sensitive locality checks must use the actual transport peer.
  // `req.ip` can be influenced by Express proxy-trust configuration and
  // caller-controlled forwarding headers, so it is intentionally ignored here.
  return req.socket.remoteAddress;
}

export function isLoopbackIp(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "localhost"
    || normalized.startsWith("127.")
    || normalized.startsWith("::ffff:127.");
}

export function isLoopbackRequest(req: Request): boolean {
  return isLoopbackIp(requestIp(req));
}

export function requestPath(req: Request): string {
  return req.path || req.url.split("?")[0] || req.url;
}

export function sessionIdPrefix(sessionId: string | undefined): string | undefined {
  return sessionId ? sessionId.slice(0, 8) : undefined;
}

export function commandPreview(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function sanitizeLogFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, sanitizeLogValue(key, value)]),
  );
}

function sanitizeLogValue(key: string, value: unknown): unknown {
  if (/authorization|token|secret|password|cookie/i.test(key)) return "[redacted]";
  if (/(^|_)(ip|address)$/i.test(key) || /remote(address)?/i.test(key)) return "[network-address]";
  if (typeof value === "string") {
    const redacted = redactNetworkAddresses(value);
    return redacted.length > 2_000 ? `${redacted.slice(0, 1_997)}...` : redacted;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeLogValue("item", item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([childKey, childValue]) => [
          childKey,
          sanitizeLogValue(childKey, childValue),
        ]),
    );
  }
  return value;
}

function redactNetworkAddresses(value: string): string {
  return value
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[network-address]")
    .replace(/\[(?:[0-9a-f]*:){2,}[0-9a-f:]*\](?::\d+)?/gi, "[network-address]")
    .replace(/\b::1\b/gi, "[network-address]");
}

function formatPretty(entry: LogFields): string {
  const ts = String(entry.ts);
  const level = String(entry.level).toUpperCase();
  const event = String(entry.event);
  const rest = Object.entries(entry)
    .filter(([key, value]) => !["ts", "level", "event"].includes(key) && value !== undefined)
    .map(([key, value]) => `${key}=${formatPrettyValue(value)}`)
    .join(" ");

  return rest ? `${ts} ${level} ${event} ${rest}` : `${ts} ${level} ${event}`;
}

function formatPrettyValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}
