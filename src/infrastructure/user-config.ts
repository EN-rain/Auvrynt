import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import * as z from "zod/v4";
import { expandHomePath } from "../roots.js";
import { MAX_MCP_SESSIONS } from "./session-limits.js";

export interface AuvryntExecutablesConfig {
  serena?: string;
  godot?: string;
  godotCsharp?: string;
  blender?: string;
  aseprite?: string;
  asepriteSource?: string;
  [key: string]: string | undefined;
}

export interface AuvryntIntegrationsConfig {
  godotGdscript?: boolean;
  godotCsharp?: boolean;
  blender?: boolean;
  aseprite?: boolean;
  serena?: boolean;
  solOrchestrator?: boolean;
  playwright?: boolean;
  roblox?: boolean;
  desktop?: boolean;
  krita?: boolean;
  openPencil?: boolean;
}

export interface AuvryntJobsUserConfig {
  enabled?: boolean;
  minimumMatchScore?: number;
  riskAutoSkipScore?: number;
  integrations?: {
    facebook?: { enabled?: boolean };
  };
}

export interface AuvryntSerenaUserConfig {
  enabled?: boolean;
  executable?: string;
  backend?: "LSP" | "JetBrains";
  context?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  idleTimeoutMinutes?: number;
  maxInstances?: number;
}

export interface AuvryntArbiterUserConfig {
  enabled?: boolean;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

export interface AuvryntUserConfig {
  host?: string;
  port?: number;
  allowedRoots?: string[];
  /** Last workspace selected through the dashboard or an explicit lifecycle command. */
  workspaceRoot?: string;
  publicBaseUrl?: string | null;
  allowedHosts?: string[];
  maxSessions?: number;
  maxSessionsPerClient?: number;
  sessionIdleTimeoutMs?: number;
  widgets?: "off" | "compact" | "changes" | "full";
  stateDir?: string;
  worktreeRoot?: string;
  agentDir?: string;
  skillPaths?: string[];
  executables?: AuvryntExecutablesConfig;
  integrations?: AuvryntIntegrationsConfig;
  serena?: AuvryntSerenaUserConfig;
  arbiter?: AuvryntArbiterUserConfig;
  jobs?: AuvryntJobsUserConfig;
  tunnelProvider?: "cloudflare" | "ngrok" | "custom";
  /** Opt in to an Auvrynt-managed custom Cloudflare tunnel, including on Windows. */
  cloudflareTokenManaged?: boolean;
  ngrokAuthtoken?: string;
  ngrokUrl?: string;
  /** Trusted-owner opt-in for arbitrary Python execution inside local Blender. */
  blenderPythonEnabled?: boolean;
  toolToggles?: Record<string, boolean>;
}

export interface AuvryntAuthConfig {
  ownerToken?: string;
  cloudflareTunnelToken?: string;
  cloudflareProfiles?: Array<{ name: string; certPath: string }>;
  cloudflareActiveProfile?: string;
  arbiterApiKey?: string;
  ngrokAuthtokens?: string[];
  ngrokActiveAuthtokenIndex?: number;
  ngrokQuotaExhausted?: Record<string, string>;
}

export interface AuvryntFiles {
  dir: string;
  configPath: string;
  authPath: string;
  configExists: boolean;
  authExists: boolean;
  config: AuvryntUserConfig;
  auth: AuvryntAuthConfig;
}

const executablesSchema = z.object({
  serena: z.string().optional(),
  godot: z.string().optional(),
  godotCsharp: z.string().optional(),
  blender: z.string().optional(),
  aseprite: z.string().optional(),
  asepriteSource: z.string().optional(),
}).catchall(z.string());

const integrationsSchema = z.object({
  godotGdscript: z.boolean().optional(),
  godotCsharp: z.boolean().optional(),
  blender: z.boolean().optional(),
  aseprite: z.boolean().optional(),
  serena: z.boolean().optional(),
  solOrchestrator: z.boolean().optional(),
  playwright: z.boolean().optional(),
  roblox: z.boolean().optional(),
  desktop: z.boolean().optional(),
  krita: z.boolean().optional(),
  openPencil: z.boolean().optional(),
}).strict();

const positiveInteger = z.number().int().positive();
const jobsSchema = z.object({
  enabled: z.boolean().optional(),
  minimumMatchScore: z.number().int().min(0).max(100).optional(),
  riskAutoSkipScore: z.number().int().min(0).max(100).optional(),
  integrations: z.object({
    facebook: z.object({ enabled: z.boolean().optional() }).optional(),
  }).strict().optional(),
}).strict();

const serenaSchema = z.object({
  enabled: z.boolean().optional(),
  executable: z.string().optional(),
  backend: z.enum(["LSP", "JetBrains"]).optional(),
  context: z.string().optional(),
  startupTimeoutMs: positiveInteger.optional(),
  requestTimeoutMs: positiveInteger.optional(),
  idleTimeoutMinutes: positiveInteger.optional(),
  maxInstances: positiveInteger.optional(),
}).strict();

const arbiterSchema = z.object({
  enabled: z.boolean().optional(),
  endpoint: z.string().min(1).max(2048).optional(),
  model: z.string().min(1).max(128).optional(),
  timeoutMs: z.number().int().min(250).max(120_000).optional(),
}).strict();

const userConfigSchema: z.ZodType<AuvryntUserConfig> = z.object({
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  allowedRoots: z.array(z.string()).optional(),
  workspaceRoot: z.string().min(1).optional(),
  publicBaseUrl: z.string().nullable().optional(),
  allowedHosts: z.array(z.string()).optional(),
  maxSessions: z.number().int().min(1).max(MAX_MCP_SESSIONS).optional(),
  maxSessionsPerClient: z.number().int().min(1).max(MAX_MCP_SESSIONS).optional(),
  sessionIdleTimeoutMs: z.number().int().min(60_000).max(7 * 24 * 60 * 60 * 1000).optional(),
  widgets: z.enum(["off", "compact", "changes", "full"]).optional(),
  stateDir: z.string().optional(),
  worktreeRoot: z.string().optional(),
  agentDir: z.string().optional(),
  skillPaths: z.array(z.string().min(1)).optional(),
  executables: executablesSchema.optional(),
  integrations: integrationsSchema.optional(),
  serena: serenaSchema.optional(),
  arbiter: arbiterSchema.optional(),
  jobs: jobsSchema.optional(),
  tunnelProvider: z.enum(["cloudflare", "ngrok", "custom"]).optional(),
  cloudflareTokenManaged: z.boolean().optional(),
  ngrokAuthtoken: z.string().optional(),
  ngrokUrl: z.string().optional(),
  blenderPythonEnabled: z.boolean().optional(),
  toolToggles: z.record(z.string(), z.boolean()).optional(),
}).strict();

const authConfigSchema: z.ZodType<AuvryntAuthConfig> = z.object({
  ownerToken: z.string().optional(),
  cloudflareTunnelToken: z.string().min(16).max(2048).optional(),
  cloudflareProfiles: z.array(z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
    certPath: z.string().min(1).max(4096),
  }).strict()).max(2).optional(),
  cloudflareActiveProfile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/).optional(),
  arbiterApiKey: z.string().min(16).max(4096).optional(),
  ngrokAuthtokens: z.array(z.string().min(16).max(512)).max(20).optional(),
  ngrokActiveAuthtokenIndex: z.number().int().min(0).optional(),
  ngrokQuotaExhausted: z.record(z.string(), z.string()).optional(),
}).strict();

export function auvryntConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(expandHomePath(env.AUVRYNT_CONFIG_DIR ?? join(homedir(), ".auvrynt")));
}

export function auvryntConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(auvryntConfigDir(env), "config.json");
}

export function auvryntAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(auvryntConfigDir(env), "auth.json");
}

export function loadAuvryntFiles(env: NodeJS.ProcessEnv = process.env): AuvryntFiles {
  const dir = auvryntConfigDir(env);
  const configPath = join(dir, "config.json");
  const authPath = join(dir, "auth.json");
  const configExists = existsSync(configPath);
  const authExists = existsSync(authPath);

  return {
    dir,
    configPath,
    authPath,
    configExists,
    authExists,
    config: configExists ? readJsonFile(configPath, userConfigSchema, migrateRemovedConfigFields) : {},
    auth: authExists ? readJsonFile(authPath, authConfigSchema, migrateRemovedAuthFields) : {},
  };
}

export function writeAuvryntConfig(
  config: AuvryntUserConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const validated = userConfigSchema.parse(config);
  const filePath = auvryntConfigPath(env);
  ensurePrivateDirectory(auvryntConfigDir(env));
  writeJsonFile(filePath, validated, 0o600);
  return filePath;
}

export function writeAuvryntAuth(
  auth: AuvryntAuthConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const validated = authConfigSchema.parse(auth);
  const filePath = auvryntAuthPath(env);
  ensurePrivateDirectory(auvryntConfigDir(env));
  writeJsonFile(filePath, validated, 0o600);
  return filePath;
}

export function generateOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

type JsonMigration = (value: unknown) => { value: unknown; changed: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function migrateRemovedConfigFields(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value)) return { value, changed: false };
  const migrated = { ...value };
  let changed = false;
  if ("obsidian" in migrated) {
    delete migrated.obsidian;
    changed = true;
  }
  if (isRecord(migrated.integrations)) {
    const integrations = { ...migrated.integrations };
    for (const key of ["context7", "obsidian"]) {
      if (key in integrations) {
        delete integrations[key];
        changed = true;
      }
    }
    migrated.integrations = integrations;
  }
  return { value: migrated, changed };
}

function migrateRemovedAuthFields(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value)) return { value, changed: false };
  if (!("context7ApiKey" in value)) return { value, changed: false };
  const migrated = { ...value };
  delete migrated.context7ApiKey;
  return { value: migrated, changed: true };
}

function readJsonFile<T>(filePath: string, schema: z.ZodType<T>, migrate?: JsonMigration): T {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const migrated = migrate?.(parsed) ?? { value: parsed, changed: false };
    const result = schema.safeParse(migrated.value);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(`invalid configuration (${details})`);
    }
    if (migrated.changed) writeJsonFile(filePath, result.data, 0o600);
    return result.data;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${filePath}: ${reason}`);
  }
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    // Windows and some network filesystems may not expose POSIX mode bits.
  }
}

function writeJsonFile(filePath: string, value: unknown, mode: number): void {
  ensurePrivateDirectory(dirname(filePath));
  const tempPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );

  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", { mode, flag: "wx" });
    try {
      chmodSync(tempPath, mode);
    } catch {
      // Best effort on platforms without POSIX permissions.
    }
    renameSync(tempPath, filePath);
    try {
      chmodSync(filePath, mode);
    } catch {
      // Best effort on platforms without POSIX permissions.
    }
  } finally {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // A failed cleanup must not hide the original write/rename error.
      }
    }
  }
}
