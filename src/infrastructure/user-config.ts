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
  playwright?: boolean;
  context7?: boolean;
  obsidian?: boolean;
  roblox?: boolean;
}

export interface AuvryntObsidianUserConfig {
  enabled?: boolean;
  vaultPath?: string;
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

export interface AuvryntUserConfig {
  host?: string;
  port?: number;
  allowedRoots?: string[];
  publicBaseUrl?: string | null;
  allowedHosts?: string[];
  maxSessions?: number;
  maxSessionsPerClient?: number;
  sessionIdleTimeoutMs?: number;
  stateDir?: string;
  worktreeRoot?: string;
  agentDir?: string;
  executables?: AuvryntExecutablesConfig;
  integrations?: AuvryntIntegrationsConfig;
  serena?: AuvryntSerenaUserConfig;
  obsidian?: AuvryntObsidianUserConfig;
  tunnelProvider?: "cloudflare" | "ngrok" | "custom";
  ngrokAuthtoken?: string;
  ngrokUrl?: string;
  toolToggles?: Record<string, boolean>;
}

export interface AuvryntAuthConfig {
  ownerToken?: string;
  cloudflareTunnelToken?: string;
  ngrokAuthtokens?: string[];
  ngrokActiveAuthtokenIndex?: number;
  ngrokQuotaExhausted?: Record<string, string>;
  context7ApiKey?: string;
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
  playwright: z.boolean().optional(),
  context7: z.boolean().optional(),
  obsidian: z.boolean().optional(),
  roblox: z.boolean().optional(),
}).strict();

const positiveInteger = z.number().int().positive();
const obsidianSchema = z.object({
  enabled: z.boolean().optional(),
  vaultPath: z.string().min(1).max(1024).optional(),
});

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

const userConfigSchema: z.ZodType<AuvryntUserConfig> = z.object({
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  allowedRoots: z.array(z.string()).optional(),
  publicBaseUrl: z.string().nullable().optional(),
  allowedHosts: z.array(z.string()).optional(),
  maxSessions: z.number().int().min(1).max(99999).optional(),
  maxSessionsPerClient: z.number().int().min(1).max(99999).optional(),
  sessionIdleTimeoutMs: z.number().int().min(60_000).max(7 * 24 * 60 * 60 * 1000).optional(),
  stateDir: z.string().optional(),
  worktreeRoot: z.string().optional(),
  agentDir: z.string().optional(),
  executables: executablesSchema.optional(),
  integrations: integrationsSchema.optional(),
  serena: serenaSchema.optional(),
  obsidian: obsidianSchema.optional(),
  tunnelProvider: z.enum(["cloudflare", "ngrok", "custom"]).optional(),
  ngrokAuthtoken: z.string().optional(),
  ngrokUrl: z.string().optional(),
  toolToggles: z.record(z.string(), z.boolean()).optional(),
}).strict();

const authConfigSchema: z.ZodType<AuvryntAuthConfig> = z.object({
  ownerToken: z.string().optional(),
  cloudflareTunnelToken: z.string().min(16).max(2048).optional(),
  ngrokAuthtokens: z.array(z.string().min(16).max(512)).max(20).optional(),
  ngrokActiveAuthtokenIndex: z.number().int().min(0).optional(),
  ngrokQuotaExhausted: z.record(z.string(), z.string()).optional(),
  context7ApiKey: z.string().min(8).max(512).optional(),
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
    config: configExists ? readJsonFile(configPath, userConfigSchema) : {},
    auth: authExists ? readJsonFile(authPath, authConfigSchema) : {},
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

function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): T {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(`invalid configuration (${details})`);
    }
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
