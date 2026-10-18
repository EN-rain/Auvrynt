import type { SessionRegistry } from "../session-registry.js";
import type { ProcessManager } from "../processes.js";
import type { SerenaManager } from "../serena-manager.js";
import type { DatabaseHandle } from "../db/client.js";
import { disconnectAllGodotEditorBridges } from "../godot-editor-bridge.js";
import { clearBlenderClients } from "../blender-client.js";
import { logEvent } from "../logger.js";
import type { ServerConfig } from "../config.js";
import { closeAllBrowserSessions } from "../integrations/playwright/browser-session.js";
import { stopAllDesktopStreams } from "../integrations/desktop/desktop-stream.js";
import { stopAllDesktopIndicators } from "../integrations/desktop/desktop-indicator.js";
import { clearAllDesktopControlState } from "../integrations/desktop/desktop-input.js";
import { disconnectOpenPencil } from "../integrations/open-pencil/open-pencil-client.js";

export type ShutdownPhase =
  | "none"
  | "clients_notified"
  | "sessions_closed"
  | "processes_terminated"
  | "integrations_disconnected"
  | "database_closed";

export interface ShutdownCoordinator {
  phase: ShutdownPhase;
  shutdown(): Promise<void>;
}

export function createShutdownCoordinator(
  config: Pick<ServerConfig, "logging">,
  sessionRegistry: SessionRegistry,
  processManager: ProcessManager,
  serenaManager: SerenaManager,
  workspaceStore: { close?(): void },
): ShutdownCoordinator {
  let phase: ShutdownPhase = "none";
  let shutdownPromise: Promise<void> | undefined;

  return {
    get phase() {
      return phase;
    },
    shutdown(): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {

      const log = (msg: string, p: ShutdownPhase) => {
        phase = p;
        logEvent(config.logging, "info", "shutdown", { phase: p, message: msg });
      };

      log("Closing MCP sessions...", "sessions_closed");
      await sessionRegistry.closeAll("server_shutdown");
      sessionRegistry.close();

      log("Terminating processes...", "processes_terminated");
      const terminationResults = await Promise.allSettled([
        serenaManager.stopAllSessions(),
        processManager.stopAllProcesses(),
        closeAllBrowserSessions(),
        disconnectOpenPencil(),
      ]);
      const terminationFailures = terminationResults
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      stopAllDesktopStreams();
      stopAllDesktopIndicators();
      clearAllDesktopControlState();

      log("Disconnecting integrations...", "integrations_disconnected");
      disconnectAllGodotEditorBridges();
      clearBlenderClients();

      log("Closing database...", "database_closed");
      workspaceStore.close?.();

      if (terminationFailures.length > 0) {
        logEvent(config.logging, "error", "shutdown_cleanup_failed", {
          failures: terminationFailures.map((error) => error instanceof Error ? error.message : String(error)),
        });
        throw new AggregateError(terminationFailures, "One or more resources failed to terminate during shutdown.");
      }

        log("Shutdown complete", "database_closed");
      })();
      return shutdownPromise;
    },
  };
}
