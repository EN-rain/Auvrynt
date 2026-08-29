import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadAuvryntFiles } from "../user-config.js";

const SERVICE_NAME = "cloudflared";
const POLL_INTERVAL_MS = 250;
const START_TIMEOUT_MS = 30_000;

function queryService(): string {
  return execFileSync("sc.exe", ["query", SERVICE_NAME], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function serviceState(): "RUNNING" | "STOPPED" | "MISSING" | "OTHER" {
  if (process.platform !== "win32") return "MISSING";
  try {
    const output = queryService();
    if (/STATE\s+:\s+\d+\s+RUNNING/i.test(output)) return "RUNNING";
    if (/STATE\s+:\s+\d+\s+STOPPED/i.test(output)) return "STOPPED";
    return "OTHER";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/1060|does not exist|not found/i.test(message)) return "MISSING";
    return "OTHER";
  }
}

export function isCloudflaredProcessRunning(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const output = execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq cloudflared.exe", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return /cloudflared\.exe/i.test(output);
  } catch {
    return false;
  }
}

export function findCloudflaredExecutable(): string | null {
  if (process.platform !== "win32") return null;
  const commonPaths = [
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
    join(homedir(), "bin", "cloudflared.exe"),
    join(homedir(), "AppData", "Local", "Programs", "cloudflared", "cloudflared.exe"),
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }
  try {
    const output = execFileSync("where.exe", ["cloudflared.exe"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const first = output.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return first;
  } catch {
    // not in PATH
  }
  return null;
}

export function spawnUserCloudflaredProcess(token: string): boolean {
  const binary = findCloudflaredExecutable();
  if (!binary) return false;
  try {
    const child = spawn(binary, ["tunnel", "run", "--token", token], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function waitForState(expected: "RUNNING" | "STOPPED"): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = serviceState();
    if (current === expected) return;
    if (current === "MISSING") throw new Error(`Windows service ${SERVICE_NAME} is not installed.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Windows service ${SERVICE_NAME} did not become ${expected.toLowerCase()} within 30 seconds.`);
}

export async function startCloudflaredService(): Promise<boolean> {
  if (process.platform !== "win32") return false;

  // 1. Check if the Windows Service is already running
  const current = serviceState();
  if (current === "RUNNING") return false;

  // 2. Check if cloudflared is already running as a process (self-healed / user started)
  if (isCloudflaredProcessRunning()) return false;

  // 3. Try to start the Windows Service via sc.exe
  let scFailed = false;
  if (current !== "MISSING") {
    try {
      execFileSync("sc.exe", ["start", SERVICE_NAME], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      await waitForState("RUNNING");
      return true;
    } catch {
      scFailed = true;
    }
  } else {
    scFailed = true;
  }

  // 4. Self-healing fallback: If sc.exe failed (e.g. non-admin), try spawning user-space cloudflared with saved token
  if (scFailed) {
    if (isCloudflaredProcessRunning()) return false;

    const files = loadAuvryntFiles();
    const token = files.auth.cloudflareTunnelToken || process.env.CLOUDFLARE_TUNNEL_TOKEN;

    if (token) {
      const spawned = spawnUserCloudflaredProcess(token);
      if (spawned) {
        const deadline = Date.now() + 4_000;
        while (Date.now() < deadline) {
          if (isCloudflaredProcessRunning()) return true;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return true;
      }
    }

    // If external tunnel is managed elsewhere or no token is provided, proceed gracefully
    return false;
  }

  return false;
}

export async function stopCloudflaredService(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const current = serviceState();
  if (current === "MISSING" || current === "STOPPED") return false;

  try {
    execFileSync("sc.exe", ["stop", SERVICE_NAME], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/1062|not been started|already stopped/i.test(message)) throw new Error(`Could not stop Windows service ${SERVICE_NAME}: ${message}`);
  }
  await waitForState("STOPPED");
  return true;
}
