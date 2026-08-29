import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, openSync, writeSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const INTEGRATION_KEYS = ["godotGdscript", "godotCsharp", "blender", "aseprite", "serena", "playwright", "context7", "obsidian", "roblox"] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export const INTEGRATION_LABELS: Record<IntegrationKey, string> = {
  godotGdscript: "Godot GDScript",
  godotCsharp: "Godot C#",
  blender: "Blender",
  aseprite: "Aseprite",
  serena: "Software Development",
  playwright: "Web Development",
  context7: "Context7",
  obsidian: "Obsidian",
  roblox: "Roblox Studio",
};

const START_PROFILE_ALIASES: Record<string, IntegrationKey> = {
  model: "blender",
  blender: "blender",
  pixel: "aseprite",
  aseprite: "aseprite",
  web: "playwright",
  playwright: "playwright",
  godotcs: "godotCsharp",
  "godot-cs": "godotCsharp",
  godotcsharp: "godotCsharp",
  godotgd: "godotGdscript",
  "godot-gd": "godotGdscript",
  godotgdscript: "godotGdscript",
  se: "serena",
  serena: "serena",
  context7: "context7",
  c7: "context7",
  obsidian: "obsidian",
  notes: "obsidian",
  roblox: "roblox",
  robloxstudio: "roblox",
  rbx: "roblox",
};

export interface StartRequest {
  profiles?: IntegrationKey[];
  replace: boolean;
  backgroundChild: boolean;
}

export interface ProcessIdentity {
  processPath: string;
  processStartedAt: string;
}

export interface InstanceLockRecord extends ProcessIdentity {
  instanceId: string;
  pid: number;
  startedAt: string;
  host: string;
  port: number;
  profiles?: IntegrationKey[];
  launchRoot?: string;
  controlToken?: string;
}

export type TunnelProvider = "cloudflare" | "ngrok" | "custom";

export interface ManagedTunnelRecord extends ProcessIdentity {
  pid: number;
  url: string;
  port: number;
  provider?: TunnelProvider;
}

interface ManagementLockRecord extends ProcessIdentity {
  pid: number;
  nonce: string;
}

export function parseIntegrationProfiles(args: string[]): IntegrationKey[] {
  const tokens = args
    .flatMap((arg) => arg.split(/[\s,]+/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error("Choose at least one profile: blender, pixel, web, godotcs, godotgd, se, or roblox.");

  const profiles = new Set<IntegrationKey>();
  for (const token of tokens) {
    const profile = START_PROFILE_ALIASES[token];
    if (!profile) throw new Error(`Unknown start profile: ${token}. Use blender, pixel, web, godotcs, godotgd, se, or roblox.`);
    profiles.add(profile);
  }
  return [...profiles];
}

export function parseStartRequest(args: string[]): StartRequest {
  const backgroundChild = args.includes("--background-child");
  const replace = args.includes("--replace");
  const noIntegrations = args.includes("--no-integrations");
  const profiles = args.filter((arg) => arg !== "--background-child" && arg !== "--replace" && arg !== "--no-integrations");
  if (noIntegrations && profiles.length > 0) throw new Error("Do not combine --no-integrations with start profiles.");
  const unknownOption = profiles.find((arg) => arg.startsWith("--"));
  if (unknownOption) throw new Error(`Unknown start option: ${unknownOption}`);
  return { profiles: noIntegrations ? [] : profiles.length > 0 ? parseIntegrationProfiles(profiles) : [], replace, backgroundChild };
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isInteger(pid) || pid < 1 || !isProcessRunning(pid)) return undefined;
  if (process.platform !== "win32") {
    return {
      processPath: pid === process.pid ? resolve(process.execPath) : `pid:${pid}`,
      processStartedAt: pid === process.pid ? new Date(Date.now() - process.uptime() * 1000).toISOString() : "unknown",
    };
  }

  try {
    const script = [
      `$p = Get-Process -Id ${pid} -ErrorAction Stop`,
      "[pscustomobject]@{ processPath = $p.Path; processStartedAt = $p.StartTime.ToUniversalTime().ToString('o') }",
      "| ConvertTo-Json -Compress",
    ].join("; ").replace("; |", " |");
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    const parsed = JSON.parse(raw) as Partial<ProcessIdentity>;
    if (!parsed.processPath || !parsed.processStartedAt) return undefined;
    return { processPath: resolve(parsed.processPath), processStartedAt: parsed.processStartedAt };
  } catch {
    return undefined;
  }
}

export function processIdentityMatches(pid: number, expected: Partial<ProcessIdentity>): boolean {
  if (!expected.processPath || !expected.processStartedAt) return false;
  const actual = getProcessIdentity(pid);
  if (!actual) return false;
  const samePath = resolve(actual.processPath).toLowerCase() === resolve(expected.processPath).toLowerCase();
  const actualStart = Date.parse(actual.processStartedAt);
  const expectedStart = Date.parse(expected.processStartedAt);
  return samePath && Number.isFinite(actualStart) && Number.isFinite(expectedStart) && Math.abs(actualStart - expectedStart) < 1_000;
}

export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  try {
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function acquireManagementLock(stateDir: string): Promise<{ release: () => Promise<void> }> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const lockPath = join(stateDir, "manager.lock");
  const identity = getProcessIdentity(process.pid);
  if (!identity) throw new Error("Could not identify the current Auvrynt management process.");

  for (let attempt = 0; attempt < 3; attempt++) {
    const nonce = randomBytes(16).toString("hex");
    try {
      const handle = openSync(lockPath, "wx", 0o600);
      const record: ManagementLockRecord = { pid: process.pid, nonce, ...identity };
      try {
        const bytes = Buffer.from(JSON.stringify(record));
        writeSync(handle, bytes);
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      return {
        release: async () => {
          const current = await readJsonFile<ManagementLockRecord>(lockPath);
          if (current?.pid === process.pid && current.nonce === nonce) {
            await unlink(lockPath).catch(() => undefined);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readJsonFile<ManagementLockRecord>(lockPath);
      if (current && processIdentityMatches(current.pid, current)) {
        throw new Error(`Another Auvrynt lifecycle command is already running (PID ${current.pid}).`);
      }
      await unlink(lockPath).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw new Error("Could not acquire the Auvrynt lifecycle lock.");
}

export async function rotateLogFile(path: string, maxBytes = 5 * 1024 * 1024): Promise<void> {
  if (!existsSync(path)) return;
  const info = await stat(path).catch(() => undefined);
  if (!info || info.size < maxBytes) return;
  const backup = `${path}.1`;
  await unlink(backup).catch(() => undefined);
  await rename(path, backup);
}
