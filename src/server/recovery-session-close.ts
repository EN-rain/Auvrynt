import type { ServerConfig } from "../config.js";
import { logEvent, sessionIdPrefix } from "../logger.js";
import { recoveryCoordinatorForStateDir } from "../process/recovery-core.js";
import type { SessionRegistry } from "../session-registry.js";

export function markRecoverySessionDisconnected(
  config: ServerConfig,
  sessionRegistry: SessionRegistry,
  sessionId: string,
): void {
  const workspaceId = sessionRegistry.get(sessionId)?.workspaceId;
  if (!workspaceId) return;

  void recoveryCoordinatorForStateDir(config.stateDir)
    .markSessionDisconnected(workspaceId, sessionId)
    .catch((error) => logEvent(config.logging, "error", "recovery_session_disconnect_mark_failed", {
      workspaceId,
      sessionIdPrefix: sessionIdPrefix(sessionId),
      error: error instanceof Error ? error.message : String(error),
    }));
}
