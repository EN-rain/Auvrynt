import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ConnectedClient {
  provider: string;
  userAgent?: string;
  lastSeen: string;
  requestCount: number;
}

const REGISTRY_FILE = "connections.json";
const MAX_CLIENTS = 32;
const MAX_PROVIDER_CHARS = 80;
const MAX_USER_AGENT_CHARS = 160;
const MAX_REQUEST_COUNT = Number.MAX_SAFE_INTEGER;

export function connectionRegistryPath(stateDir: string): string {
  return join(stateDir, REGISTRY_FILE);
}

export function identifyProvider(clientName?: string, userAgent?: string): string {
  const value = `${clientName ?? ""} ${userAgent ?? ""}`.trim();
  const normalized = value.toLowerCase();
  const knownProviders: Array<[string, string]> = [
    ["grok", "Grok"],
    ["xai", "Grok / xAI"],
    ["chatgpt", "ChatGPT"],
    ["openai", "OpenAI"],
    ["claude", "Claude"],
    ["anthropic", "Claude / Anthropic"],
    ["kimi", "Kimi"],
    ["cursor", "Cursor"],
    ["windsurf", "Windsurf"],
    ["gemini", "Gemini"],
    ["google", "Gemini"],
    ["googleusercontent", "Gemini"],
    ["vscode", "VS Code"],
    ["visual studio code", "VS Code"],
    ["codex", "Codex"],
  ];

  for (const [marker, provider] of knownProviders) {
    if (normalized.includes(marker)) return provider;
  }

  if (clientName?.trim()) return sanitizeSingleLine(clientName, MAX_PROVIDER_CHARS) || "Unknown MCP client";
  if (userAgent?.trim()) {
    return sanitizeSingleLine(userAgent, MAX_USER_AGENT_CHARS).split(/[\s/]/, 1)[0].slice(0, MAX_PROVIDER_CHARS) || "Unknown MCP client";
  }
  return "Unknown MCP client";
}

function sanitizeSingleLine(value: string, maxChars: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxChars);
}

function sanitizeUserAgent(userAgent?: string): string | undefined {
  if (!userAgent) return undefined;
  return sanitizeSingleLine(userAgent, MAX_USER_AGENT_CHARS) || undefined;
}

function parseConnectedClient(entry: unknown): ConnectedClient | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as Record<string, unknown>;
  if (typeof candidate.provider !== "string" || typeof candidate.lastSeen !== "string") return undefined;
  if (typeof candidate.requestCount !== "number" || !Number.isSafeInteger(candidate.requestCount) || candidate.requestCount < 0) return undefined;
  const parsedDate = Date.parse(candidate.lastSeen);
  if (!Number.isFinite(parsedDate)) return undefined;

  const provider = sanitizeSingleLine(candidate.provider, MAX_PROVIDER_CHARS);
  if (!provider) return undefined;
  return {
    provider,
    userAgent: typeof candidate.userAgent === "string" ? sanitizeUserAgent(candidate.userAgent) : undefined,
    lastSeen: new Date(parsedDate).toISOString(),
    requestCount: Math.min(candidate.requestCount, MAX_REQUEST_COUNT),
  };
}

export function readConnectedClients(stateDir: string): ConnectedClient[] {
  const path = connectionRegistryPath(stateDir);
  if (!existsSync(path)) return [];

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseConnectedClient)
      .filter((entry): entry is ConnectedClient => Boolean(entry))
      .sort((left, right) => right.lastSeen.localeCompare(left.lastSeen))
      .slice(0, MAX_CLIENTS);
  } catch {
    return [];
  }
}

export function recordConnectedClient(
  stateDir: string,
  input: { clientName?: string; userAgent?: string },
): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(stateDir, 0o700);
  } catch {
    // Best effort on platforms/filesystems without POSIX modes.
  }

  const provider = identifyProvider(input.clientName, input.userAgent);
  const clients = readConnectedClients(stateDir);
  const existing = clients.find((client) => client.provider === provider);
  const now = new Date().toISOString();

  if (existing) {
    existing.lastSeen = now;
    existing.requestCount = Math.min(existing.requestCount + 1, MAX_REQUEST_COUNT);
    existing.userAgent = sanitizeUserAgent(input.userAgent) ?? existing.userAgent;
  } else {
    clients.push({
      provider,
      userAgent: sanitizeUserAgent(input.userAgent),
      lastSeen: now,
      requestCount: 1,
    });
  }

  clients.sort((left, right) => right.lastSeen.localeCompare(left.lastSeen));
  writeRegistryAtomically(connectionRegistryPath(stateDir), clients.slice(0, MAX_CLIENTS));
}

function writeRegistryAtomically(path: string, clients: ConnectedClient[]): void {
  const directory = dirname(path);
  const tempPath = join(directory, `.connections.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tempPath, JSON.stringify(clients, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    try {
      chmodSync(tempPath, 0o600);
    } catch {
      // Best effort on platforms/filesystems without POSIX modes.
    }
    renameSync(tempPath, path);
    try {
      chmodSync(path, 0o600);
    } catch {
      // Best effort on platforms/filesystems without POSIX modes.
    }
  } finally {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Cleanup failure must not hide the write failure.
      }
    }
  }
}
