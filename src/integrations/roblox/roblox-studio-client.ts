import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface RobloxStudioLaunchSpec {
  command: string;
  args: string[];
  pathExists: boolean;
  platform: NodeJS.Platform;
  hint: string;
}

export interface RobloxRemoteTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

let client: Client | undefined;
let transport: StdioClientTransport | undefined;
let connectPromise: Promise<Client> | undefined;
let cachedTools: RobloxRemoteTool[] | undefined;

export function resolveRobloxStudioMcpLaunch(): RobloxStudioLaunchSpec {
  if (process.platform === "win32") {
    const bat = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Roblox", "mcp.bat");
    return {
      command: "cmd.exe",
      args: ["/c", bat],
      pathExists: existsSync(bat),
      platform: process.platform,
      hint: bat,
    };
  }

  if (process.platform === "darwin") {
    const bin = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP";
    return {
      command: bin,
      args: [],
      pathExists: existsSync(bin),
      platform: process.platform,
      hint: bin,
    };
  }

  // Linux / other: Studio MCP is not officially documented; surface a clear status.
  const bat = join(homedir(), ".local", "share", "Roblox", "mcp.bat");
  return {
    command: bat,
    args: [],
    pathExists: existsSync(bat),
    platform: process.platform,
    hint: "Official Roblox Studio MCP is documented for Windows and macOS only.",
  };
}

export async function getRobloxStudioClient(): Promise<Client> {
  if (client) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const launch = resolveRobloxStudioMcpLaunch();
    if (!launch.pathExists) {
      throw new Error(
        `Roblox Studio MCP launcher not found at ${launch.hint}. Install the latest Roblox Studio, enable Assistant → Manage MCP Servers → Enable Studio as MCP server, then retry.`,
      );
    }

    const nextTransport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      stderr: "pipe",
    });
    const nextClient = new Client(
      { name: "auvrynt-roblox-proxy", version: "1.0.0" },
      { capabilities: {} },
    );

    nextTransport.onclose = () => {
      client = undefined;
      transport = undefined;
      cachedTools = undefined;
      connectPromise = undefined;
    };

    await nextClient.connect(nextTransport);
    client = nextClient;
    transport = nextTransport;
    return nextClient;
  })();

  try {
    return await connectPromise;
  } catch (error) {
    connectPromise = undefined;
    client = undefined;
    transport = undefined;
    throw error;
  }
}

export async function disconnectRobloxStudioClient(): Promise<void> {
  const current = transport;
  client = undefined;
  transport = undefined;
  cachedTools = undefined;
  connectPromise = undefined;
  if (current) {
    try {
      await current.close();
    } catch {
      // ignore close errors
    }
  }
}

export async function listRobloxStudioTools(forceRefresh = false): Promise<RobloxRemoteTool[]> {
  if (cachedTools && !forceRefresh) return cachedTools;
  const c = await getRobloxStudioClient();
  const result = await c.listTools();
  cachedTools = (result.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  return cachedTools;
}

export async function callRobloxStudioTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const c = await getRobloxStudioClient();
  const result = await c.callTool({ name, arguments: args });
  return result;
}

export function robloxStudioClientConnected(): boolean {
  return Boolean(client);
}
