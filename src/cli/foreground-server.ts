import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "../config.js";
import { hardenHttpServer } from "../http-server-hardening.js";
import { isLoopbackRequest, logEvent } from "../logger.js";
import {
  discoverLocalIntegrations,
  processDetected,
  type LocalIntegrationDiscovery,
} from "../integration-discovery.js";
import { getGlobalGodotPluginStatus } from "../godot-tools.js";
import { getPlaywrightRuntimeStatus } from "../playwright-runtime.js";
import { loadAuvryntFiles } from "../user-config.js";
import {
  INTEGRATION_KEYS,
  type IntegrationKey,
} from "../background-lifecycle.js";
import { tunnelProviderLabel } from "../tunnels/tunnel-manager.js";
import {
  dashboardUrl,
  httpUrl,
  RUNNING_COMMAND_HINTS,
  scheduleCrashRecovery,
  writeFatalLog,
} from "./runtime-support.js";
import { checkSqliteNative } from "./commands/status-commands.js";
import { registerDashboardActions } from "./dashboard-actions.js";
import { registerJobsDashboardActions } from "./jobs-dashboard-actions.js";
import { applyDetectedSerenaDefault } from "./serena-detected-default.js";
import { startTunnelHealthMonitor } from "./tunnel-health-monitor.js";

export async function serveForegroundServer(): Promise<void> {
  const sqliteStatus = checkSqliteNative();
  if (sqliteStatus !== "ok") {
    throw new Error(
      [
        "better-sqlite3 could not load for this Node runtime.",
        sqliteStatus,
        "",
        "Try reinstalling or rebuilding dependencies under the active Node version:",
        "  npm rebuild better-sqlite3",
      ].join("\n"),
    );
  }

  const { createServer } = await import("../server.js");
  const config = loadConfig();
  const integrationStatus = await discoverLocalIntegrations().catch((): LocalIntegrationDiscovery => ({
    processes: [], executables: {}, ports: {},
  }));
  applyDetectedSerenaDefault(config, integrationStatus, loadAuvryntFiles().config);
  const runningServer = createServer(config);
  const { app } = runningServer;
  const startMode = process.env.AUVRYNT_START_MODE === "true";

  let fatalExitStarted = false;
  const exitAfterFatalError = (type: string, error: unknown): void => {
    if (fatalExitStarted) return;
    fatalExitStarted = true;
    writeFatalLog(config.stateDir, type, error);
    scheduleCrashRecovery(config.stateDir, type);
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  };
  process.once("uncaughtException", (error, origin) => {
    exitAfterFatalError(`uncaughtException:${origin}`, error);
  });
  process.once("unhandledRejection", (reason) => {
    exitAfterFatalError("unhandledRejection", reason);
  });

  const publicMcpUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, "")}/mcp`
    : httpUrl(config.host, config.port, "/mcp");
  const godotPlugin = getGlobalGodotPluginStatus();
  const godotIsSetup = Boolean(
    config.executables.godot || config.executables.godotCsharp,
  );

  const controlToken = process.env.AUVRYNT_CONTROL_TOKEN;
  let requestShutdown: (() => Promise<void>) | undefined;
  const controlAuthorized = (authorization: string | undefined): boolean => {
    if (!controlToken || !authorization?.startsWith("Bearer ")) return false;
    const provided = Buffer.from(authorization.slice("Bearer ".length));
    const expected = Buffer.from(controlToken);
    return provided.length === expected.length
      && timingSafeEqual(provided, expected);
  };
  registerDashboardActions({
    runningServer,
    config,
    dashboardControlToken: runningServer.dashboardControlToken,
    requestShutdown: () => { void requestShutdown?.(); },
  });
  registerJobsDashboardActions({
    runningServer,
    config,
    dashboardControlToken: runningServer.dashboardControlToken,
    facebookOAuth: runningServer.facebookOAuth,
  });

  if (controlToken) {
    app.post("/__auvrynt/control/profiles", async (req, res) => {
      if (
        !isLoopbackRequest(req)
        || !controlAuthorized(req.header("authorization"))
      ) {
        res.status(404).end();
        return;
      }
      const body = req.body as {
        integrations?: unknown;
        serenaExecutable?: unknown;
      };
      const integrations = body?.integrations;
      if (
        !integrations
        || typeof integrations !== "object"
        || !INTEGRATION_KEYS.every(
          (key) => typeof (integrations as Record<string, unknown>)[key] === "boolean",
        )
      ) {
        res.status(400).json({ error: "Invalid integration profile." });
        return;
      }
      const result = await runningServer.updateIntegrations(
        integrations as Record<IntegrationKey, boolean>,
        typeof body.serenaExecutable === "string"
          ? { serenaExecutable: body.serenaExecutable }
          : undefined,
      );
      if (!result.updated) {
        res.status(409).json({
          error: "An MCP request is active; retry after it finishes.",
          ...result,
        });
        return;
      }
      res.json(result);
    });

    app.post("/__auvrynt/control/shutdown", (req, res) => {
      if (
        !isLoopbackRequest(req)
        || !controlAuthorized(req.header("authorization"))
      ) {
        res.status(404).end();
        return;
      }
      res.status(202).json({ stopping: true });
      setImmediate(() => void requestShutdown?.());
    });
  }

  await new Promise<void>((resolveServer, rejectServer) => {
    const httpServer = app.listen(config.port, config.host, () => {
      if (startMode) {
        printManagedStartBanner(
          config,
          publicMcpUrl,
          godotPlugin.installed,
          godotIsSetup,
          integrationStatus,
        );
      } else {
        printForegroundStartBanner(config);
      }
      hardenHttpServer(httpServer);
      startTunnelHealthMonitor(config);
      logEvent(config.logging, "info", "server_started", {
        pid: process.pid,
        host: config.host,
        port: config.port,
        publicMcpUrl,
        integrations: config.integrations,
      });
    });

    let shutdownPromise: Promise<void> | undefined;
    const removeSignalHandlers = () => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
    };
    const shutdown = (): Promise<void> => {
      if (shutdownPromise) return shutdownPromise;
      clearRuntimeIndicators();
      shutdownPromise = new Promise<void>((resolveShutdown, rejectShutdown) => {
        const forceClose = setTimeout(
          () => httpServer.closeAllConnections(),
          15_000,
        );
        forceClose.unref();
        httpServer.close((error) => {
          clearTimeout(forceClose);
          if (error) {
            rejectShutdown(error);
            return;
          }
          void runningServer.close().then(() => {
            removeSignalHandlers();
            resolveServer();
            resolveShutdown();
          }, rejectShutdown);
        });
      });
      return shutdownPromise;
    };
    requestShutdown = shutdown;

    httpServer.once("error", (error) => {
      removeSignalHandlers();
      void runningServer.close()
        .catch((closeError) => {
          writeFatalLog(config.stateDir, "serverErrorCleanup", closeError);
        })
        .finally(() => rejectServer(error));
    });
    process.once("SIGINT", () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    });
    process.once("SIGTERM", () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    });
  });
}

function printManagedStartBanner(
  config: ReturnType<typeof loadConfig>,
  publicMcpUrl: string,
  godotPluginInstalled: boolean,
  godotIsSetup: boolean,
  integrationStatus: LocalIntegrationDiscovery,
): void {
  console.clear();
  console.log("");
  console.log("  \x1b[36m\x1b[1mAuvrynt: Webkit Arsenal is ready\x1b[0m");
  console.log("");

  const godotBridgeUp = integrationStatus.ports.auvrynt_godot_bridge;
  const blenderBridgeUp = integrationStatus.ports.auvrynt_blender_bridge
    || integrationStatus.ports.blender_lab_mcp;
  const godotConfigured = godotIsSetup || godotPluginInstalled;
  const godotCsharpConfigured = Boolean(config.executables.godotCsharp);
  const serenaConfigured = Boolean(
    process.env.AUVRYNT_SERENA_EXECUTABLE
    || integrationStatus.executables.serena
    || processDetected(integrationStatus, "serena"),
  );
  const playwrightReady = getPlaywrightRuntimeStatus().chromiumInstalled;

  console.log(integrationLine(
    "Godot GDScript:",
    godotBridgeUp,
    godotConfigured,
    config.integrations.godotGdscript,
  ));
  console.log(integrationLine(
    "Godot C#:",
    godotBridgeUp,
    godotCsharpConfigured,
    config.integrations.godotCsharp,
  ));
  console.log(integrationLine(
    "Blender:",
    blenderBridgeUp,
    true,
    config.integrations.blender,
  ));
  console.log(integrationLine(
    "Serena:",
    serenaConfigured,
    serenaConfigured,
    config.integrations.serena,
  ));
  console.log(integrationLine(
    "Playwright:",
    playwrightReady,
    playwrightReady,
    config.integrations.playwright,
  ));
  console.log("");

  console.log("  \x1b[90mDashboard:\x1b[0m");
  console.log(`    \x1b[36m${dashboardUrl(config.host, config.port)}\x1b[0m`);
  console.log("  \x1b[90mWeb Agent connector URL:\x1b[0m");
  console.log(`    \x1b[36m${publicMcpUrl}\x1b[0m`);
  console.log("  \x1b[90mAuthorization page:\x1b[0m");
  console.log(
    `    \x1b[36m${config.publicBaseUrl.replace(/\/$/, "")}/authorize\x1b[0m`,
  );
  console.log("  \x1b[90mOwner token:\x1b[0m");
  console.log(
    "    \x1b[33mhidden — run `auvrynt token` locally to view\x1b[0m",
  );
  console.log("");
  console.log("  \x1b[90mNote:\x1b[0m");
  console.log(`    Web-agent workspace: ${config.allowedRoots.join(", ")}`);
  if (config.tunnelProvider === "ngrok" && config.ngrokUrl) {
    console.log(`    Stable ngrok URL: ${config.ngrokUrl}`);
  } else {
    console.log(
      `    The ${tunnelProviderLabel(config.tunnelProvider)} URL is temporary.`,
    );
    console.log(
      "    Server restarts preserve this URL while the managed tunnel remains healthy.",
    );
  }
  console.log("");
  for (const hint of RUNNING_COMMAND_HINTS) console.log(`  \x1b[90m${hint}\x1b[0m`);
  console.log("");

  if (!process.stdout.isTTY) {
    console.log("[auvrynt] Background logging active.");
    return;
  }

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let mcpEventsCount = 0;
  let lastEvent = "Started successfully";
  (global as any).auvryntLogEmitter = (level: string, event: string) => {
    mcpEventsCount++;
    lastEvent = `${event} (${level})`;
  };
  const interval = setInterval(() => {
    const frame = frames[frameIndex];
    frameIndex = (frameIndex + 1) % frames.length;
    process.stdout.write(
      `\r\x1b[K  \x1b[32m${frame}\x1b[0m Logs active... (${mcpEventsCount} requests handled | Last: ${lastEvent})`,
    );
  }, 100);
  (global as any).auvryntStartInterval = interval;
}

function printForegroundStartBanner(config: ReturnType<typeof loadConfig>): void {
  console.log(`auvrynt listening on ${httpUrl(config.host, config.port, "/mcp")}`);
  console.log(`public base url: ${config.publicBaseUrl}`);
  console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
  console.log(`allowed hosts: ${config.allowedHosts.join(", ")}`);
  if (config.allowedHosts.includes("*")) {
    console.warn(
      "warning: Host header allowlist is disabled because AUVRYNT_ALLOWED_HOSTS=*",
    );
  }
  console.log("auth: Owner token approval required");
  console.log(`logging: ${config.logging.level} ${config.logging.format}`);
}

function integrationLine(
  label: string,
  reachable: boolean,
  configured?: boolean,
  enabled = true,
): string {
  const padded = label.padEnd(20);
  if (!enabled) {
    return `  \x1b[90m${padded}\x1b[0m  \x1b[90mdisabled\x1b[0m`;
  }
  if (reachable) {
    return `  \x1b[90m${padded}\x1b[0m  \x1b[32m200 OK\x1b[0m`;
  }
  if (configured) {
    return `  \x1b[90m${padded}\x1b[0m  \x1b[33moffline\x1b[0m`;
  }
  return `  \x1b[90m${padded}\x1b[0m  \x1b[90mnot configured\x1b[0m`;
}

function clearRuntimeIndicators(): void {
  if ((global as any).auvryntStartInterval) {
    clearInterval((global as any).auvryntStartInterval);
    delete (global as any).auvryntStartInterval;
  }
  if ((global as any).auvryntTunnelCheckInterval) {
    clearInterval((global as any).auvryntTunnelCheckInterval);
    delete (global as any).auvryntTunnelCheckInterval;
  }
  delete (global as any).auvryntLogEmitter;
}
