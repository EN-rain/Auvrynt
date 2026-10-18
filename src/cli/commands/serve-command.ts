import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../config.js";
import { parseStartRequest, resolveSavedWorkspaceRoot } from "../../background-lifecycle.js";
import { loadAuvryntFiles } from "../../user-config.js";
import { startTunnel } from "../../tunnels/tunnel-manager.js";
import {
  applyIntegrationProfile,
  type LifecycleManager,
} from "../lifecycle-manager.js";
import { selfHealStartIntegrations } from "../integration-bootstrap.js";
import { acquireInstanceLock } from "../instance-lock.js";
import { serveForegroundServer } from "../foreground-server.js";
import { ensureConfigured } from "./init-command.js";

export async function runServeCommand(
  rawCommand: string | undefined,
  args: string[],
  lifecycle: LifecycleManager,
): Promise<void> {
  const startRequest = rawCommand === "start" ? parseStartRequest(args) : undefined;
  if (startRequest && !startRequest.backgroundChild) {
    await ensureConfigured({ directoryScoped: true });
    const files = loadAuvryntFiles();
    const launchRoot = args.length === 0
      ? requireSavedWorkspaceRoot(resolveStartLaunchRoot(args, files.config, process.cwd()))
      : setDirectoryScopedRoot();
    if (args.length === 0) setPersistedDirectoryScope(files.config.allowedRoots, launchRoot);
    await lifecycle.start(startRequest, launchRoot);
    return;
  }

  if (rawCommand === "start" && !process.env.AUVRYNT_ALLOWED_ROOTS) {
    const files = loadAuvryntFiles();
    const launchRoot = requireSavedWorkspaceRoot(resolveSavedWorkspaceRoot(files.config, process.cwd()));
    setPersistedDirectoryScope(files.config.allowedRoots, launchRoot);
  }
  await ensureConfigured({ directoryScoped: rawCommand === "start" });
  if (startRequest?.profiles) applyIntegrationProfile(startRequest.profiles);

  const localConfig = loadConfig();
  exposeConfiguredGodotExecutables(localConfig.executables);
  const instanceLock = await acquireInstanceLock(
    localConfig.stateDir,
    localConfig.host,
    localConfig.port,
    startRequest?.profiles,
    resolve(process.cwd()),
  );
  let tunnel: { process: ChildProcess; url: string } | undefined;
  let stopTunnel: (() => void) | undefined;
  try {
    if (rawCommand === "start") {
      process.env.AUVRYNT_START_MODE = "true";
      const launchRoot = resolve(process.cwd());
      if (!startRequest?.backgroundChild) {
        await selfHealStartIntegrations(
          launchRoot,
          localConfig.executables,
          localConfig.integrations,
        );
      }
      const managedTunnelUrl = process.env.AUVRYNT_MANAGED_TUNNEL_URL;
      if (managedTunnelUrl) {
        process.env.AUVRYNT_PUBLIC_BASE_URL = managedTunnelUrl;
      } else if (localConfig.tunnelProvider === "custom"
        && ((process.platform === "win32" && !localConfig.cloudflareTokenManaged) || !localConfig.cloudflareTunnelToken)) {
        process.env.AUVRYNT_PUBLIC_BASE_URL = localConfig.publicBaseUrl;
      } else {
        tunnel = await startTunnel(localConfig.tunnelProvider, localConfig.port, {
          ngrokAuthtoken: localConfig.ngrokAuthtoken,
          ngrokUrl: localConfig.ngrokUrl,
          cloudflareTunnelToken: localConfig.cloudflareTunnelToken,
          publicUrl: localConfig.publicBaseUrl,
        });
        process.env.AUVRYNT_PUBLIC_BASE_URL = tunnel.url;
        stopTunnel = () => {
          if (tunnel && !tunnel.process.killed) tunnel.process.kill();
        };
        process.once("SIGINT", stopTunnel);
        process.once("SIGTERM", stopTunnel);
      }
    }
    await serveForegroundServer();
  } finally {
    if (stopTunnel) {
      process.removeListener("SIGINT", stopTunnel);
      process.removeListener("SIGTERM", stopTunnel);
      stopTunnel();
    }
    await instanceLock.release();
  }
}

export function resolveStartLaunchRoot(
  args: string[],
  config: { workspaceRoot?: string; allowedRoots?: string[] },
  cwd: string,
): string {
  return args.length === 0 ? resolveSavedWorkspaceRoot(config, cwd) : resolve(cwd);
}

function setDirectoryScopedRoot(): string {
  const launchRoot = resolve(process.cwd());
  process.env.AUVRYNT_ALLOWED_ROOTS = launchRoot;
  process.env.AUVRYNT_WORKTREE_ROOT = launchRoot;
  return launchRoot;
}

function setPersistedDirectoryScope(allowedRoots: string[] | undefined, launchRoot: string): void {
  process.env.AUVRYNT_ALLOWED_ROOTS = (allowedRoots && allowedRoots.length > 0
    ? allowedRoots
    : [launchRoot]).join(",");
  process.env.AUVRYNT_WORKTREE_ROOT = launchRoot;
}

function requireSavedWorkspaceRoot(root: string): string {
  if (!existsSync(root)) {
    throw new Error(`Saved workspace directory does not exist: ${root}. Change it in the dashboard or run auvrynt change from the desired directory.`);
  }
  return root;
}

function exposeConfiguredGodotExecutables(
  executables: ReturnType<typeof loadConfig>["executables"],
): void {
  if (
    executables.godotCsharp
    && !process.env.GODOT_DOTNET_EXECUTABLE
  ) {
    process.env.GODOT_DOTNET_EXECUTABLE = executables.godotCsharp;
  }
  if (executables.godot && !process.env.GODOT_EXECUTABLE) {
    process.env.GODOT_EXECUTABLE = executables.godot;
  }
}
