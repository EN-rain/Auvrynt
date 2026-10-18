import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { satisfies } from "semver";
import { loadConfig } from "../../config.js";
import { INTEGRATION_KEYS, INTEGRATION_LABELS, type IntegrationKey } from "../../background-lifecycle.js";
import { discoverLocalIntegrations, processDetected } from "../../integration-discovery.js";
import { getGlobalGodotPluginStatus } from "../../godot-tools.js";
import { getPlaywrightRuntimeStatus } from "../../playwright-runtime.js";
import { readManagedTunnel } from "../../tunnels/tunnel-manager.js";
import { loadAuvryntFiles } from "../../user-config.js";
import {
  dashboardUrl,
  httpUrl,
  localProbeHost,
  printConsolePanel,
  RUNNING_COMMAND_HINTS,
  type ConsoleRow,
} from "../runtime-support.js";
import type { ActiveInstance } from "./tunnel-command.js";

const require = createRequire(import.meta.url);
const SUPPORTED_NODE_RANGE = ">=20.12 <27";

export interface StatusCommandDependencies {
  readActiveInstance(): Promise<ActiveInstance | undefined>;
}

export async function runDoctorCommand(): Promise<void> {
  const files = loadAuvryntFiles();
  const rows: ConsoleRow[] = [
    { label: "Config dir", value: files.dir },
    { label: "Config", value: files.configExists ? files.configPath : "Missing" },
    { label: "Auth", value: files.authExists ? files.authPath : "Missing" },
    { label: "Node", value: `${process.version} (${nodeVersionStatus()}), ABI ${process.versions.modules}` },
    { label: "Platform", value: `${process.platform} ${process.arch}` },
    { label: "Git", value: checkGitAvailable() },
    { label: "Bash", value: checkBashShell() },
    { label: "SQLite", value: checkSqliteNative() },
  ];
  try {
    const config = loadConfig();
    rows.push(
      { label: "Local MCP", value: httpUrl(config.host, config.port, "/mcp") },
      { label: "Public MCP", value: new URL("/mcp", config.publicBaseUrl).toString() },
      { label: "Roots", value: config.allowedRoots.join(", ") },
      { label: "Hosts", value: config.allowedHosts.join(", ") },
    );
  } catch (error) {
    rows.push({ label: "Config status", value: error instanceof Error ? error.message : String(error) });
  }
  printConsolePanel("Auvrynt doctor", rows);
}

export async function runStatusCommand(dependencies: StatusCommandDependencies): Promise<void> {
  const files = loadAuvryntFiles();
  const config = loadConfig();
  const host = files.config.host ?? "127.0.0.1";
  const port = files.config.port ?? 49321;
  const healthUrl = httpUrl(localProbeHost(host), port, "/healthz");
  const active = await dependencies.readActiveInstance();
  const tunnel = await readManagedTunnel({
    stateDir: config.stateDir,
    port,
    provider: config.tunnelProvider,
    ngrokAuthtoken: config.ngrokAuthtoken,
    ngrokUrl: config.ngrokUrl,
  });
  const rows: ConsoleRow[] = [];
  let localConnected = false;

  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; name?: string };
    localConnected = response.ok && body.ok === true && body.name === "auvrynt";
    rows.push({ label: "Local MCP", value: localConnected ? "Connected" : "Error" });
  } catch (error) {
    rows.push({ label: "Local MCP", value: "Disconnected" });
    rows.push({ label: "Detail", value: error instanceof Error ? error.message : String(error) });
  }
  rows.push({ label: "Health", value: healthUrl });
  rows.push({ label: "Dashboard", value: dashboardUrl(host, port) });
  if (active) {
    rows.push({ label: "Process", value: `PID ${active.record.pid}` });
    rows.push({ label: "Workspace", value: active.record.launchRoot ?? "unknown" });
  } else {
    rows.push({ label: "Process", value: localConnected
      ? "Responding (managed process identity unavailable)"
      : "Not running" });
  }
  rows.push({
    label: "Public MCP",
    value: config.tunnelProvider === "custom"
      ? new URL("/mcp", config.publicBaseUrl).toString()
      : tunnel
        ? `${tunnel.url}/mcp`
        : "Not running",
  });

  const local = await discoverLocalIntegrations({ pollMs: 1500 });
  const profileSet = new Set<IntegrationKey>(
    active?.record.profiles ?? INTEGRATION_KEYS.filter((key) => config.integrations[key]),
  );
  rows.push({
    label: "Integrations",
    value: profileSet.size > 0 ? [...profileSet].map((key) => INTEGRATION_LABELS[key]).join(", ") : "None",
  });

  if (profileSet.has("blender")) {
    const blenderConnected = local.ports.blender_lab_mcp;
    const blenderDetail = local.ports.blender_lab_mcp
      ? "Blender MCP connected on 9876"
      : processDetected(local, "blender")
        ? "Blender is running; waiting for Blender Lab MCP on 9876"
        : "Blender is not detected";
    rows.push({ label: "Blender", value: `${blenderConnected ? "Connected" : "Offline"} - ${blenderDetail}` });
  }
  if (profileSet.has("godotGdscript") || profileSet.has("godotCsharp")) {
    const godotPlugin = getGlobalGodotPluginStatus();
    const godotConfigured = Boolean(local.executables.godot || local.executables.godotCsharp || godotPlugin.installed);
    const godotStatusText = local.ports.auvrynt_godot_bridge
      ? "connected"
      : processDetected(local, "godot")
        ? "running, bridge unavailable"
        : godotConfigured
          ? "installed, not running"
          : "not detected";
    rows.push({ label: "Godot", value: godotStatusText });
  }
  if (profileSet.has("serena")) {
    rows.push({
      label: "Software",
      value: processDetected(local, "serena") ? "Ready" : local.executables.serena ? "Installed, not running" : "Not detected",
    });
  }
  if (profileSet.has("playwright")) {
    const playwright = getPlaywrightRuntimeStatus();
    rows.push({
      label: "Web",
      value: playwright.chromiumInstalled ? "Ready" : playwright.packageInstalled ? "Installed, browser unavailable" : "Not installed",
    });
  }
  printConsolePanel(
    "Auvrynt status",
    rows,
    active ? RUNNING_COMMAND_HINTS : localConnected
      ? "Server is reachable, but Auvrynt cannot confirm it owns the process. Avoid starting a duplicate."
      : "Start: auvrynt start",
  );
}

export function assertSupportedNode(): void {
  if (satisfies(process.versions.node, SUPPORTED_NODE_RANGE)) return;
  throw new Error(
    `Auvrynt supports Node ${SUPPORTED_NODE_RANGE}. Current runtime: ${process.version}. `
    + "Use Node 20 LTS, Node 22 LTS, Node 24 LTS, or Node 26.",
  );
}

function nodeVersionStatus(): string {
  return satisfies(process.versions.node, SUPPORTED_NODE_RANGE)
    ? `supported (${SUPPORTED_NODE_RANGE})`
    : `unsupported; expected ${SUPPORTED_NODE_RANGE}`;
}

export function checkSqliteNative(): string {
  try {
    const Database = require("better-sqlite3") as {
      new (filename: string): {
        prepare(sql: string): { get(): unknown };
        close(): void;
      };
    };
    const database = new Database(":memory:");
    try {
      database.prepare("SELECT 1 AS ok").get();
      return "ok";
    } finally {
      database.close();
    }
  } catch (error) {
    return `Unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function checkGitAvailable(): string {
  try {
    return execFileSync("git", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (error) {
    return `Unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function checkBashShell(): string {
  try {
    const shell = getShellConfig();
    return `${shell.shell} ${shell.args.join(" ")}`;
  } catch (error) {
    return `Unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}
