import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type OpenPencilBridgeHealth =
  | { state: "connected"; version?: string }
  | { state: "no_app" | "not_running" | "unreachable" | "invalid_discovery"; detail: string };

/** The stdio tool inventory does not demonstrate an attached editor.
 * Read the official desktop discovery record and query its actual /health.
 * Never expose its bearer token or copy a discovery token into logs.
 */
export async function probeOpenPencilBridge(
  discoveryPath = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "OpenPencil", "mcp.json"),
): Promise<OpenPencilBridgeHealth> {
  let info: unknown;
  try {
    info = JSON.parse(await readFile(discoveryPath, "utf8"));
  } catch {
    return { state: "not_running", detail: "OpenPencil has not started its native HTTP MCP server." };
  }
  if (!info || typeof info !== "object") {
    return { state: "invalid_discovery", detail: "OpenPencil MCP discovery metadata is invalid." };
  }
  const record = info as Record<string, unknown>;
  const port = record.httpPort;
  if (!Number.isInteger(port) || typeof port !== "number" || port < 1 || port > 65535) {
    return { state: "invalid_discovery", detail: "OpenPencil MCP discovery has no valid HTTP port." };
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) {
      return { state: "unreachable", detail: `OpenPencil MCP returned HTTP ${response.status}.` };
    }
    const health: unknown = await response.json();
    if (!health || typeof health !== "object") {
      return { state: "invalid_discovery", detail: "OpenPencil MCP returned invalid health data." };
    }
    const value = health as Record<string, unknown>;
    if (value.status === "ok") {
      return { state: "connected", ...(typeof value.version === "string" ? { version: value.version } : {}) };
    }
    if (value.status === "no_app") {
      return {
        state: "no_app",
        detail: "The native MCP server is running but the OpenPencil editor has not attached to it.",
      };
    }
    return { state: "unreachable", detail: "OpenPencil MCP is not ready." };
  } catch {
    return { state: "unreachable", detail: "The discovered OpenPencil MCP endpoint is unreachable." };
  }
}
