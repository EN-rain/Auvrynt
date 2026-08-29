import { spawn } from "node:child_process";
import type { ServerConfig } from "../config.js";
import { markActiveNgrokAuthtokenQuotaExceeded } from "../infrastructure/ngrok-auth-pool.js";
import { logEvent } from "../logger.js";
import { tunnelProviderLabel, tunnelUrlMatchesProvider } from "../tunnels/tunnel-manager.js";
import { httpUrl } from "./runtime-support.js";
import { loadAuvryntFiles } from "../user-config.js";
import { isCloudflaredProcessRunning, findCloudflaredExecutable, spawnUserCloudflaredProcess } from "../tunnels/cloudflared-service.js";

export function isNgrokQuotaExceededResponse(
  status: number,
  errorCode: string | null | undefined,
  responseBody: string,
): boolean {
  if (status !== 403) return false;
  const normalizedCode = errorCode?.trim().toUpperCase();
  return normalizedCode === "ERR_NGROK_727"
    || responseBody.includes("ERR_NGROK_727")
    || /HTTP requests limit for the month/i.test(responseBody);
}

export function startTunnelHealthMonitor(config: ServerConfig): void {
  if (
    !config.publicBaseUrl
    || !tunnelUrlMatchesProvider(
      config.publicBaseUrl,
      config.tunnelProvider,
      config.ngrokUrl,
    )
  ) {
    return;
  }

  let consecutiveTunnelFailures = 0;
  let recoveryWarningShown = false;
  let quotaFailureHandled = false;
  const failureThreshold = 2;
  const providerLabel = tunnelProviderLabel(config.tunnelProvider);
  const tunnelCheckInterval = setInterval(async () => {
    try {
      const response = await fetch(`${config.publicBaseUrl}/healthz`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        consecutiveTunnelFailures++;
        const ngrokErrorCode = response.headers.get("ngrok-error-code")?.trim().toUpperCase();
        const responseBody = config.tunnelProvider === "ngrok" && response.status === 403
          ? (await response.text().catch(() => "")).slice(0, 4_096)
          : "";
        const quotaExceeded = config.tunnelProvider === "ngrok"
          && isNgrokQuotaExceededResponse(response.status, ngrokErrorCode, responseBody);
        logEvent(config.logging, "warn", "tunnel_health_failed", {
          provider: providerLabel,
          status: response.status,
          ngrokErrorCode,
          consecutiveFailures: consecutiveTunnelFailures,
          publicBaseUrl: config.publicBaseUrl,
        });
        if (quotaExceeded && !quotaFailureHandled) {
          quotaFailureHandled = true;
          handleNgrokQuotaExceeded(config, tunnelCheckInterval, () => {
            quotaFailureHandled = false;
          });
        }
      } else {
        consecutiveTunnelFailures = 0;
        recoveryWarningShown = false;
        quotaFailureHandled = false;
      }
    } catch (error) {
      try {
        const localResponse = await fetch(
          httpUrl(config.host, config.port, "/healthz"),
          { signal: AbortSignal.timeout(2_000) },
        );
        if (localResponse.ok) {
          consecutiveTunnelFailures++;
          logEvent(config.logging, "warn", "tunnel_unreachable", {
            provider: providerLabel,
            consecutiveFailures: consecutiveTunnelFailures,
            failureThreshold,
            localServerHealthy: true,
            error: error instanceof Error ? error.message : String(error),
          });

          // Self-heal custom Cloudflare named tunnels if disconnected
          if (config.tunnelProvider === "custom" && process.platform === "win32") {
            const files = loadAuvryntFiles();
            const token = files.auth.cloudflareTunnelToken || process.env.CLOUDFLARE_TUNNEL_TOKEN;
            if (token && !isCloudflaredProcessRunning() && findCloudflaredExecutable()) {
              logEvent(config.logging, "info", "custom_tunnel_self_heal_reconnect", {
                publicBaseUrl: config.publicBaseUrl,
              });
              spawnUserCloudflaredProcess(token);
            }
          }

          if (consecutiveTunnelFailures >= failureThreshold && !recoveryWarningShown) {
            recoveryWarningShown = true;
            logEvent(config.logging, "warn", "tunnel_recovery_required", {
              provider: providerLabel,
              reason: "Automatic replacement could change the public URL and invalidate the active OAuth issuer/resource configuration.",
              recommendedAction: "Leave Auvrynt running for reconnection, or run `auvrynt restart hard` to create a new URL intentionally.",
            });
          }
        }
      } catch (localError) {
        logEvent(config.logging, "error", "local_server_unreachable", {
          tunnelError: error instanceof Error ? error.message : String(error),
          localError: localError instanceof Error ? localError.message : String(localError),
          recovery: "An external supervisor such as ecosystem.config.js is required for automatic process recovery.",
        });
      }
    }
  }, 60_000);
  tunnelCheckInterval.unref();
  (global as any).auvryntTunnelCheckInterval = tunnelCheckInterval;
}

function handleNgrokQuotaExceeded(
  config: ServerConfig,
  tunnelCheckInterval: NodeJS.Timeout,
  allowRetry: () => void,
): void {
  try {
    const rotation = markActiveNgrokAuthtokenQuotaExceeded();
    logEvent(config.logging, "error", "ngrok_quota_exhausted", {
      errorCode: "ERR_NGROK_727",
      exhaustedFingerprint: rotation.current?.fingerprint,
      savedCredentialCount: rotation.summary.tokens.length,
      environmentOverride: rotation.environmentOverride,
      publicBaseUrl: config.publicBaseUrl,
    });
    if (rotation.next) {
      logEvent(config.logging, "warn", "ngrok_failover_queued", {
        exhaustedFingerprint: rotation.current?.fingerprint,
        nextFingerprint: rotation.next.fingerprint,
        nextIndex: rotation.next.index,
        publicUrlMayChange: !config.ngrokUrl,
      });
      queueNgrokFailoverRestart(config, {
        onSpawned: () => clearInterval(tunnelCheckInterval),
        onFailure: allowRetry,
      });
      return;
    }
    logEvent(config.logging, "error", rotation.environmentOverride
      ? "ngrok_failover_blocked_by_environment"
      : "ngrok_failover_unavailable", {
      savedCredentialCount: rotation.summary.tokens.length,
      exhaustedCredentialCount: rotation.summary.tokens.filter((token) => token.quotaExhaustedAt).length,
      recommendedAction: rotation.environmentOverride
        ? "Remove AUVRYNT_NGROK_AUTHTOKEN, then manage backup tokens from the dashboard Secrets tab."
        : "Add another ngrok authtoken in the dashboard Secrets tab.",
    });
  } catch (error) {
    logEvent(config.logging, "error", "ngrok_failover_state_update_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function queueNgrokFailoverRestart(
  config: ServerConfig,
  callbacks: { onSpawned(): void; onFailure(): void },
): void {
  if (!process.argv[1]) {
    logEvent(config.logging, "error", "ngrok_failover_restart_failed", {
      error: "Restart entrypoint is unavailable.",
    });
    callbacks.onFailure();
    return;
  }
  setTimeout(() => {
    const environment = { ...process.env };
    delete environment.AUVRYNT_START_MODE;
    delete environment.AUVRYNT_CONTROL_TOKEN;
    delete environment.AUVRYNT_MANAGED_TUNNEL_URL;
    delete environment.AUVRYNT_ALLOWED_ROOTS;
    delete environment.AUVRYNT_WORKTREE_ROOT;
    try {
      const child = spawn(process.execPath, [process.argv[1]!, "restart", "hard"], {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: environment,
      });
      child.once("spawn", callbacks.onSpawned);
      child.once("error", (error) => {
        logEvent(config.logging, "error", "ngrok_failover_restart_failed", {
          error: error.message,
        });
        callbacks.onFailure();
      });
      child.unref();
    } catch (error) {
      logEvent(config.logging, "error", "ngrok_failover_restart_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      callbacks.onFailure();
    }
  }, 180).unref();
}
