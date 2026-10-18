import { isIP } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHomePath } from "../roots.js";
import type { LoggingConfig, LogFormat, LogLevel } from "../logger.js";
import type { OAuthConfig, OAuthStaticClientConfig } from "../oauth-provider.js";
import { loadAuvryntFiles, type AuvryntUserConfig, type AuvryntExecutablesConfig, type AuvryntIntegrationsConfig } from "../user-config.js";
import { resolveNgrokAuthtoken } from "./ngrok-auth-pool.js";
import { normalizeNgrokUrl } from "../tunnels/tunnel-utils.js";
import {
  DEFAULT_MCP_SESSIONS,
  DEFAULT_MCP_SESSIONS_PER_CLIENT,
  MAX_MCP_SESSIONS,
} from "./session-limits.js";

export {
  DEFAULT_MCP_SESSIONS,
  DEFAULT_MCP_SESSIONS_PER_CLIENT,
  MAX_MCP_SESSIONS,
} from "./session-limits.js";

export type ToolNamingMode = "legacy" | "short";
export type WidgetMode = "off" | "compact" | "changes" | "full";
export type TunnelProviderSetting = "cloudflare" | "ngrok" | "custom";
const DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const SUPPORTED_SCOPES = [
  "auvrynt:read",
  "auvrynt:write",
  "auvrynt:process",
  "auvrynt:web",
  "auvrynt:software",
  "auvrynt:godot",
  "auvrynt:blender",
  "auvrynt:blender-python",
  "auvrynt:aseprite",
  "auvrynt:serena",
  "auvrynt:roblox",
  "auvrynt:desktop",
  "auvrynt:krita",
  "auvrynt:open-pencil",
] as const;

export type AuvryntScope = (typeof SUPPORTED_SCOPES)[number];

const DEFAULT_OAUTH_SCOPES: AuvryntScope[] = SUPPORTED_SCOPES.filter(
  (scope): scope is AuvryntScope => scope !== "auvrynt:blender-python" && scope !== "auvrynt:desktop",
);

export const SCOPE_DESCRIPTIONS: Record<AuvryntScope, string> = {
  "auvrynt:read": "Inspect files, search, and perform read-only project analysis",
  "auvrynt:write": "Edit and create files",
  "auvrynt:process": "Run local commands and processes with the current OS user's privileges",
  "auvrynt:web": "Use browser and web-development tools",
  "auvrynt:software": "Use software and .NET tools",
  "auvrynt:godot": "Use Godot project and editor tools",
  "auvrynt:blender": "Use workspace-bound Blender 3D tools",
  "auvrynt:blender-python": "Execute arbitrary Python inside Blender (host-level capability)",
  "auvrynt:aseprite": "Use workspace-bound Aseprite pixel-art and animation tools",
  "auvrynt:serena": "Use local Serena semantic code tools",
  "auvrynt:roblox": "Use official Roblox Studio MCP tools",
  "auvrynt:desktop": "Capture and control explicitly targeted Windows displays or application windows",
  "auvrynt:krita": "Use the no-plugin Krita drawing tools and calibrated Krita window",
  "auvrynt:open-pencil": "Use the local OpenPencil design editor through its official MCP server",
};

export interface JobsServerConfig {
  enabled: boolean;
  minimumMatchScore: number;
  riskAutoSkipScore: number;
  integrations: {
    facebook: {
      enabled: boolean;
      /** Public Facebook app id; credentials are read from the process environment only. */
      appId?: string;
      /** Facebook app secret; never serialized into a dashboard response. */
      appSecret?: string;
      graphVersion: string;
    };
  };
}

export interface SerenaServerConfig {
  enabled: boolean;
  executable: string;
  backend: "LSP" | "JetBrains";
  context: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  idleTimeoutMinutes: number;
  maxInstances: number;
}

export interface ArbiterServerConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeoutMs: number;
  apiKey?: string;
}

export const MIN_SESSION_IDLE_TIMEOUT_MS = 60 * 1000;
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const MAX_SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export interface ServerConfig {
  host: string;
  port: number;
  oauth: OAuthConfig;
  allowedRoots: string[];
  allowedHosts: string[];
  maxSessions: number;
  maxSessionsPerClient: number;
  sessionIdleTimeoutMs: number;
  publicBaseUrl: string;
  minimalTools: boolean;
  toolNaming: ToolNamingMode;
  widgets: WidgetMode;
  stateDir: string;
  worktreeRoot: string;
  skillsEnabled: boolean;
  skillPaths: string[];
  agentDir: string;
  logging: LoggingConfig;
  serena: SerenaServerConfig;
  arbiter: ArbiterServerConfig;
  jobs: JobsServerConfig;
  executables: AuvryntExecutablesConfig;
  integrations: Required<AuvryntIntegrationsConfig>;
  tunnelProvider: TunnelProviderSetting;
  cloudflareTokenManaged: boolean;
  cloudflareTunnelToken?: string;
  ngrokAuthtoken?: string;
  ngrokUrl?: string;
  toolToggles: Record<string, boolean>;
}

function parsePort(value: string | number | undefined): number {
  if (value === undefined || value === "") return 49321;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return port;
}

function parseAllowedRoots(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    const roots = value.map((entry) => entry.trim()).filter(Boolean);
    return (roots.length > 0 ? roots : [process.cwd()]).map((root) => resolve(expandHomePath(root)));
  }

  const rawRoots =
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  const roots = rawRoots.length > 0 ? rawRoots : [process.cwd()];
  return roots.map((root) => resolve(expandHomePath(root)));
}

function parseAllowedHosts(value: string | string[] | undefined, derivedHosts: string[]): string[] {
  if (Array.isArray(value)) {
    return normalizeAllowedHosts(value, derivedHosts);
  }

  const rawHosts =
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  return normalizeAllowedHosts(rawHosts, derivedHosts);
}

function normalizeAllowedHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) throw new Error("Allowed Host entries must not be empty.");
  if (trimmed === "*") return trimmed;
  if (/[\/@?#]/.test(trimmed)) {
    throw new Error(`Invalid allowed Host entry: ${host}. Use a hostname or IP address without scheme, path, query, or fragment.`);
  }

  const unbracketed = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const ipVersion = isIP(unbracketed);
  if (ipVersion === 6) return `[${unbracketed}]`;
  if (ipVersion === 4) return unbracketed;
  if (trimmed.includes(":")) {
    throw new Error(`Invalid allowed Host entry: ${host}. Ports are not part of the Host allowlist.`);
  }
  if (!/^[a-z0-9.-]+$/.test(trimmed) || trimmed.startsWith(".") || trimmed.endsWith(".")) {
    throw new Error(`Invalid allowed Host entry: ${host}`);
  }
  return trimmed;
}

function normalizeAllowedHosts(rawHosts: string[], derivedHosts: string[]): string[] {
  const hosts = rawHosts.length > 0 ? rawHosts : derivedHosts;
  if (hosts.some((host) => host.trim() === "*")) return ["*"];
  return Array.from(new Set(hosts.map(normalizeAllowedHost)));
}

function parseBoolean(value: string | boolean | undefined, name = "boolean value"): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid ${name}: ${value}`);
}

function parseMinimalTools(env: NodeJS.ProcessEnv): boolean {
  if (env.AUVRYNT_TOOL_MODE === "minimal") return true;
  if (env.AUVRYNT_TOOL_MODE === "full") return false;
  if (env.AUVRYNT_TOOL_MODE) {
    throw new Error(`Invalid AUVRYNT_TOOL_MODE: ${env.AUVRYNT_TOOL_MODE}`);
  }
  if (env.AUVRYNT_MINIMAL_TOOLS !== undefined) return parseBoolean(env.AUVRYNT_MINIMAL_TOOLS);
  return true;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (!value || value === "info") return "info";
  if (["silent", "error", "warn", "debug"].includes(value)) return value as LogLevel;

  throw new Error(`Invalid AUVRYNT_LOG_LEVEL: ${value}`);
}

function parseLogFormat(value: string | undefined): LogFormat {
  if (!value || value === "json") return "json";
  if (value === "pretty") return "pretty";

  throw new Error(`Invalid AUVRYNT_LOG_FORMAT: ${value}`);
}

function parsePathList(value: string | string[] | undefined): string[] {
  const entries = Array.isArray(value)
    ? value
    : value?.split(",") ?? [];
  return entries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(expandHomePath(entry)));
}

function parseStringList(value: string | undefined, fallback: string[]): string[] {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries && entries.length > 0 ? entries : fallback;
}

function parsePositiveInteger(value: string | number | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return parsed;
}

function parseMcpSessionLimit(
  value: string | number | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = parsePositiveInteger(value, fallback, name);
  if (parsed > MAX_MCP_SESSIONS) {
    throw new Error(`Invalid ${name}: ${value}. Maximum is ${MAX_MCP_SESSIONS}.`);
  }
  return parsed;
}

function parseBoundedInteger(value: string | number | undefined, fallback: number, name: string): number {
  const parsed = parsePositiveInteger(value, fallback, name);
  if (parsed > 100) throw new Error(`Invalid ${name}: ${value}. Must be between 0 and 100.`);
  return parsed;
}

function parseSessionIdleTimeout(value: string | number | undefined, fallback: number, name: string): number {
  const parsed = parsePositiveInteger(value, fallback, name);
  if (parsed < MIN_SESSION_IDLE_TIMEOUT_MS || parsed > MAX_SESSION_IDLE_TIMEOUT_MS) {
    throw new Error(`Invalid ${name}: ${value}. Must be between ${MIN_SESSION_IDLE_TIMEOUT_MS} and ${MAX_SESSION_IDLE_TIMEOUT_MS} milliseconds.`);
  }
  return parsed;
}

function parseToolNaming(value: string | undefined): ToolNamingMode {
  if (!value || value === "short") return "short";
  if (value === "legacy") return "legacy";

  throw new Error(`Invalid AUVRYNT_TOOL_NAMING: ${value}`);
}

function parseLoggingConfig(env: NodeJS.ProcessEnv): LoggingConfig {
  return {
    level: parseLogLevel(env.AUVRYNT_LOG_LEVEL),
    format: parseLogFormat(env.AUVRYNT_LOG_FORMAT),
    requests: env.AUVRYNT_LOG_REQUESTS === undefined ? true : parseBoolean(env.AUVRYNT_LOG_REQUESTS),
    assets: parseBoolean(env.AUVRYNT_LOG_ASSETS),
    toolCalls: env.AUVRYNT_LOG_TOOL_CALLS === undefined ? true : parseBoolean(env.AUVRYNT_LOG_TOOL_CALLS),
    shellCommands: parseBoolean(env.AUVRYNT_LOG_SHELL_COMMANDS),
  };
}

function parseWidgetMode(value: string | undefined, fileValue: WidgetMode | undefined): WidgetMode {
  const effective = value ?? fileValue;
  if (!effective || effective === "compact") return "compact";
  if (effective === "off" || effective === "changes" || effective === "full") return effective;

  throw new Error(`Invalid AUVRYNT_WIDGETS: ${effective}`);
}

function parseTunnelProvider(value: string | undefined, fileValue: TunnelProviderSetting | undefined): TunnelProviderSetting {
  const effective = value ?? fileValue;
  if (!effective || effective === "cloudflare") return "cloudflare";
  if (effective === "ngrok" || effective === "custom") return effective;

  throw new Error(`Invalid AUVRYNT_TUNNEL_PROVIDER: ${effective}. Use "cloudflare", "ngrok", or "custom".`);
}

function parseRequiredSecret(value: string | undefined, name: string): string {
  const secret = value?.trim();
  if (!secret) {
    throw new Error(`${name} is required for Auvrynt OAuth. Run: auvrynt init`);
  }
  if (secret.length < 16) {
    throw new Error(`${name} must be at least 16 characters long.`);
  }
  return secret;
}

function parseOAuthScopes(value: string | undefined): AuvryntScope[] {
  const requested = parseStringList(value, DEFAULT_OAUTH_SCOPES);
  const supported = new Set<string>(SUPPORTED_SCOPES);
  const invalid = requested.filter((scope) => !supported.has(scope));
  if (invalid.length > 0) {
    throw new Error(`Invalid AUVRYNT_OAUTH_SCOPES: unsupported scope(s): ${invalid.join(", ")}`);
  }
  return Array.from(new Set(requested)) as AuvryntScope[];
}

export function oauthScopesForIntegrations(integrations: AuvryntIntegrationsConfig): AuvryntScope[] {
  const scopes: AuvryntScope[] = ["auvrynt:read", "auvrynt:write"];
  if (integrations.playwright) scopes.push("auvrynt:web", "auvrynt:process");
  if (integrations.godotGdscript || integrations.godotCsharp) scopes.push("auvrynt:godot");
  if (integrations.godotCsharp) scopes.push("auvrynt:software", "auvrynt:process");
  if (integrations.blender) scopes.push("auvrynt:blender");
  if (integrations.aseprite) scopes.push("auvrynt:aseprite");
  if (integrations.serena) scopes.push("auvrynt:serena");
  if (integrations.solOrchestrator) scopes.push("auvrynt:process");
  if (integrations.roblox) scopes.push("auvrynt:roblox");
  if (integrations.desktop) scopes.push("auvrynt:desktop");
  if (integrations.krita) scopes.push("auvrynt:krita");
  if (integrations.openPencil) scopes.push("auvrynt:open-pencil");
  return Array.from(new Set(scopes));
}

function parseOAuthConfig(
  env: NodeJS.ProcessEnv,
  ownerToken: string | undefined,
  blenderPythonEnabled = false,
): OAuthConfig {
  const scopes = parseOAuthScopes(env.AUVRYNT_OAUTH_SCOPES);
  if (
    env.AUVRYNT_OAUTH_SCOPES === undefined
    && blenderPythonEnabled
    && !scopes.includes("auvrynt:blender-python")
  ) {
    scopes.push("auvrynt:blender-python");
  }
  return {
    ownerToken: parseRequiredSecret(env.AUVRYNT_OAUTH_OWNER_TOKEN ?? ownerToken, "AUVRYNT_OAUTH_OWNER_TOKEN"),
    accessTokenTtlSeconds: parsePositiveInteger(
      env.AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      "AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS",
    ),
    refreshTokenTtlSeconds: parsePositiveInteger(
      env.AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      "AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS",
    ),
    // OAuth is the durable capability envelope. Local integration profiles are
    // a second, runtime gate and may change without reconnecting the web agent.
    // Blender Python is an explicit trusted-owner opt-in stored in the private
    // local config unless AUVRYNT_OAUTH_SCOPES was supplied explicitly.
    scopes,
    allowedRedirectHosts: parseStringList(env.AUVRYNT_OAUTH_ALLOWED_REDIRECT_HOSTS, [
      "grok.com",
      "console.x.ai",
      "x.ai",
      "chatgpt.com",
      "openai.com",
      "claude.ai",
      "claude.com",
      "claude.site",
      "useclaude.ai",
      "anthropic.com",
      "oauth-redirect.googleusercontent.com",
      "googleusercontent.com",
      "gemini.google.com",
      "google.com",
      "developers.google.com",
      "aistudio.google.com",
      "oauth.lovable.app",
      "lovable.app",
      "lovable.dev",
      "api.lovable.dev",
      "bolt.new",
      "clusy.io",
      "app.clusy.io",
      "docs.clusy.io",
      "localhost",
      "127.0.0.1",
    ]),
    staticClients: parseStaticClients(env),
  };
}

function parseStaticClients(env: Record<string, string | undefined>): OAuthStaticClientConfig[] {
  const staticClients: OAuthStaticClientConfig[] = [];
  const clientId = env.AUVRYNT_OAUTH_CLIENT_ID || env.AUVRYNT_OAUTH_STATIC_CLIENT_ID;
  if (clientId?.trim()) {
    const clientSecret = env.AUVRYNT_OAUTH_CLIENT_SECRET || env.AUVRYNT_OAUTH_STATIC_CLIENT_SECRET;
    const redirectUrisRaw = env.AUVRYNT_OAUTH_REDIRECT_URIS || env.AUVRYNT_OAUTH_STATIC_REDIRECT_URIS;
    const redirectUris = redirectUrisRaw
      ? redirectUrisRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [
          "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-109752885578851795204-mcp_auvrynt_dpdns_org",
          "https://oauth-redirect.googleusercontent.com",
          "https://gemini.google.com",
          "http://localhost",
          "http://127.0.0.1",
        ];
    staticClients.push({
      clientId: clientId.trim(),
      clientSecret: clientSecret?.trim() || undefined,
      redirectUris,
      clientName: "Configured Static Client",
    });
  }
  return staticClients;
}

function defaultStateDir(): string {
  return join(homedir(), ".local", "share", "auvrynt");
}

function defaultWorktreeRoot(): string {
  return join(homedir(), ".auvrynt", "worktrees");
}

function defaultAgentDir(): string {
  return join(homedir(), ".codex");
}

function parseJobsConfig(env: NodeJS.ProcessEnv, filesConfig: AuvryntUserConfig): JobsServerConfig {
  const file = filesConfig.jobs ?? {};
  const facebook = file.integrations?.facebook ?? {};
  const facebookAppId = parseOptionalSecret(env.AUVRYNT_JOBS_FACEBOOK_APP_ID, "AUVRYNT_JOBS_FACEBOOK_APP_ID", 256);
  const facebookAppSecret = parseOptionalSecret(env.AUVRYNT_JOBS_FACEBOOK_APP_SECRET, "AUVRYNT_JOBS_FACEBOOK_APP_SECRET", 4096);
  const graphVersion = parseFacebookGraphVersion(env.AUVRYNT_JOBS_FACEBOOK_GRAPH_VERSION ?? "v22.0");
  return {
    enabled: env.AUVRYNT_JOBS_ENABLED === undefined ? file.enabled ?? true : parseBoolean(env.AUVRYNT_JOBS_ENABLED, "AUVRYNT_JOBS_ENABLED"),
    minimumMatchScore: parseBoundedInteger(env.AUVRYNT_JOBS_MINIMUM_MATCH_SCORE ?? file.minimumMatchScore, 60, "AUVRYNT_JOBS_MINIMUM_MATCH_SCORE"),
    riskAutoSkipScore: parseBoundedInteger(env.AUVRYNT_JOBS_RISK_AUTO_SKIP_SCORE ?? file.riskAutoSkipScore, 80, "AUVRYNT_JOBS_RISK_AUTO_SKIP_SCORE"),
    integrations: {
      facebook: {
        enabled: env.AUVRYNT_JOBS_FACEBOOK_ENABLED === undefined
          ? facebook.enabled ?? Boolean(facebookAppId && facebookAppSecret)
          : parseBoolean(env.AUVRYNT_JOBS_FACEBOOK_ENABLED, "AUVRYNT_JOBS_FACEBOOK_ENABLED"),
        appId: facebookAppId,
        appSecret: facebookAppSecret,
        graphVersion,
      },
    },
  };
}

function parseOptionalSecret(value: string | undefined, name: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maximum) throw new Error(`${name} must be at most ${maximum} characters.`);
  return trimmed;
}

function parseFacebookGraphVersion(value: string): string {
  const trimmed = value.trim();
  if (!/^v\d+\.\d+$/.test(trimmed)) throw new Error(`Invalid AUVRYNT_JOBS_FACEBOOK_GRAPH_VERSION: ${value}`);
  return trimmed;
}

function parseSerenaConfig(env: NodeJS.ProcessEnv, filesConfig: AuvryntUserConfig): SerenaServerConfig {
  const filesSerena = filesConfig.serena ?? {};
  const backend = env.AUVRYNT_SERENA_BACKEND ?? filesSerena.backend ?? "LSP";
  if (backend !== "LSP" && backend !== "JetBrains") {
    throw new Error(`Invalid AUVRYNT_SERENA_BACKEND: ${backend}`);
  }
  return {
    enabled: parseBoolean(env.AUVRYNT_SERENA_ENABLED ?? filesSerena.enabled ?? true, "AUVRYNT_SERENA_ENABLED"),
    executable: env.AUVRYNT_SERENA_EXECUTABLE ?? env.AUVRYNT_SERENA_PATH ?? filesConfig.executables?.serena ?? filesSerena.executable ?? "serena",
    backend,
    context: env.AUVRYNT_SERENA_CONTEXT ?? filesSerena.context ?? "desktop-app",
    startupTimeoutMs: parsePositiveInteger(
      env.AUVRYNT_SERENA_STARTUP_TIMEOUT ?? filesSerena.startupTimeoutMs, 30_000, "AUVRYNT_SERENA_STARTUP_TIMEOUT",
    ),
    requestTimeoutMs: parsePositiveInteger(
      env.AUVRYNT_SERENA_REQUEST_TIMEOUT ?? filesSerena.requestTimeoutMs, 60_000, "AUVRYNT_SERENA_REQUEST_TIMEOUT",
    ),
    idleTimeoutMinutes: parsePositiveInteger(
      env.AUVRYNT_SERENA_IDLE_TIMEOUT ?? filesSerena.idleTimeoutMinutes, 30, "AUVRYNT_SERENA_IDLE_TIMEOUT",
    ),
    maxInstances: parsePositiveInteger(
      env.AUVRYNT_SERENA_MAX_INSTANCES ?? filesSerena.maxInstances, 3, "AUVRYNT_SERENA_MAX_INSTANCES",
    ),
  };
}

function parseArbiterConfig(
  env: NodeJS.ProcessEnv,
  filesConfig: AuvryntUserConfig,
  filesAuth: { arbiterApiKey?: string },
): ArbiterServerConfig {
  const file = filesConfig.arbiter ?? {};
  const endpoint = env.AUVRYNT_ARBITER_URL ?? file.endpoint ?? "http://127.0.0.1:8010";
  if (endpoint.trim().length === 0 || endpoint.length > 2048) {
    throw new Error("Invalid AUVRYNT_ARBITER_URL: endpoint must be between 1 and 2048 characters.");
  }
  const model = env.AUVRYNT_ARBITER_MODEL ?? file.model ?? "laya-typed-decisions";
  if (model.trim().length === 0 || model.length > 128) {
    throw new Error("Invalid AUVRYNT_ARBITER_MODEL: model must be between 1 and 128 characters.");
  }
  const apiKey = parseOptionalSecret(
    env.AUVRYNT_ARBITER_API_KEY ?? filesAuth.arbiterApiKey,
    "AUVRYNT_ARBITER_API_KEY",
    4096,
  );
  return {
    enabled: parseBoolean(
      env.AUVRYNT_ARBITER_ENABLED ?? file.enabled ?? false,
      "AUVRYNT_ARBITER_ENABLED",
    ),
    endpoint: endpoint.trim(),
    model: model.trim(),
    timeoutMs: parseArbiterTimeout(
      env.AUVRYNT_ARBITER_TIMEOUT_MS ?? file.timeoutMs,
      10_000,
    ),
    apiKey,
  };
}

function parseArbiterTimeout(value: string | number | undefined, fallback: number): number {
  const parsed = parsePositiveInteger(value, fallback, "AUVRYNT_ARBITER_TIMEOUT_MS");
  if (parsed < 250 || parsed > 120_000) {
    throw new Error(`Invalid AUVRYNT_ARBITER_TIMEOUT_MS: ${value}. Must be between 250 and 120000 milliseconds.`);
  }
  return parsed;
}

function cleanExecutablePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/^["']|["']$/g, "").trim();
  return trimmed || undefined;
}

function parseExecutablesConfig(env: NodeJS.ProcessEnv, filesConfig: AuvryntUserConfig): AuvryntExecutablesConfig {
  const configExecs = filesConfig.executables ?? {};
  return {
    serena: cleanExecutablePath(env.AUVRYNT_SERENA_PATH ?? configExecs.serena),
    godot: cleanExecutablePath(env.AUVRYNT_GODOT_PATH ?? configExecs.godot),
    godotCsharp: cleanExecutablePath(env.AUVRYNT_GODOT_CSHARP_PATH ?? configExecs.godotCsharp),
    blender: cleanExecutablePath(env.AUVRYNT_BLENDER_PATH ?? configExecs.blender),
    aseprite: cleanExecutablePath(env.AUVRYNT_ASEPRITE_PATH ?? configExecs.aseprite),
    asepriteSource: cleanExecutablePath(env.AUVRYNT_ASEPRITE_SOURCE_PATH ?? configExecs.asepriteSource),
  };
}

function parseOptionalIntegrationBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean" || typeof value === "string") return parseBoolean(value, name);
  throw new Error(`Invalid ${name}: expected boolean`);
}

function parseIntegrationsConfig(env: NodeJS.ProcessEnv, filesConfig: AuvryntUserConfig): Required<AuvryntIntegrationsConfig> {
  const configIntegrations = filesConfig.integrations ?? {};
  return {
    godotGdscript: parseOptionalIntegrationBoolean(env.AUVRYNT_GODOT_GDSCRIPT_ENABLED, "AUVRYNT_GODOT_GDSCRIPT_ENABLED") ?? configIntegrations.godotGdscript ?? false,
    godotCsharp: parseOptionalIntegrationBoolean(env.AUVRYNT_GODOT_CSHARP_ENABLED, "AUVRYNT_GODOT_CSHARP_ENABLED") ?? configIntegrations.godotCsharp ?? false,
    blender: parseOptionalIntegrationBoolean(env.AUVRYNT_BLENDER_ENABLED, "AUVRYNT_BLENDER_ENABLED") ?? configIntegrations.blender ?? false,
    aseprite: parseOptionalIntegrationBoolean(env.AUVRYNT_ASEPRITE_ENABLED, "AUVRYNT_ASEPRITE_ENABLED") ?? configIntegrations.aseprite ?? false,
    serena: parseOptionalIntegrationBoolean(
      env.AUVRYNT_SERENA_INTEGRATION_ENABLED ?? env.AUVRYNT_SERENA_ENABLED,
      "AUVRYNT_SERENA_INTEGRATION_ENABLED",
    ) ?? configIntegrations.serena ?? filesConfig.serena?.enabled ?? true,
    solOrchestrator: parseOptionalIntegrationBoolean(
      env.AUVRYNT_SOL_ORCHESTRATOR_ENABLED,
      "AUVRYNT_SOL_ORCHESTRATOR_ENABLED",
    ) ?? configIntegrations.solOrchestrator ?? false,
    playwright: parseOptionalIntegrationBoolean(env.AUVRYNT_PLAYWRIGHT_ENABLED, "AUVRYNT_PLAYWRIGHT_ENABLED") ?? configIntegrations.playwright ?? false,
    roblox: parseOptionalIntegrationBoolean(env.AUVRYNT_ROBLOX_ENABLED, "AUVRYNT_ROBLOX_ENABLED") ?? configIntegrations.roblox ?? false,
    desktop: parseOptionalIntegrationBoolean(env.AUVRYNT_DESKTOP_ENABLED, "AUVRYNT_DESKTOP_ENABLED") ?? configIntegrations.desktop ?? false,
    krita: parseOptionalIntegrationBoolean(env.AUVRYNT_KRITA_ENABLED, "AUVRYNT_KRITA_ENABLED") ?? configIntegrations.krita ?? false,
    openPencil: parseOptionalIntegrationBoolean(env.AUVRYNT_OPEN_PENCIL_ENABLED, "AUVRYNT_OPEN_PENCIL_ENABLED") ?? configIntegrations.openPencil ?? false,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const files = loadAuvryntFiles(env);
  const integrations = parseIntegrationsConfig(env, files.config);
  const host = env.HOST ?? files.config.host ?? "127.0.0.1";
  const port = parsePort(env.PORT ?? files.config.port);
  const publicBaseUrl = parsePublicBaseUrl(
    env.AUVRYNT_PUBLIC_BASE_URL ?? files.config.publicBaseUrl ?? localPublicBaseUrl(host, port),
  );
  const derivedAllowedHosts = [
    "localhost",
    "127.0.0.1",
    "::1",
    host,
    new URL(publicBaseUrl).hostname,
    ...(files.config.allowedHosts ?? []),
  ];
  const maxSessions = parseMcpSessionLimit(
    env.AUVRYNT_MAX_SESSIONS ?? files.config.maxSessions,
    DEFAULT_MCP_SESSIONS,
    "AUVRYNT_MAX_SESSIONS",
  );
  const maxSessionsPerClient = Math.min(
    maxSessions,
    parseMcpSessionLimit(
      env.AUVRYNT_MAX_SESSIONS_PER_CLIENT ?? files.config.maxSessionsPerClient,
      DEFAULT_MCP_SESSIONS_PER_CLIENT,
      "AUVRYNT_MAX_SESSIONS_PER_CLIENT",
    ),
  );

  return {
    host,
    port,
    oauth: parseOAuthConfig(env, files.auth.ownerToken, files.config.blenderPythonEnabled === true),
    allowedRoots: parseAllowedRoots(env.AUVRYNT_ALLOWED_ROOTS ?? files.config.allowedRoots),
    allowedHosts: parseAllowedHosts(env.AUVRYNT_ALLOWED_HOSTS, derivedAllowedHosts),
    maxSessions,
    maxSessionsPerClient,
    sessionIdleTimeoutMs: parseSessionIdleTimeout(
      env.AUVRYNT_SESSION_IDLE_MS ?? files.config.sessionIdleTimeoutMs,
      DEFAULT_SESSION_IDLE_TIMEOUT_MS,
      "AUVRYNT_SESSION_IDLE_MS",
    ),
    publicBaseUrl,
    minimalTools: parseMinimalTools(env),
    toolNaming: parseToolNaming(env.AUVRYNT_TOOL_NAMING),
    widgets: parseWidgetMode(env.AUVRYNT_WIDGETS, files.config.widgets),
    stateDir: resolve(expandHomePath(env.AUVRYNT_STATE_DIR ?? files.config.stateDir ?? defaultStateDir())),
    worktreeRoot: resolve(expandHomePath(env.AUVRYNT_WORKTREE_ROOT ?? files.config.worktreeRoot ?? defaultWorktreeRoot())),
    skillsEnabled: env.AUVRYNT_SKILLS === undefined ? true : parseBoolean(env.AUVRYNT_SKILLS),
    skillPaths: parsePathList(env.AUVRYNT_SKILL_PATHS ?? files.config.skillPaths),
    agentDir: resolve(expandHomePath(env.AUVRYNT_AGENT_DIR ?? files.config.agentDir ?? defaultAgentDir())),
    logging: parseLoggingConfig(env),
    serena: parseSerenaConfig(env, files.config),
    arbiter: parseArbiterConfig(env, files.config, files.auth),
    jobs: parseJobsConfig(env, files.config),
    executables: parseExecutablesConfig(env, files.config),
    integrations,
    tunnelProvider: parseTunnelProvider(env.AUVRYNT_TUNNEL_PROVIDER, files.config.tunnelProvider),
    cloudflareTokenManaged: files.config.cloudflareTokenManaged === true,
    cloudflareTunnelToken: env.AUVRYNT_CLOUDFLARE_TUNNEL_TOKEN?.trim() || files.auth.cloudflareTunnelToken,
    ngrokAuthtoken: resolveNgrokAuthtoken(files, env),
    ngrokUrl: normalizeNgrokUrl(env.AUVRYNT_NGROK_URL ?? files.config.ngrokUrl),
    toolToggles: files.config.toolToggles ?? {},
  };
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost") return true;
  const version = isIP(normalized);
  return (version === 4 && normalized.startsWith("127.")) || (version === 6 && normalized === "::1");
}

function parsePublicBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid AUVRYNT_PUBLIC_BASE_URL scheme: ${parsed.protocol}`);
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("AUVRYNT_PUBLIC_BASE_URL must use HTTPS unless it points to a loopback host.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("AUVRYNT_PUBLIC_BASE_URL must not contain embedded credentials.");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("AUVRYNT_PUBLIC_BASE_URL must be an origin only (scheme, host, and optional port). Do not include a path, query, or fragment.");
  }
  return parsed.origin;
}

function localPublicBaseUrl(host: string, port: number): string {
  const publicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const formattedHost = publicHost.includes(":") && !publicHost.startsWith("[")
    ? `[${publicHost}]`
    : publicHost;
  return `http://${formattedHost}:${port}`;
}
