import type { ServerConfig } from "../config.js";
import {
  summarizeNgrokAuthtokens,
  type NgrokAuthtokenPoolSummary,
} from "../infrastructure/ngrok-auth-pool.js";
import { readConnectedClients } from "../connection-registry.js";
import { discoverLocalIntegrations, processDetected } from "../integration-discovery.js";
import type { RecentLogEntry } from "../infrastructure/logger.js";
import { recentLogEntries } from "../infrastructure/logger.js";
import { getPlaywrightRuntimeStatus } from "../playwright-runtime.js";
import { getAsepriteBridgeRuntimeStatus } from "../integrations/aseprite/aseprite-live-tools.js";
import { probeOpenPencilBridge } from "../integrations/open-pencil/open-pencil-health.js";
import { verifyOpenPencilDocuments } from "../integrations/open-pencil/open-pencil-client.js";
import { integrationToolCounts, registeredToolNamesForIntegration } from "./mcp-tool-registrar.js";
import { toolIntegrationEnabled } from "./mcp-policy.js";
import { groupToolsByName } from "./tool-groups.js";
import { dashboardHtml } from "./dashboard-page.js";
import type { WorkspaceChangeAnalytics } from "./workspace-analytics.js";
import type { McpRequestTimingSnapshot } from "../infrastructure/request-timing.js";
import { formatPathForPrompt, loadWorkspaceSkills } from "../workspace/skills.js";

export { dashboardHtml };

export type DashboardIntegrationKey = keyof ServerConfig["integrations"];
export type DashboardAgentState = "working" | "connected" | "waiting" | "stopping";

export interface DashboardNgrokNotice {
  tone: "warning" | "error";
  title: string;
  message: string;
}

export interface DashboardNgrokState extends NgrokAuthtokenPoolSummary {
  provider: ServerConfig["tunnelProvider"];
  notice?: DashboardNgrokNotice;
}

export interface DashboardArbiterState {
  enabled: boolean;
  configured: boolean;
  endpoint: string;
  model: string;
  timeoutMs: number;
}

export interface DashboardIntegration {
  key: DashboardIntegrationKey;
  label: string;
  enabled: boolean;
  state: "connected" | "available" | "offline" | "disabled";
  detail: string;
  toolCount: number;
  toolEnabledCount: number;
}

export interface DashboardDirectoryRequirement {
  key: "godot" | "blender" | "aseprite" | "serena" | "playwright";
  label: string;
  note: string;
}

export interface DashboardSkillEntry {
  name: string;
  description: string;
  path: string;
  baseDir: string;
  scope: "user" | "project" | "temporary";
  source: string;
  origin: "package" | "top-level";
  disableModelInvocation: boolean;
  agentAccess: string;
}

export interface DashboardSkillsState {
  enabled: boolean;
  agentDir: string;
  skillPaths: string[];
  workspaceRoot?: string;
  skills: DashboardSkillEntry[];
  diagnostics: Array<{ type?: string; message: string; path?: string }>;
}

export interface DashboardView {
  ready: boolean;
  agentState: DashboardAgentState;
  agentLastSeenAt?: string;
  activeToolCalls: number;
  agentProvider?: string;
  pid: number;
  uptimeSeconds: number;
  localMcpUrl: string;
  publicMcpUrl: string;
  publicBaseUrl: string;
  tunnelProvider: ServerConfig["tunnelProvider"];
  allowedRoots: string[];
  directoryRequirements: DashboardDirectoryRequirement[];
  sessions: number;
  maxSessions: number;
  sessionIdleTimeoutMinutes: number;
  widgets: ServerConfig["widgets"];
  mcpRequestTimings: McpRequestTimingSnapshot;
  runningProcesses: number;
  workspaceChanges: WorkspaceChangeAnalytics;
  integrations: DashboardIntegration[];
  skills: DashboardSkillsState;
  ngrok: DashboardNgrokState;
  arbiter: DashboardArbiterState;
  logs: RecentLogEntry[];
}

export interface DashboardRuntimeSnapshot {
  ready: boolean;
  sessions: number;
  activeToolCalls: number;
  lastMcpActivityAt?: number;
  runningProcesses: number;
  workspaceChanges: WorkspaceChangeAnalytics;
  mcpRequestTimings: McpRequestTimingSnapshot;
}

const INTEGRATION_LABELS: Record<DashboardIntegrationKey, string> = {
  godotGdscript: "Godot GDScript",
  godotCsharp: "Godot C#",
  blender: "Blender",
  aseprite: "Aseprite",
  serena: "Serena",
  solOrchestrator: "Sol Orchestrator",
  playwright: "Playwright",
  roblox: "Roblox Studio",
  desktop: "Desktop Use",
  krita: "Krita Drawing",
  openPencil: "OpenPencil Design",
};

const DIRECTORY_REQUIREMENTS: Partial<Record<DashboardIntegrationKey, DashboardDirectoryRequirement>> = {
  godotCsharp: { key: "godot", label: "Godot directory", note: "Used by Godot project tools." },
  godotGdscript: { key: "godot", label: "Godot directory", note: "Used by Godot project tools." },
  blender: { key: "blender", label: "Blender directory", note: "Used by Blender workspace tools." },
  aseprite: { key: "aseprite", label: "Aseprite directory", note: "Used by Aseprite file tools." },
  serena: { key: "serena", label: "Serena directory", note: "Used by Serena as the active project root." },
  playwright: { key: "playwright", label: "Web project directory", note: "Used by web project tools for local files and artifacts." },
};

export function directoryRequirementsForIntegrations(
  integrations: ServerConfig["integrations"],
): DashboardDirectoryRequirement[] {
  const seen = new Set<DashboardDirectoryRequirement["key"]>();
  const requirements: DashboardDirectoryRequirement[] = [];
  for (const key of Object.keys(DIRECTORY_REQUIREMENTS) as DashboardIntegrationKey[]) {
    if (!integrations[key]) continue;
    const requirement = DIRECTORY_REQUIREMENTS[key];
    if (!requirement || seen.has(requirement.key)) continue;
    seen.add(requirement.key);
    requirements.push(requirement);
  }
  return requirements;
}

export async function createDashboardView(
  config: ServerConfig,
  runtime: DashboardRuntimeSnapshot,
): Promise<DashboardView> {
  const discovered = await discoverLocalIntegrations().catch(() => undefined);
  const playwright = getPlaywrightRuntimeStatus();
  const integration = (
    key: DashboardIntegrationKey,
    connected: boolean,
    available: boolean,
    connectedDetail: string,
    availableDetail: string,
    offlineDetail: string,
  ): DashboardIntegration => {
    const counts = integrationToolCounts(config);
    const toolCount = counts[key]?.total ?? 0;
    const toolEnabledCount = counts[key]?.enabled ?? 0;
    const enabled = config.integrations[key];
    if (!enabled) {
      return {
        key,
        label: INTEGRATION_LABELS[key],
        enabled,
        state: "disabled",
        detail: "Not included in the active profile.",
        toolCount,
        toolEnabledCount,
      };
    }
    if (connected) {
      return { key, label: INTEGRATION_LABELS[key], enabled, state: "connected", detail: connectedDetail, toolCount, toolEnabledCount };
    }
    if (available) {
      return { key, label: INTEGRATION_LABELS[key], enabled, state: "available", detail: availableDetail, toolCount, toolEnabledCount };
    }
    return { key, label: INTEGRATION_LABELS[key], enabled, state: "offline", detail: offlineDetail, toolCount, toolEnabledCount };
  };

  const godotConnected = Boolean(discovered?.ports.auvrynt_godot_bridge);
  const godotAvailable = Boolean(
    discovered
    && (processDetected(discovered, "godot")
      || discovered.executables.godot
      || discovered.executables.godotCsharp),
  );
  const blenderConnected = Boolean(
    discovered?.ports.auvrynt_blender_bridge || discovered?.ports.blender_lab_mcp,
  );
  const blenderAvailable = Boolean(
    discovered && (processDetected(discovered, "blender") || discovered.executables.blender),
  );
  const asepriteRunning = Boolean(discovered && processDetected(discovered, "aseprite"));
  const asepriteBridge = asepriteRunning
    ? await getAsepriteBridgeRuntimeStatus()
    : undefined;
  const asepriteConnected = Boolean(asepriteRunning && asepriteBridge?.connected);
  const asepriteAvailable = Boolean(asepriteRunning || discovered?.executables.aseprite);
  const asepriteAvailableDetail = asepriteRunning
    ? asepriteBridge?.installed
      ? "Aseprite is running, but the Auvrynt live bridge is not responding. Restart Aseprite once after bridge installation, and close modal dialogs that can block extension timers."
      : "Aseprite is running, but the Auvrynt live bridge is not installed. Native CLI tools remain available."
    : "Aseprite native CLI is detected and ready on demand; launch Aseprite with the bridge installed for live editor control.";
  const serenaConnected = Boolean(discovered && processDetected(discovered, "serena"));
  const serenaAvailable = Boolean(discovered?.executables.serena || config.serena.executable);
  const desktopAvailable = process.platform === "win32";
  const kritaRunning = Boolean(discovered && processDetected(discovered, "krita"));
  const openPencilRunning = Boolean(discovered && processDetected(discovered, "openPencil"));
  const openPencilHealth = openPencilRunning && config.integrations.openPencil
    ? await probeOpenPencilBridge()
    : undefined;
  const openPencilDocuments = openPencilHealth?.state === "connected"
    ? await verifyOpenPencilDocuments(process.cwd())
    : undefined;
  const openPencilConnected = openPencilDocuments?.connected === true;
  const agentProvider = runtime.sessions > 0
    ? readConnectedClients(config.stateDir)[0]?.provider
    : undefined;
  const logs = recentLogEntries(250).reverse();
  const ngrokSummary = summarizeNgrokAuthtokens();
  const ngrokNotice = createNgrokNotice(config, ngrokSummary, logs);
  const agentState: DashboardAgentState = !runtime.ready
    ? "stopping"
    : runtime.activeToolCalls > 0
      ? "working"
      : runtime.sessions > 0
        ? "connected"
        : "waiting";

  return {
    ready: runtime.ready,
    agentState,
    agentLastSeenAt: runtime.lastMcpActivityAt
      ? new Date(runtime.lastMcpActivityAt).toISOString()
      : undefined,
    activeToolCalls: runtime.activeToolCalls,
    agentProvider,
    pid: process.pid,
    uptimeSeconds: process.uptime(),
    localMcpUrl: localHttpUrl(config.host, config.port, "/mcp"),
    publicMcpUrl: `${config.publicBaseUrl.replace(/\/$/, "")}/mcp`,
    publicBaseUrl: config.publicBaseUrl,
    tunnelProvider: config.tunnelProvider,
    arbiter: {
      enabled: config.arbiter.enabled,
      configured: Boolean(config.arbiter.apiKey),
      endpoint: config.arbiter.endpoint,
      model: config.arbiter.model,
      timeoutMs: config.arbiter.timeoutMs,
    },
    allowedRoots: [...config.allowedRoots],
    directoryRequirements: directoryRequirementsForIntegrations(config.integrations),
    sessions: runtime.sessions,
    maxSessions: config.maxSessions,
    sessionIdleTimeoutMinutes: Math.round(config.sessionIdleTimeoutMs / 60_000),
    widgets: config.widgets,
    mcpRequestTimings: runtime.mcpRequestTimings,
    runningProcesses: runtime.runningProcesses,
    workspaceChanges: runtime.workspaceChanges,
    integrations: [
      integration(
        "godotCsharp",
        godotConnected,
        godotAvailable,
        "Godot bridge is connected.",
        "Godot is available; waiting for the bridge.",
        "Godot or its bridge is not detected.",
      ),
      integration(
        "godotGdscript",
        godotConnected,
        godotAvailable,
        "Godot bridge is connected.",
        "Godot is available; waiting for the bridge.",
        "Godot or its bridge is not detected.",
      ),
      integration(
        "blender",
        blenderConnected,
        blenderAvailable,
        "Blender MCP bridge is connected.",
        "Blender is available; waiting for its bridge.",
        "Blender is not detected.",
      ),
      integration(
        "aseprite",
        asepriteConnected,
        asepriteAvailable,
        `Auvrynt live bridge ${asepriteBridge?.bridgeVersion ?? ""}`.trim() + " is connected to the running Aseprite editor.",
        asepriteAvailableDetail,
        "Aseprite is not detected, and its native CLI is unavailable.",
      ),
      integration(
        "serena",
        serenaConnected,
        serenaAvailable,
        "Serena is running.",
        "Serena is detected and enabled by default.",
        "Serena is not detected.",
      ),
      integration(
        "solOrchestrator",
        false,
        true,
        "Sol Orchestrator Codex App Server is active.",
        "Codex App Server starts on demand when Sol delegates work.",
        "Codex App Server is unavailable.",
      ),
      integration(
        "playwright",
        false,
        playwright.chromiumInstalled,
        "Playwright browser is active.",
        "Chromium is installed and starts on demand.",
        "Playwright Chromium is unavailable.",
      ),
      integration(
        "roblox",
        Boolean(discovered && processDetected(discovered, "roblox")),
        true,
        "Roblox Studio process detected.",
        "Official Studio MCP launcher is available for roblox_* tools.",
        "Install Studio, enable MCP in Assistant settings, then start with auvrynt start roblox.",
      ),
      integration(
        "desktop",
        false,
        desktopAvailable,
        "Windows desktop capture and input are available.",
        "Windows desktop capture and input are ready on demand.",
        "Desktop capture and input currently require Windows.",
      ),
      integration(
        "krita",
        kritaRunning,
        kritaRunning,
        "Krita is running; the no-plugin calibrated desktop path is available.",
        "Krita is available when its main window is visible.",
        "Krita is not detected. Open the visible Krita main window before testing.",
      ),
      integration(
        "openPencil",
        openPencilConnected,
        Boolean(openPencilRunning || discovered?.executables.openPencil),
        openPencilDocuments?.detail ?? "OpenPencil editor and document connected.",
        openPencilRunning
          ? openPencilHealth && "detail" in openPencilHealth
            ? openPencilHealth.detail
            : openPencilDocuments?.detail ?? "OpenPencil is running; the native MCP connection is not established."
          : "OpenPencil is installed; open a document to use its official MCP server.",
        "OpenPencil is not detected. Install the desktop app, then enable this integration.",
      ),
    ],
    skills: buildDashboardSkills(config),
    ngrok: {
      ...ngrokSummary,
      provider: config.tunnelProvider,
      ...(ngrokNotice ? { notice: ngrokNotice } : {}),
    },
    logs,
  };
}

function createNgrokNotice(
  config: ServerConfig,
  summary: NgrokAuthtokenPoolSummary,
  logs: RecentLogEntry[],
): DashboardNgrokNotice | undefined {
  if (config.tunnelProvider !== "ngrok") return undefined;
  const quotaEvent = logs.some((entry) => entry.event === "ngrok_quota_exhausted");
  const exhausted = summary.tokens.filter((token) => token.quotaExhaustedAt);
  if (summary.environmentOverride) {
    if (!quotaEvent) return undefined;
    return {
      tone: "error",
      title: "ngrok request limit reached",
      message: "The active token comes from AUVRYNT_NGROK_AUTHTOKEN, so automatic failover is blocked. Remove that override and add backup tokens in Secrets.",
    };
  }
  if (exhausted.length === 0) return undefined;
  const active = summary.tokens.find((token) => token.active);
  if (active && !active.quotaExhaustedAt && exhausted.length > 0) {
    return {
      tone: "warning",
      title: "ngrok token switched automatically",
      message: `${exhausted.length} saved token${exhausted.length === 1 ? " has" : "s have"} reached the monthly request limit. Auvrynt is using backup ${active.fingerprint}. Check Connectivity because a random ngrok public URL may have changed.`,
    };
  }
  if (summary.tokens.length === 0) {
    return {
      tone: "error",
      title: "ngrok request limit reached",
      message: "No managed backup token is available. Add another ngrok authtoken in Secrets to restore the public MCP tunnel.",
    };
  }
  return {
    tone: "error",
    title: "All saved ngrok tokens are unavailable",
    message: `${exhausted.length || summary.tokens.length} saved token${summary.tokens.length === 1 ? " has" : "s have"} reached the monthly request limit. Add a fresh token in Secrets.`,
  };
}

export interface DashboardToolEntry {
  name: string;
  title: string;
  group: string;
  enabled: boolean;
}

export function createDashboardToolsView(
  config: ServerConfig,
  integration: DashboardIntegrationKey,
): DashboardToolEntry[] | undefined {
  const names = registeredToolNamesForIntegration(integration);
  if (names.length === 0 && !config.integrations[integration]) return undefined;
  const groups = groupToolsByName(names);
  const entries: DashboardToolEntry[] = [];
  for (const [group, toolNames] of groups) {
    for (const name of toolNames) {
      entries.push({
        name,
        title: toolTitle(name),
        group,
        enabled: toolIntegrationEnabled(config, name),
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function toolTitle(name: string): string {
  return name
    .replace(/^blender_|^aseprite_|^godot_|^serena_/, "")
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function dashboardCsp(nonce: string): string {  return [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "img-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function localHttpUrl(host: string, port: number, path: string): string {
  const probeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const formattedHost = probeHost.includes(":") && !probeHost.startsWith("[")
    ? `[${probeHost}]`
    : probeHost;
  return `http://${formattedHost}:${port}${path}`;
}

function buildDashboardSkills(config: ServerConfig): DashboardSkillsState {
  const workspaceRoot = config.allowedRoots[0];
  const cwd = workspaceRoot ?? config.agentDir;
  const loaded = loadWorkspaceSkills(config, cwd);
  return {
    enabled: config.skillsEnabled,
    agentDir: formatPathForPrompt(config.agentDir),
    skillPaths: config.skillPaths.map((path) => formatPathForPrompt(path)),
    ...(workspaceRoot ? { workspaceRoot: formatPathForPrompt(workspaceRoot) } : {}),
    skills: loaded.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: formatPathForPrompt(skill.filePath),
      baseDir: formatPathForPrompt(skill.baseDir),
      scope: skill.sourceInfo.scope,
      source: skill.sourceInfo.source,
      origin: skill.sourceInfo.origin,
      disableModelInvocation: skill.disableModelInvocation,
      agentAccess: skill.disableModelInvocation
        ? "Listed for agents, but model auto-invocation is disabled (manual /skill use only)."
        : "Exposed on open_workspace as an available skill; agents should read the SKILL.md path before using it.",
    })),
    diagnostics: loaded.diagnostics.map((diag) => ({
      type: typeof (diag as { type?: unknown }).type === "string" ? (diag as { type: string }).type : undefined,
      message: String((diag as { message?: unknown }).message ?? diag),
      path: typeof (diag as { path?: unknown }).path === "string"
        ? formatPathForPrompt((diag as { path: string }).path)
        : undefined,
    })),
  };
}
