import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { auvryntConfigDir } from "../../infrastructure/user-config.js";
import { discoverLocalIntegrations, processDetected } from "../integration-discovery.js";
import { ensureOpenPencilDesktopLauncher } from "./open-pencil-desktop-launcher.js";
import { probeOpenPencilBridge } from "./open-pencil-health.js";

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = "@open-pencil/mcp";
interface OpenPencilSession {
  client?: Client;
  transport?: StdioClientTransport;
  connection?: Promise<Client>;
}
const sessions = new Map<string, OpenPencilSession>();
let installation: Promise<string> | undefined;

export function openPencilInstallDirectory(): string {
  return join(auvryntConfigDir(), "integrations", "open-pencil");
}

/** Use the official package's actual bin target, not an assumed dist path. */
export function resolveOpenPencilMcpEntry(installDir = openPencilInstallDirectory()): string | undefined {
  const packageDir = join(installDir, "node_modules", "@open-pencil", "mcp");
  const manifest = join(packageDir, "package.json");
  if (!existsSync(manifest)) return undefined;
  try {
    const data = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; bin?: string | Record<string, string> };
    if (data.name !== PACKAGE_NAME) return undefined;
    const entry = typeof data.bin === "string" ? data.bin : data.bin?.["openpencil-mcp"];
    if (!entry || isAbsolute(entry)) return undefined;
    const path = resolve(packageDir, entry);
    if (relative(packageDir, path).startsWith("..") || !existsSync(path)) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

/** Only call after the integration is enabled and the desktop app is detected. */
export async function ensureOpenPencilMcpInstalled(): Promise<string> {
  const existing = resolveOpenPencilMcpEntry();
  if (existing) return existing;
  if (installation) return installation;
  installation = (async () => {
    const root = openPencilInstallDirectory();
    mkdirSync(root, { recursive: true });
    const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const args = ["install", "--prefix", root, "--no-save", "--no-audit", "--no-fund", PACKAGE_NAME];
    if (existsSync(npmCli)) {
      await execFileAsync(process.execPath, [npmCli, ...args], { timeout: 180_000, windowsHide: true });
    } else if (process.platform !== "win32") {
      await execFileAsync("npm", args, { timeout: 180_000 });
    } else {
      throw new Error("npm was not found beside Node.js. Install Node.js with npm to enable OpenPencil MCP.");
    }
    const entry = resolveOpenPencilMcpEntry(root);
    if (!entry) throw new Error("Official @open-pencil/mcp installed but did not provide the openpencil-mcp executable.");
    return entry;
  })();
  try {
    return await installation;
  } finally {
    installation = undefined;
  }
}

export async function openPencilStatus(): Promise<{
  running: boolean; executable?: string; mcpInstalled: boolean; connected: boolean; detail: string;
}> {
  const discovered = await discoverLocalIntegrations({ forceRefresh: true });
  const running = processDetected(discovered, "openPencil");
  const executable = discovered.executables.openPencil;
  const mcpInstalled = Boolean(resolveOpenPencilMcpEntry());
  const bridge = running && mcpInstalled ? await probeOpenPencilBridge() : undefined;
  const documents = bridge?.state === "connected" ? await verifyOpenPencilDocuments(process.cwd()) : undefined;
  return {
    running, executable, mcpInstalled, connected: documents?.connected === true,
    detail: !running && !executable
      ? "OpenPencil desktop app not detected. Install or open it, then retry."
      : !mcpInstalled
        ? "OpenPencil detected; official MCP package will be installed when this integration is enabled."
        : !running
          ? "OpenPencil is installed but not running."
          : bridge?.state === "connected"
            ? documents?.detail ?? "OpenPencil editor is attached but the active document is not verified."
            : bridge?.detail ?? "OpenPencil editor MCP connection has not been verified.",
  };
}

async function getOpenPencilClient(workspaceRoot: string): Promise<Client> {
  const root = resolve(workspaceRoot);
  let session = sessions.get(root);
  if (!session) {
    session = {};
    sessions.set(root, session);
  }
  if (session.client) return session.client;
  if (session.connection) return session.connection;
  const active = session;
  active.connection = (async () => {
    const discovered = await discoverLocalIntegrations({ forceRefresh: true });
    if (!processDetected(discovered, "openPencil")) {
      throw new Error("OpenPencil is not running. Open its desktop app and a document, then retry.");
    }
    const entry = await ensureOpenPencilMcpInstalled();
    // Also heal an integration enabled while the desktop editor was already open.
    ensureOpenPencilDesktopLauncher(openPencilInstallDirectory());
    const next = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      cwd: root,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === "string")),
        OPENPENCIL_MCP_ROOT: root,
      },
      stderr: "pipe",
    });
    const nextClient = new Client({ name: "auvrynt-open-pencil", version: "1.0.0" }, { capabilities: {} });
    next.onclose = () => {
      if (active.transport !== next) return;
      active.transport = undefined;
      active.client = undefined;
      active.connection = undefined;
      sessions.delete(root);
    };
    try {
      await nextClient.connect(next);
      active.transport = next;
      active.client = nextClient;
      return nextClient;
    } catch (error) {
      await next.close().catch(() => undefined);
      throw error;
    }
  })();
  try {
    return await active.connection;
  } catch (error) {
    active.connection = undefined;
    active.client = undefined;
    active.transport = undefined;
    sessions.delete(root);
    throw error;
  }
}

export async function listOpenPencilTools(
  workspaceRoot: string, options: { query?: string; offset?: number; limit?: number } = {},
): Promise<unknown> {
  const current = await getOpenPencilClient(workspaceRoot);
  const allTools = (await current.listTools()).tools;
  const query = options.query?.trim().toLowerCase();
  const matches = query
    ? allTools.filter((tool) => tool.name.toLowerCase().includes(query)
      || tool.description?.toLowerCase().includes(query))
    : allTools;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  return {
    total: allTools.length, matched: matches.length, offset, limit,
    hasMore: offset + limit < matches.length,
    tools: matches.slice(offset, offset + limit),
  };
}

export async function callOpenPencilTool(
  workspaceRoot: string, name: string, args: Record<string, unknown>,
): Promise<unknown> {
  const current = await getOpenPencilClient(workspaceRoot);
  const tools = await current.listTools();
  if (!tools.tools.some((tool) => tool.name === name)) {
    throw new Error(`OpenPencil MCP tool "${name}" is unavailable; call openpencil_list_tools for current names and schemas.`);
  }
  return current.callTool({ name, arguments: args });
}

export async function verifyOpenPencilDocuments(workspaceRoot: string): Promise<{ connected: boolean; detail: string; count: number }> {
  try {
    const result = await callOpenPencilTool(workspaceRoot, "list_documents", {}) as {
      isError?: boolean; content?: Array<{ type: string; text?: string }>;
    };
    if (result.isError) return { connected: false, detail: "The editor rejected its document inventory request.", count: 0 };
    const raw = result.content?.find((item) => item.type === "text")?.text;
    if (!raw) return { connected: false, detail: "The editor returned no document inventory.", count: 0 };
    const parsed = JSON.parse(raw) as { documents?: unknown };
    if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) {
      return { connected: false, detail: "OpenPencil is attached but has no open documents.", count: 0 };
    }
    return { connected: true, detail: "OpenPencil editor connected with " + parsed.documents.length + " open document(s).", count: parsed.documents.length };
  } catch (error) {
    return { connected: false, detail: "OpenPencil document request failed: " + (error instanceof Error ? error.message : String(error)), count: 0 };
  }
}

export async function disconnectOpenPencil(): Promise<void> {
  const transports = [...sessions.values()].map((session) => session.transport).filter((value): value is StdioClientTransport => Boolean(value));
  sessions.clear();
  await Promise.all(transports.map((entry) => entry.close().catch(() => undefined)));
}
