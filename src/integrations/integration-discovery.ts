import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../config.js";

const execFileAsync = promisify(execFile);

export interface LocalIntegrationDiscovery {
  processes: string[];
  executables: Record<string, string | undefined>;
  ports: Record<string, boolean>;
}

export interface LocalIntegrationDiscoveryOptions {
  pollMs?: number;
  cacheMs?: number;
  forceRefresh?: boolean;
}

const PROCESS_MARKERS: Record<string, string[]> = {
  blender: ["blender.exe", "blender"],
  aseprite: ["aseprite.exe", "aseprite"],
  godot: ["godot.exe", "godot4.exe", "godot"],
  cloudflare_tunnel: ["cloudflared.exe", "cloudflared"],
  serena: ["serena.exe", "serena"],
  roblox: ["robloxstudiobeta.exe", "robloxstudio.exe", "robloxplayerbeta.exe"],
};

export const DEFAULT_INTEGRATION_DISCOVERY_CACHE_MS = 10_000;

let cachedDiscovery: { value: LocalIntegrationDiscovery; cachedAt: number } | undefined;
let discoveryInFlight: Promise<LocalIntegrationDiscovery> | undefined;

function probePort(host: string, port: number, timeoutMs = 350): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let finished = false;
    const finish = (available: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(available);
    };

    const timeout = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timeout);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      finish(false);
    });
  });
}

async function runningProcessNames(): Promise<string[]> {
  if (process.platform !== "win32") return [];

  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], {
      timeout: 5_000,
      windowsHide: true,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^"([^"]+)"/)?.[1]?.toLowerCase())
      .filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

async function findExecutable(command: string): Promise<string | undefined> {
  const exes = process.platform === "win32" ? [`${command}.exe`, command] : [command];
  const userBinDirs = [
    join(homedir(), ".auvrynt", "bin"),
    join(homedir(), ".local", "bin"),
    join(homedir(), "AppData", "Roaming", "Python", "Scripts"),
  ];

  for (const dir of userBinDirs) {
    for (const exe of exes) {
      const fullPath = join(dir, exe);
      if (existsSync(fullPath)) return fullPath;
    }
  }

  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(cmd, [command], {
      timeout: 5_000,
      windowsHide: true,
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

function findAsepriteInSource(sourcePath: string | undefined): string | undefined {
  if (!sourcePath) return undefined;
  const candidates = process.platform === "win32"
    ? [join(sourcePath, "build", "bin", "aseprite.exe"), join(sourcePath, "bin", "aseprite.exe"), join(sourcePath, "aseprite.exe")]
    : [join(sourcePath, "build", "bin", "aseprite"), join(sourcePath, "bin", "aseprite"), join(sourcePath, "aseprite")];
  return candidates.find((candidate) => existsSync(candidate));
}

function hasProcess(processes: string[], markers: string[]): boolean {
  return processes.some((processName) => markers.some((marker) => processName === marker || processName.includes(marker)));
}

export async function discoverLocalIntegrations(
  options: LocalIntegrationDiscoveryOptions = {},
): Promise<LocalIntegrationDiscovery> {
  const cacheMs = Math.max(0, options.cacheMs ?? DEFAULT_INTEGRATION_DISCOVERY_CACHE_MS);
  const forceRefresh = options.forceRefresh === true || (options.pollMs ?? 0) > 0;
  const now = Date.now();
  if (
    !forceRefresh
    && cacheMs > 0
    && cachedDiscovery
    && now - cachedDiscovery.cachedAt < cacheMs
  ) {
    return cloneDiscovery(cachedDiscovery.value);
  }

  const inFlight = discoveryInFlight ??= performDiscovery(options.pollMs ?? 0);
  try {
    const result = await inFlight;
    cachedDiscovery = { value: result, cachedAt: Date.now() };
    return cloneDiscovery(result);
  } finally {
    if (discoveryInFlight === inFlight) discoveryInFlight = undefined;
  }
}

async function performDiscovery(pollMs: number): Promise<LocalIntegrationDiscovery> {
  let configExecs: Record<string, string | undefined> = {};
  try {
    const config = loadConfig();
    configExecs = config.executables;
  } catch {}

  const blenderMcpPort = Number(process.env.AUVRYNT_BLENDER_MCP_PORT ?? 9876);
  const boundedPollMs = Math.max(0, pollMs);
  const pollPort = async (port: number): Promise<boolean> => {
    const deadline = Date.now() + boundedPollMs;
    do {
      if (await probePort("127.0.0.1", port)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    } while (Date.now() <= deadline);
    return false;
  };

  const configuredAseprite = configExecs.aseprite || findAsepriteInSource(configExecs.asepriteSource);
  const [processes, cloudflaredSys, serenaSys, godotSys, blenderSys, asepriteSys, blenderLabMcp, auvryntBlenderBridge, auvryntGodotBridge] = await Promise.all([
    runningProcessNames(),
    configExecs.cloudflared ? undefined : findExecutable("cloudflared"),
    configExecs.serena ? undefined : findExecutable("serena"),
    configExecs.godot || configExecs.godotCsharp ? undefined : findExecutable("godot"),
    configExecs.blender ? undefined : findExecutable("blender"),
    configuredAseprite ? undefined : findExecutable("aseprite"),
    pollPort(blenderMcpPort),
    pollPort(49323),
    pollPort(49322),
  ]);

  const cloudflared = configExecs.cloudflared || cloudflaredSys;
  const serena = configExecs.serena || serenaSys;
  const godot = configExecs.godot || godotSys;
  const godotCsharp = configExecs.godotCsharp;
  const blender = configExecs.blender || blenderSys;
  const aseprite = configuredAseprite || asepriteSys;

  return {
    processes,
    executables: {
      cloudflared,
      serena,
      godot,
      godotCsharp,
      blender,
      aseprite,
      asepriteSource: configExecs.asepriteSource,
    },
    ports: {
      blender_lab_mcp: blenderLabMcp,
      auvrynt_blender_bridge: auvryntBlenderBridge,
      auvrynt_godot_bridge: auvryntGodotBridge,
    },
  };
}

function cloneDiscovery(discovery: LocalIntegrationDiscovery): LocalIntegrationDiscovery {
  return {
    processes: [...discovery.processes],
    executables: { ...discovery.executables },
    ports: { ...discovery.ports },
  };
}

export function clearIntegrationDiscoveryCache(): void {
  cachedDiscovery = undefined;
}

export function processDetected(discovery: LocalIntegrationDiscovery, integration: keyof typeof PROCESS_MARKERS): boolean {
  return hasProcess(discovery.processes, PROCESS_MARKERS[integration]);
}
