import * as prompts from "@clack/prompts";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import type { ServerConfig } from "../config.js";
import { loadConfig } from "../config.js";
import {
  INTEGRATION_KEYS,
  INTEGRATION_LABELS,
  acquireManagementLock,
  atomicWriteJson,
  getProcessIdentity,
  isProcessRunning,
  parseIntegrationProfiles,
  profilesFromIntegrationConfig,
  processIdentityMatches,
  readJsonFile,
  rotateLogFile,
  resolveSavedWorkspaceRoot,
  type InstanceLockRecord,
  type IntegrationKey,
  type ManagedTunnelRecord,
  type StartRequest,
  type TunnelProvider,
} from "../background-lifecycle.js";
import { integrationsForProfiles, postInstanceControl } from "./instance-control.js";
import { isAuvryntHealthReachable } from "./instance-lock.js";
import { dashboardUrl, printConsolePanel, RUNNING_COMMAND_HINTS } from "./runtime-support.js";
import { completeIntegrationsConfig, ensureIntegrationChoicesConfigured } from "./commands/integration-commands.js";
import { loadAuvryntFiles, writeAuvryntConfig } from "../user-config.js";
import {
  ensureManagedTunnel,
  managedTunnelPath,
  readManagedTunnel,
  stopManagedTunnel,
  tunnelProviderLabel,
  type ManagedTunnelOptions,
} from "../tunnels/tunnel-manager.js";
import { startCloudflaredService, stopCloudflaredService } from "../tunnels/cloudflared-service.js";
import { persistedSelectionConfig } from "./profile-persistence.js";

export interface ActiveInstance {
  stateDir: string;
  lockPath: string;
  record: InstanceLockRecord;
}

export type IntegrationBootstrap = (
  launchRoot: string,
  executables: ServerConfig["executables"],
  integrations: ServerConfig["integrations"],
) => Promise<{ serenaExecutable?: string }>;

export interface LifecycleManager {
  readActiveInstance(): Promise<ActiveInstance | undefined>;
  start(request: StartRequest, launchRoot?: string): Promise<void>;
  stop(): Promise<void>;
  restart(request: StartRequest, launchRoot: string, hard: boolean): Promise<void>;
  changeWorkspace(launchRoot: string): Promise<void>;
  addProfiles(args: string[]): Promise<void>;
}

function managedTunnelOptions(
  stateDir: string,
  port: number,
  provider: TunnelProvider,
  config = loadConfig(),
): ManagedTunnelOptions {
  return {
    stateDir,
    port,
    provider,
    ngrokAuthtoken: config.ngrokAuthtoken,
    ngrokUrl: config.ngrokUrl,
    cloudflareTunnelToken: config.cloudflareTunnelToken,
    publicUrl: config.publicBaseUrl,
  };
}

export function applyIntegrationProfile(profiles: IntegrationKey[]): void {
  const selected = new Set(profiles);
  const environmentKeys: Record<IntegrationKey, string> = {
    godotGdscript: "AUVRYNT_GODOT_GDSCRIPT_ENABLED",
    godotCsharp: "AUVRYNT_GODOT_CSHARP_ENABLED",
    blender: "AUVRYNT_BLENDER_ENABLED",
    aseprite: "AUVRYNT_ASEPRITE_ENABLED",
    serena: "AUVRYNT_SERENA_INTEGRATION_ENABLED",
    solOrchestrator: "AUVRYNT_SOL_ORCHESTRATOR_ENABLED",
    playwright: "AUVRYNT_PLAYWRIGHT_ENABLED",
    roblox: "AUVRYNT_ROBLOX_ENABLED",
    desktop: "AUVRYNT_DESKTOP_ENABLED",
    krita: "AUVRYNT_KRITA_ENABLED",
    openPencil: "AUVRYNT_OPEN_PENCIL_ENABLED",
  };
  for (const key of INTEGRATION_KEYS) {
    process.env[environmentKeys[key]] = selected.has(key) ? "true" : "false";
  }
}

export function createLifecycleManager(selfHealStartIntegrations: IntegrationBootstrap): LifecycleManager {
  async function readActiveInstance(): Promise<ActiveInstance | undefined> {
    const config = loadConfig();
    const lockPath = join(config.stateDir, "server.lock");
    const record = await readJsonFile<InstanceLockRecord>(lockPath);
    if (!record || !Number.isInteger(record.pid) || record.pid < 1) return undefined;

    const hasIdentity = Boolean(record.processPath && record.processStartedAt);
    const ownedProcess = hasIdentity
      ? processIdentityMatches(record.pid, record)
      : isProcessRunning(record.pid) && await isAuvryntHealthReachable(record.host, record.port);
    if (ownedProcess) return { stateDir: config.stateDir, lockPath, record };
    await unlink(lockPath).catch(() => undefined);
    return undefined;
  }

  async function updateActiveProfiles(active: ActiveInstance, profiles: IntegrationKey[]): Promise<void> {
    const integrations = integrationsForProfiles(profiles);
    const config = loadConfig();
    const currentProfiles = new Set(active.record.profiles ?? []);
    const newlyEnabledProfiles = profiles.filter((profile) => !currentProfiles.has(profile));
    const healed = await selfHealStartIntegrations(
      active.record.launchRoot ?? resolve(process.cwd()),
      config.executables,
      integrationsForProfiles(newlyEnabledProfiles),
    );
    const response = await postInstanceControl(active, "/__auvrynt/control/profiles", {
      integrations,
      serenaExecutable: healed.serenaExecutable,
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error || `The running Auvrynt instance rejected the update (${response.status}).`);
    active.record.profiles = profiles;
    writeAuvryntConfig(
      persistedSelectionConfig(profiles, active.record.launchRoot ?? resolve(process.cwd())),
    );
    await atomicWriteJson(active.lockPath, active.record);
  }

  async function terminateRootProcess(pid: number): Promise<void> {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/PID", String(pid), "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      if (isProcessRunning(pid)) throw new Error(`Could not stop Auvrynt process ${pid}.`);
    }
  }

  async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isProcessRunning(pid)) return true;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    return !isProcessRunning(pid);
  }

  function findLegacyCloudflaredChildren(parentPid: number): Array<{ pid: number; processPath: string; processStartedAt: string }> {
    if (process.platform !== "win32") return [];
    try {
      const script = [
        `$items = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parentPid}" -ErrorAction Stop`,
        "| Where-Object { $_.Name -ieq 'cloudflared.exe' }",
        "| ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{ pid = $_.ProcessId; processPath = $p.Path; processStartedAt = $p.StartTime.ToUniversalTime().ToString('o') } } })",
        "$items | ConvertTo-Json -Compress",
      ].join(" ; ").replace(/ ; \|/g, " |");
      const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.filter((item): item is { pid: number; processPath: string; processStartedAt: string } => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Record<string, unknown>;
        return Number.isInteger(candidate.pid)
          && typeof candidate.processPath === "string"
          && /(^|[\\/])cloudflared\.exe$/i.test(candidate.processPath)
          && typeof candidate.processStartedAt === "string";
      });
    } catch {
      return [];
    }
  }

  async function adoptLegacyManagedTunnel(active: Pick<ActiveInstance, "stateDir" | "record">): Promise<ManagedTunnelRecord | undefined> {
    const existing = await readManagedTunnel(managedTunnelOptions(active.stateDir, active.record.port, "cloudflare"));
    if (existing) return existing;
    const children = findLegacyCloudflaredChildren(active.record.pid);
    if (children.length !== 1) return undefined;
    const output = await readFile(join(active.stateDir, "cloudflared.log"), "utf8").catch(() => "");
    const url = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g)?.at(-1);
    if (!url) return undefined;
    const record: ManagedTunnelRecord = { ...children[0], url, port: active.record.port };
    await atomicWriteJson(managedTunnelPath(active.stateDir), record);
    return record;
  }

  async function waitForBackgroundReady(
    stateDir: string,
    pid: number,
    host: string,
    port: number,
    spawnError: () => Error | undefined,
  ): Promise<InstanceLockRecord> {
    const deadline = Date.now() + 30_000;
    const lockPath = join(stateDir, "server.lock");
    while (Date.now() < deadline) {
      const error = spawnError();
      if (error) throw new Error(`Auvrynt failed to start: ${error.message}`);
      if (!isProcessRunning(pid)) throw new Error("Auvrynt exited before becoming ready.");
      const record = await readJsonFile<InstanceLockRecord>(lockPath);
      if (record?.pid === pid && await isAuvryntHealthReachable(host, port) && processIdentityMatches(pid, record)) return record;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    throw new Error("Auvrynt did not become ready within 30 seconds.");
  }

  async function runBackgroundStartUnlocked(request: StartRequest, launchRoot: string): Promise<void> {
    const active = await readActiveInstance();
    const config = loadConfig();
    if (config.executables.godotCsharp && !process.env.GODOT_DOTNET_EXECUTABLE) {
      process.env.GODOT_DOTNET_EXECUTABLE = config.executables.godotCsharp;
    }
    if (config.executables.godot && !process.env.GODOT_EXECUTABLE) {
      process.env.GODOT_EXECUTABLE = config.executables.godot;
    }
    const savedFiles = loadAuvryntFiles();
    const profiles = request.profiles
      ?? active?.record.profiles
      ?? profilesFromIntegrationConfig(savedFiles.config.integrations);
    const effectiveLaunchRoot = request.profiles === undefined && !request.replace
      ? resolve(active?.record.launchRoot ?? resolveSavedWorkspaceRoot(savedFiles.config, launchRoot))
      : resolve(launchRoot);
    const persistedConfig = persistedSelectionConfig(profiles, effectiveLaunchRoot);
    if (active) {
      let replace = request.replace;
      if (!replace && stdin.isTTY && stdout.isTTY) {
        const answer = await prompts.confirm({ message: `Replace running Auvrynt instance (PID ${active.record.pid})?`, initialValue: false });
        if (prompts.isCancel(answer) || !answer) {
          printConsolePanel("Auvrynt start cancelled");
          return;
        }
        replace = true;
      }
      if (!replace) throw new Error(`Auvrynt is already running (PID ${active.record.pid}). Re-run with --replace to override it.`);
      if (resolve(active.record.launchRoot ?? effectiveLaunchRoot) === effectiveLaunchRoot && active.record.controlToken) {
        await updateActiveProfiles(active, profiles);
        const tunnel = await readManagedTunnel(managedTunnelOptions(active.stateDir, active.record.port, config.tunnelProvider, config));
        printConsolePanel("Auvrynt updated", [
          { label: "PID", value: String(active.record.pid) },
          { label: "Workspace", value: active.record.launchRoot ?? effectiveLaunchRoot },
          { label: "Integrations", value: profiles.map((key) => INTEGRATION_LABELS[key]).join(", ") || "none" },
          { label: "Dashboard", value: dashboardUrl(active.record.host, active.record.port) },
          ...(tunnel ? [{ label: "Public MCP", value: `${tunnel.url}/mcp` }] : []),
        ], ["Server and tunnel kept running", ...RUNNING_COMMAND_HINTS]);
        return;
      }
      await adoptLegacyManagedTunnel(active);
      await stopActiveInstance(active);
    }

    await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    await selfHealStartIntegrations(effectiveLaunchRoot, config.executables, integrationsForProfiles(profiles));
    const tunnelOptions = managedTunnelOptions(config.stateDir, config.port, config.tunnelProvider, config);
    const managesCustomTunnel = config.tunnelProvider !== "custom"
      || (Boolean(config.cloudflareTunnelToken) && (config.cloudflareTokenManaged || process.platform !== "win32"));
    const tunnelResult = managesCustomTunnel ? await ensureManagedTunnel(tunnelOptions) : undefined;
    const publicBaseUrl = tunnelResult?.record.url ?? config.publicBaseUrl;
    if (config.tunnelProvider === "custom" && !managesCustomTunnel) {
      await stopManagedTunnel(tunnelOptions);
    } else if (config.publicBaseUrl !== publicBaseUrl) {
      const files = loadAuvryntFiles();
      writeAuvryntConfig({ ...files.config, publicBaseUrl });
    }
    const logPath = join(config.stateDir, "auvrynt.log");
    await rotateLogFile(logPath);
    const logHandle = openSync(logPath, "a", 0o600);
    const childArgs = [process.argv[1], "start", "--background-child"];
    if (profiles.length > 0) childArgs.push(profiles.join(","));
    else childArgs.push("--no-integrations");
    const controlToken = randomBytes(32).toString("base64url");
    const child = spawn(process.execPath, childArgs, {
      cwd: effectiveLaunchRoot,
      detached: true,
      stdio: ["ignore", logHandle, logHandle],
      windowsHide: true,
      env: {
        ...process.env,
        AUVRYNT_CONTROL_TOKEN: controlToken,
        ...(managesCustomTunnel ? { AUVRYNT_MANAGED_TUNNEL_URL: publicBaseUrl } : {}),
      },
    });
    closeSync(logHandle);
    let childSpawnError: Error | undefined;
    child.once("error", (error) => { childSpawnError = error; });
    if (!child.pid) {
      if (tunnelResult?.created) await stopManagedTunnel(tunnelOptions);
      throw new Error("Auvrynt could not create its background process.");
    }
    child.unref();
    try {
      await waitForBackgroundReady(config.stateDir, child.pid, config.host, config.port, () => childSpawnError);
      writeAuvryntConfig(persistedConfig);
    } catch (error) {
      await terminateRootProcess(child.pid).catch(() => undefined);
      if (tunnelResult?.created) {
        await stopManagedTunnel(tunnelOptions).catch(() => undefined);
      }
      throw error;
    }
    printConsolePanel("Auvrynt started", [
      { label: "PID", value: String(child.pid) },
      { label: "Workspace", value: effectiveLaunchRoot },
      { label: "Integrations", value: profiles.map((key) => INTEGRATION_LABELS[key]).join(", ") || "no optional integrations" },
      { label: "Dashboard", value: dashboardUrl(config.host, config.port) },
      { label: "Public MCP", value: `${publicBaseUrl}/mcp` },
    ], ["Next: auvrynt status", ...RUNNING_COMMAND_HINTS]);
  }

  async function start(request: StartRequest, launchRoot = resolve(process.cwd())): Promise<void> {
    const config = loadConfig();
    const management = await acquireManagementLock(config.stateDir);
    const useCloudflaredService = process.platform === "win32" && config.tunnelProvider === "custom"
      && !config.cloudflareTokenManaged;
    let serviceStarted = false;
    try {
      if (useCloudflaredService) serviceStarted = await startCloudflaredService();
      await runBackgroundStartUnlocked(request, launchRoot);
    } catch (error) {
      if (serviceStarted) await stopCloudflaredService().catch(() => undefined);
      throw error;
    } finally {
      await management.release();
    }
  }

  async function stopActiveInstance(active: ActiveInstance): Promise<void> {
    const hasIdentity = Boolean(active.record.processPath && active.record.processStartedAt);
    const stillOwned = hasIdentity
      ? processIdentityMatches(active.record.pid, active.record)
      : isProcessRunning(active.record.pid) && await isAuvryntHealthReachable(active.record.host, active.record.port);
    if (!stillOwned) {
      if (isProcessRunning(active.record.pid) || await isAuvryntHealthReachable(active.record.host, active.record.port)) {
        throw new Error(`Auvrynt PID ${active.record.pid} is still running but its process identity could not be verified. Refusing to stop an unowned process.`);
      }
      await unlink(active.lockPath).catch(() => undefined);
      return;
    }
    const activeConfig = loadConfig();
    const managedTunnel = await readManagedTunnel(managedTunnelOptions(active.stateDir, active.record.port, activeConfig.tunnelProvider, activeConfig));
    const legacyTunnels = active.record.controlToken
      ? []
      : findLegacyCloudflaredChildren(active.record.pid).filter((candidate) => candidate.pid !== managedTunnel?.pid);
    if (active.record.controlToken) {
      try {
        const response = await postInstanceControl(active, "/__auvrynt/control/shutdown");
        if (!response.ok) throw new Error(`Shutdown request failed (${response.status}).`);
      } catch {
        await terminateRootProcess(active.record.pid);
      }
    } else {
      await terminateRootProcess(active.record.pid);
    }
    if (!await waitForProcessExit(active.record.pid, 15_000)) await terminateRootProcess(active.record.pid);
    if (!await waitForProcessExit(active.record.pid, 5_000)) throw new Error(`Could not stop Auvrynt process ${active.record.pid}.`);
    for (const tunnel of legacyTunnels) {
      if (processIdentityMatches(tunnel.pid, tunnel)) await terminateRootProcess(tunnel.pid).catch(() => undefined);
    }
    const current = await readJsonFile<InstanceLockRecord>(active.lockPath);
    if (current?.instanceId === active.record.instanceId) {
      await unlink(active.lockPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }

  async function stop(): Promise<void> {
    const config = loadConfig();
    const management = await acquireManagementLock(config.stateDir);
    let active: ActiveInstance | undefined;
    let tunnelStopped = false;
    let serverError: unknown;
    let tunnelError: unknown;
    let serviceError: unknown;
    try {
      active = await readActiveInstance();
      try {
        if (active) await stopActiveInstance(active);
      } catch (error) {
        serverError = error;
      } finally {
        try {
          tunnelStopped = await stopManagedTunnel(managedTunnelOptions(config.stateDir, config.port, config.tunnelProvider, config));
        } catch (error) {
          tunnelError = error;
        }
        if (process.platform === "win32" && config.tunnelProvider === "custom" && !config.cloudflareTokenManaged) {
          try {
            await stopCloudflaredService();
          } catch (error) {
            serviceError = error;
          }
        }
      }
    } finally {
      await management.release();
    }
    if (serverError || tunnelError || serviceError) {
      throw new AggregateError(
        [serverError, tunnelError, serviceError].filter((error): error is object => Boolean(error)),
        "Auvrynt could not stop all managed processes.",
      );
    }
    if (await readActiveInstance() || await isAuvryntHealthReachable(config.host, config.port)) {
      throw new Error("Auvrynt stop did not verify that the managed server exited.");
    }
    if (await readManagedTunnel(managedTunnelOptions(config.stateDir, config.port, config.tunnelProvider, config))) {
      throw new Error("Auvrynt stop did not verify that the managed tunnel exited.");
    }
    if (!active && !tunnelStopped) {
      printConsolePanel("Auvrynt", [{ label: "Status", value: "Not running" }]);
      return;
    }
    printConsolePanel("Auvrynt stopped", [
      { label: "Server", value: "Stopped" },
      { label: "Tunnel", value: "Stopped" },
    ], "Start again: auvrynt start");
  }

  async function restart(request: StartRequest, launchRoot: string, hard: boolean): Promise<void> {
    if (hard) {
      const config = loadConfig();
      const management = await acquireManagementLock(config.stateDir);
      try {
        const active = await readActiveInstance();
        const profiles = request.profiles ?? active?.record.profiles;
        if (!profiles) await ensureIntegrationChoicesConfigured();
        const restartRoot = resolve(active?.record.launchRoot ?? launchRoot);
        if (active) {
          await adoptLegacyManagedTunnel(active);
          await stopActiveInstance(active);
        }
        await stopManagedTunnel(
          managedTunnelOptions(config.stateDir, config.port, config.tunnelProvider, config),
        );
        await runBackgroundStartUnlocked(
          { ...request, profiles, replace: true, backgroundChild: false },
          restartRoot,
        );
      } finally {
        await management.release();
      }
      return;
    }
    const config = loadConfig();
    const management = await acquireManagementLock(config.stateDir);
    try {
      const active = await readActiveInstance();
      if (!active) throw new Error("Auvrynt is not running. Use `auvrynt start` instead.");
      const profiles = request.profiles ?? active.record.profiles
        ?? INTEGRATION_KEYS.filter((key) => completeIntegrationsConfig(loadAuvryntFiles().config.integrations)[key]);
      const restartRoot = resolve(active.record.launchRoot ?? launchRoot);
      const tunnelBefore = await adoptLegacyManagedTunnel(active)
        ?? await readManagedTunnel(managedTunnelOptions(active.stateDir, active.record.port, config.tunnelProvider, config));
      await stopActiveInstance(active);
      await runBackgroundStartUnlocked({ ...request, profiles, replace: true, backgroundChild: false }, restartRoot);
      const tunnelAfter = await readManagedTunnel(managedTunnelOptions(config.stateDir, config.port, config.tunnelProvider, config));
      if (tunnelBefore && tunnelAfter && tunnelBefore.url !== tunnelAfter.url) {
        printConsolePanel(`${tunnelProviderLabel(config.tunnelProvider)} tunnel replaced`, [
          { label: "Public MCP", value: `${tunnelAfter.url}/mcp` },
        ], "The previous tunnel process was no longer healthy");
      }
    } finally {
      await management.release();
    }
  }

  async function changeWorkspace(launchRoot: string): Promise<void> {
    const config = loadConfig();
    const management = await acquireManagementLock(config.stateDir);
    try {
      const active = await readActiveInstance();
      if (!active) throw new Error("Auvrynt is not running. Use `auvrynt start` in this directory instead.");
      const currentRoot = resolve(active.record.launchRoot ?? launchRoot);
      const sameRoot = process.platform === "win32"
        ? currentRoot.toLowerCase() === launchRoot.toLowerCase()
        : currentRoot === launchRoot;
      if (sameRoot) {
        const tunnel = await readManagedTunnel(managedTunnelOptions(active.stateDir, active.record.port, config.tunnelProvider, config));
        printConsolePanel("Auvrynt workspace unchanged", [
          { label: "Workspace", value: launchRoot },
          { label: "Dashboard", value: dashboardUrl(active.record.host, active.record.port) },
          ...(tunnel ? [{ label: "Public MCP", value: `${tunnel.url}/mcp` }] : []),
        ], RUNNING_COMMAND_HINTS);
        return;
      }
      const profiles = active.record.profiles
        ?? INTEGRATION_KEYS.filter((key) => completeIntegrationsConfig(loadAuvryntFiles().config.integrations)[key]);
      await runBackgroundStartUnlocked({ profiles, replace: true, backgroundChild: false }, launchRoot);
    } finally {
      await management.release();
    }
  }

  async function addProfiles(args: string[]): Promise<void> {
    const additions = parseIntegrationProfiles(args);
    const config = loadConfig();
    const management = await acquireManagementLock(config.stateDir);
    try {
      const active = await readActiveInstance();
      const saved = completeIntegrationsConfig(loadAuvryntFiles().config.integrations);
      const current = active?.record.profiles ?? INTEGRATION_KEYS.filter((key) => saved[key]);
      const profiles = Array.from(new Set([...current, ...additions]));
      if (active) {
        if (!active.record.controlToken) {
          await adoptLegacyManagedTunnel(active);
          await stopActiveInstance(active);
          await runBackgroundStartUnlocked({ profiles, replace: true, backgroundChild: false }, active.record.launchRoot ?? resolve(process.cwd()));
          return;
        }
        await updateActiveProfiles(active, profiles);
        const tunnel = await readManagedTunnel(managedTunnelOptions(active.stateDir, active.record.port, config.tunnelProvider, config));
        printConsolePanel("Auvrynt integrations updated", [
          { label: "PID", value: String(active.record.pid) },
          { label: "Integrations", value: profiles.map((key) => INTEGRATION_LABELS[key]).join(", ") },
          { label: "Dashboard", value: dashboardUrl(active.record.host, active.record.port) },
          ...(tunnel ? [{ label: "Public MCP", value: `${tunnel.url}/mcp` }] : []),
        ], ["Server and tunnel kept running", ...RUNNING_COMMAND_HINTS]);
        return;
      }
      await runBackgroundStartUnlocked({ profiles, replace: true, backgroundChild: false }, resolve(process.cwd()));
    } finally {
      await management.release();
    }
  }

  return { readActiveInstance, start, stop, restart, changeWorkspace, addProfiles };
}
