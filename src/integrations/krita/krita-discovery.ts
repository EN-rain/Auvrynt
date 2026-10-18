import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MAX_DISCOVERY_BYTES = 16 * 1024;

export interface KritaBridgeDiscovery {
  url: string;
  token: string;
  source: "environment" | "discovery-file";
  statePath?: string;
}

interface DiscoveryFileShape {
  url?: unknown;
  port?: unknown;
  token?: unknown;
  host?: unknown;
}

export async function discoverKritaBridge(env: NodeJS.ProcessEnv = process.env): Promise<KritaBridgeDiscovery> {
  const direct = directDiscovery(env);
  if (direct) return direct;

  for (const statePath of discoveryCandidates(env)) {
    const discovered = await readDiscoveryFile(statePath);
    if (discovered) return discovered;
  }

  throw new Error(
    "Krita bridge discovery failed. Start Krita with the Auvrynt/Krita bridge enabled, or set AUVRYNT_KRITA_URL and AUVRYNT_KRITA_TOKEN.",
  );
}

function directDiscovery(env: NodeJS.ProcessEnv): KritaBridgeDiscovery | undefined {
  const directUrl = env.AUVRYNT_KRITA_URL?.trim();
  const directToken = env.AUVRYNT_KRITA_TOKEN?.trim();
  if (directUrl || directToken) {
    if (!directUrl || !directToken) {
      throw new Error("AUVRYNT_KRITA_URL and AUVRYNT_KRITA_TOKEN must be set together.");
    }
    return {
      url: normalizeLoopbackUrl(directUrl),
      token: validateToken(directToken),
      source: "environment",
    };
  }

  const donorPort = env.KRITA_MCP_PORT?.trim();
  const donorToken = env.KRITA_MCP_TOKEN?.trim();
  if (donorPort || donorToken) {
    if (!donorPort || !donorToken) throw new Error("KRITA_MCP_PORT and KRITA_MCP_TOKEN must be set together.");
    const port = parsePort(donorPort);
    return {
      url: `http://127.0.0.1:${port}`,
      token: validateToken(donorToken),
      source: "environment",
    };
  }

  return undefined;
}

function discoveryCandidates(env: NodeJS.ProcessEnv): string[] {
  const explicitDirs = [
    env.AUVRYNT_KRITA_STATE_DIR,
    env.KRITA_MCP_STATE_DIR,
  ].filter((value): value is string => Boolean(value?.trim())).map((value) => resolve(value));

  const platformDirs: string[] = [];
  if (process.platform === "win32") {
    if (env.LOCALAPPDATA) platformDirs.push(resolve(env.LOCALAPPDATA, "Auvrynt"));
    if (env.APPDATA) {
      platformDirs.push(resolve(env.APPDATA, "krita"));
      platformDirs.push(resolve(env.APPDATA, "Auvrynt"));
    }
  } else if (process.platform === "darwin") {
    platformDirs.push(resolve(homedir(), "Library", "Application Support", "Auvrynt"));
    platformDirs.push(resolve(homedir(), "Library", "Application Support", "krita"));
  } else {
    const xdgState = env.XDG_STATE_HOME ? resolve(env.XDG_STATE_HOME) : resolve(homedir(), ".local", "state");
    const xdgData = env.XDG_DATA_HOME ? resolve(env.XDG_DATA_HOME) : resolve(homedir(), ".local", "share");
    platformDirs.push(join(xdgState, "auvrynt"));
    platformDirs.push(join(xdgData, "krita"));
  }

  const filenames = [
    "auvrynt-krita-bridge.json",
    "krita-mcp-bridge.json",
    "krita_mcp_bridge.json",
    "krita-mcp.json",
    "krita_mcp.json",
  ];

  const candidates = new Set<string>();
  for (const directory of [...explicitDirs, ...platformDirs]) {
    for (const filename of filenames) candidates.add(resolve(directory, filename));
  }
  return [...candidates];
}

async function readDiscoveryFile(statePath: string): Promise<KritaBridgeDiscovery | undefined> {
  try {
    const fileStat = await stat(statePath);
    if (!fileStat.isFile() || fileStat.size < 2 || fileStat.size > MAX_DISCOVERY_BYTES) return undefined;
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as DiscoveryFileShape;
    const token = validateToken(parsed.token);
    let url: string;
    if (typeof parsed.url === "string" && parsed.url.trim()) {
      url = normalizeLoopbackUrl(parsed.url);
    } else {
      const host = typeof parsed.host === "string" && parsed.host.trim() ? parsed.host.trim() : "127.0.0.1";
      const port = parsePort(parsed.port);
      url = normalizeLoopbackUrl(`http://${host}:${port}`);
    }
    return { url, token, source: "discovery-file", statePath };
  } catch {
    return undefined;
  }
}

function normalizeLoopbackUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Krita bridge URL is invalid.");
  }
  if (url.protocol !== "http:") throw new Error("Krita bridge URL must use loopback HTTP.");
  const host = url.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error("Krita bridge URL must resolve to the local loopback host.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Krita bridge URL must not contain credentials, query parameters, or fragments.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function validateToken(value: unknown): string {
  if (typeof value !== "string") throw new Error("Krita bridge discovery token is missing.");
  const token = value.trim();
  if (token.length < 16 || token.length > 512 || /[\r\n\0]/.test(token)) {
    throw new Error("Krita bridge discovery token is invalid.");
  }
  return token;
}

function parsePort(value: unknown): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("Krita bridge port must be an integer from 1024 to 65535.");
  }
  return port;
}
