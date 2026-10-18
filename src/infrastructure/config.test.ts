import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "./config.js";

const emptyConfigDir = mkdtempSync(join(tmpdir(), "auvrynt-empty-config-test-"));
const baseEnv = {
  AUVRYNT_CONFIG_DIR: emptyConfigDir,
  AUVRYNT_ALLOWED_ROOTS: process.cwd(),
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
};

assert.equal(loadConfig(baseEnv).widgets, "compact");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "compact" }).widgets, "compact");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "changes" }).widgets, "changes");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "full" }).widgets, "full");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "off" }).widgets, "off");
assert.equal(loadConfig(baseEnv).toolNaming, "short");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TOOL_NAMING: "short" }).toolNaming, "short");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TOOL_NAMING: "legacy" }).toolNaming, "legacy");
assert.equal(loadConfig(baseEnv).minimalTools, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TOOL_MODE: "minimal" }).minimalTools, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TOOL_MODE: "full" }).minimalTools, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_MINIMAL_TOOLS: "0" }).minimalTools, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_MINIMAL_TOOLS: "1" }).minimalTools, true);
assert.equal(loadConfig(baseEnv).maxSessions, 32);
assert.equal(loadConfig(baseEnv).maxSessionsPerClient, 8);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_MAX_SESSIONS: "10" }).maxSessions, 10);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_MAX_SESSIONS_PER_CLIENT: "5" }).maxSessionsPerClient, 5);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_MAX_SESSIONS: "257" }),
  /Maximum is 256/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_MAX_SESSIONS_PER_CLIENT: "0" }),
  /Invalid AUVRYNT_MAX_SESSIONS_PER_CLIENT/,
);
assert.equal(loadConfig(baseEnv).skillsEnabled, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_SKILLS: "0" }).skillsEnabled, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_SKILLS: "1" }).skillsEnabled, true);
assert.equal(loadConfig(baseEnv).serena.enabled, true);
assert.equal(loadConfig(baseEnv).integrations.serena, true);
assert.equal("obsidian" in loadConfig(baseEnv), false);
assert.equal("context7" in loadConfig(baseEnv).integrations, false);
assert.equal(loadConfig(baseEnv).integrations.aseprite, false);
assert.equal(loadConfig(baseEnv).integrations.solOrchestrator, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_SOL_ORCHESTRATOR_ENABLED: "1" }).integrations.solOrchestrator, true);
assert.equal(loadConfig(baseEnv).sessionIdleTimeoutMs, 12 * 60 * 60 * 1000);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_CLOUDFLARE_TUNNEL_TOKEN: "t".repeat(16) }).cloudflareTunnelToken, "t".repeat(16));
const arbiterEnv = {
  ...baseEnv,
  AUVRYNT_ARBITER_ENABLED: "1",
  AUVRYNT_ARBITER_URL: "https://arbiter.example.test",
  AUVRYNT_ARBITER_MODEL: "laya-typed-decisions",
  AUVRYNT_ARBITER_TIMEOUT_MS: "7500",
  AUVRYNT_ARBITER_API_KEY: "arbiter-api-key-that-is-long-enough",
};
assert.equal(loadConfig(arbiterEnv).arbiter.enabled, true);
assert.equal(loadConfig(arbiterEnv).arbiter.endpoint, "https://arbiter.example.test");
assert.equal(loadConfig(arbiterEnv).arbiter.model, "laya-typed-decisions");
assert.equal(loadConfig(arbiterEnv).arbiter.timeoutMs, 7500);
assert.equal(loadConfig(arbiterEnv).arbiter.apiKey, "arbiter-api-key-that-is-long-enough");
assert.equal(loadConfig(baseEnv).arbiter.enabled, false);
assert.equal(loadConfig(baseEnv).arbiter.apiKey, undefined);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_SESSION_IDLE_MS: String(60 * 60 * 1000) }).sessionIdleTimeoutMs, 60 * 60 * 1000);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_SESSION_IDLE_MS: "59999" }),
  /Invalid AUVRYNT_SESSION_IDLE_MS/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_SESSION_IDLE_MS: String(7 * 24 * 60 * 60 * 1000 + 1) }),
  /Invalid AUVRYNT_SESSION_IDLE_MS/,
);
assert.equal(loadConfig(baseEnv).integrations.serena, true);
assert.equal(
  loadConfig({ ...baseEnv, AUVRYNT_ASEPRITE_SOURCE_PATH: "C:/src/aseprite" }).executables.asepriteSource,
  "C:/src/aseprite",
);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_SERENA_ENABLED: "0" }).serena.enabled, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_SERENA_INTEGRATION_ENABLED: "0" }).integrations.serena, false);

assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "invalid" }),
  /Invalid AUVRYNT_WIDGETS: invalid/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "minimal" }),
  /Invalid AUVRYNT_WIDGETS: minimal/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "write-only" }),
  /Invalid AUVRYNT_WIDGETS: write-only/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_TOOL_MODE: "invalid" }),
  /Invalid AUVRYNT_TOOL_MODE: invalid/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_TOOL_NAMING: "invalid" }),
  /Invalid AUVRYNT_TOOL_NAMING: invalid/,
);

assert.deepEqual(loadConfig(baseEnv).logging, {
  level: "info",
  format: "json",
  requests: true,
  assets: false,
  toolCalls: true,
  shellCommands: false,
});

assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "silent" }).logging.level, "silent");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "error" }).logging.level, "error");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "warn" }).logging.level, "warn");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "info" }).logging.level, "info");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "debug" }).logging.level, "debug");

assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_FORMAT: "json" }).logging.format, "json");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_FORMAT: "pretty" }).logging.format, "pretty");

assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_REQUESTS: "0" }).logging.requests, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_ASSETS: "1" }).logging.assets, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_TOOL_CALLS: "0" }).logging.toolCalls, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_SHELL_COMMANDS: "1" }).logging.shellCommands, true);

assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "trace" }),
  /Invalid AUVRYNT_LOG_LEVEL: trace/,
);

assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_LOG_FORMAT: "color" }),
  /Invalid AUVRYNT_LOG_FORMAT: color/,
);

assert.equal(loadConfig(baseEnv).oauth.ownerToken, "test-owner-token-that-is-long-enough");
assert.deepEqual(loadConfig(baseEnv).oauth.scopes, [
  "auvrynt:read",
  "auvrynt:write",
  "auvrynt:process",
  "auvrynt:web",
  "auvrynt:software",
  "auvrynt:godot",
  "auvrynt:blender",
  "auvrynt:aseprite",
  "auvrynt:serena",
  "auvrynt:roblox",
  "auvrynt:krita",
  "auvrynt:open-pencil",
]);
assert.equal(loadConfig(baseEnv).oauth.scopes.includes("auvrynt:desktop"), false);
assert.equal(loadConfig(baseEnv).oauth.scopes.includes("auvrynt:blender-python"), false);

const privilegedBlenderConfigDir = mkdtempSync(join(tmpdir(), "auvrynt-blender-python-config-test-"));
writeFileSync(join(privilegedBlenderConfigDir, "config.json"), JSON.stringify({ blenderPythonEnabled: true }));
const privilegedBlenderEnv = { ...baseEnv, AUVRYNT_CONFIG_DIR: privilegedBlenderConfigDir };
assert.equal(
  loadConfig(privilegedBlenderEnv).oauth.scopes.includes("auvrynt:blender-python"),
  true,
  "private config opt-in must add the privileged Blender Python scope",
);
assert.deepEqual(
  loadConfig({ ...privilegedBlenderEnv, AUVRYNT_OAUTH_SCOPES: "auvrynt:read,auvrynt:blender" }).oauth.scopes,
  ["auvrynt:read", "auvrynt:blender"],
  "an explicit OAuth scope environment value must remain authoritative",
);

assert.deepEqual(loadConfig(baseEnv).oauth.allowedRedirectHosts, [
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
]);
assert.equal(loadConfig(baseEnv).oauth.accessTokenTtlSeconds, 3600);
assert.equal(loadConfig(baseEnv).oauth.refreshTokenTtlSeconds, 2592000);
assert.deepEqual(loadConfig(baseEnv).oauth.staticClients, []);

const staticClientEnv = {
  ...baseEnv,
  AUVRYNT_OAUTH_CLIENT_ID: "test-gemini-client",
  AUVRYNT_OAUTH_CLIENT_SECRET: "test-gemini-secret",
};
assert.deepEqual(loadConfig(staticClientEnv).oauth.staticClients, [
  {
    clientId: "test-gemini-client",
    clientSecret: "test-gemini-secret",
    redirectUris: [
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-109752885578851795204-mcp_auvrynt_dpdns_org",
      "https://oauth-redirect.googleusercontent.com",
      "https://gemini.google.com",
      "http://localhost",
      "http://127.0.0.1",
    ],
    clientName: "Configured Static Client",
  },
]);

assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_OAUTH_SCOPES: "auvrynt:read,admin" }),
  /unsupported scope\(s\): admin/,
);
assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_OAUTH_SCOPES: "auvrynt:read,auvrynt:blender,auvrynt:blender-python" }).oauth.scopes,
  ["auvrynt:read", "auvrynt:blender", "auvrynt:blender-python"],
);
assert.deepEqual(
  loadConfig({
    ...baseEnv,
    AUVRYNT_GODOT_GDSCRIPT_ENABLED: "0",
    AUVRYNT_GODOT_CSHARP_ENABLED: "0",
    AUVRYNT_BLENDER_ENABLED: "1",
    AUVRYNT_ASEPRITE_ENABLED: "1",
    AUVRYNT_SERENA_INTEGRATION_ENABLED: "0",
    AUVRYNT_PLAYWRIGHT_ENABLED: "0",
  }).oauth.scopes,
  loadConfig(baseEnv).oauth.scopes,
  "local profiles must not shrink the durable OAuth capability envelope",
);
assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_OAUTH_ALLOWED_REDIRECT_HOSTS: "chatgpt.com,example.com" }).oauth
    .allowedRedirectHosts,
  ["chatgpt.com", "example.com"],
);
assert.equal(
  loadConfig({ ...baseEnv, AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "120" }).oauth
    .accessTokenTtlSeconds,
  120,
);
assert.equal(
  loadConfig({ ...baseEnv, AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS: "240" }).oauth
    .refreshTokenTtlSeconds,
  240,
);

assert.throws(
  () => loadConfig({ AUVRYNT_CONFIG_DIR: emptyConfigDir, AUVRYNT_ALLOWED_ROOTS: process.cwd() }),
  /AUVRYNT_OAUTH_OWNER_TOKEN is required/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_OAUTH_OWNER_TOKEN: "too-short" }),
  /AUVRYNT_OAUTH_OWNER_TOKEN must be at least 16 characters long/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "0" }),
  /Invalid AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS: 0/,
);

assert.equal(loadConfig(baseEnv).publicBaseUrl, "http://127.0.0.1:49321");
assert.deepEqual(loadConfig(baseEnv).allowedHosts, ["localhost", "127.0.0.1", "[::1]"]);

assert.equal(
  loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "https://abc.trycloudflare.com/" }).publicBaseUrl,
  "https://abc.trycloudflare.com",
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "ftp://example.com" }),
  /Invalid AUVRYNT_PUBLIC_BASE_URL scheme/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "http://example.com" }),
  /must use HTTPS unless it points to a loopback host/,
);
assert.equal(
  loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "http://localhost:49321" }).publicBaseUrl,
  "http://localhost:49321",
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "https://user:pass@example.com" }),
  /must not contain embedded credentials/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "https://example.com/mcp" }),
  /must be an origin only/i,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "https://example.com?debug=1" }),
  /must be an origin only/i,
);
assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "https://abc.trycloudflare.com/" }).allowedHosts,
  ["localhost", "127.0.0.1", "[::1]", "abc.trycloudflare.com"],
);
assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_ALLOWED_HOSTS: "*" }).allowedHosts,
  ["*"],
);
assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_ALLOWED_HOSTS: "EXAMPLE.COM,[::1]" }).allowedHosts,
  ["example.com", "[::1]"],
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_ALLOWED_HOSTS: "https://example.com" }),
  /Invalid allowed Host entry/i,
);
assert.ok(
  loadConfig({ ...baseEnv, HOST: "::1", AUVRYNT_PUBLIC_BASE_URL: "http://[::1]:49321" }).allowedHosts.includes("[::1]"),
);

const configDir = mkdtempSync(join(tmpdir(), "auvrynt-config-test-"));
writeFileSync(
  join(configDir, "config.json"),
  JSON.stringify({
    port: 8787,
    allowedRoots: [process.cwd()],
    publicBaseUrl: "https://auvrynt.example.com",
    skillPaths: ["C:/Users/LENOVO/Desktop/Projectsss/Auvrynt/skills"],
  }),
);
writeFileSync(
  join(configDir, "auth.json"),
  JSON.stringify({
    ownerToken: "persisted-owner-token-long-enough",
  }),
);

const fileConfig = loadConfig({ AUVRYNT_CONFIG_DIR: configDir });
assert.equal(fileConfig.port, 8787);
assert.equal(fileConfig.oauth.ownerToken, "persisted-owner-token-long-enough");
assert.equal(fileConfig.publicBaseUrl, "https://auvrynt.example.com");
assert.deepEqual(fileConfig.skillPaths, [resolve("C:/Users/LENOVO/Desktop/Projectsss/Auvrynt/skills")]);
assert.deepEqual(fileConfig.allowedHosts, [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "auvrynt.example.com",
]);
