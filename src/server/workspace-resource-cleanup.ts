import type { ProcessManager } from "../processes.js";
import type { SerenaManager } from "../serena-manager.js";
import {
  activeBrowserSessionCount,
  closeBrowserSessionsForWorkspace,
} from "../integrations/playwright/browser-session.js";
import {
  activeDesktopStreamCount,
  stopDesktopStreamsForWorkspace,
} from "../integrations/desktop/desktop-stream.js";
import {
  desktopIndicatorActive,
  stopDesktopIndicator,
} from "../integrations/desktop/desktop-indicator.js";
import {
  clearDesktopControlStateForWorkspace,
} from "../integrations/desktop/desktop-input.js";

export interface WorkspaceResourceCleanupResult {
  processesStopped: number;
  serenaSessionsStopped: number;
  browserSessionsClosed: number;
  desktopStreamsStopped: number;
  desktopIndicatorStopped: boolean;
  desktopControlStateCleared: boolean;
}

export async function cleanupWorkspaceResources(
  workspaceId: string,
  processManager: ProcessManager,
  serenaManager: SerenaManager,
): Promise<WorkspaceResourceCleanupResult> {
  const serenaSessionsStopped = serenaManager.getSessionInfo()
    .filter((session) => session.workspaceId === workspaceId).length;
  const expectedBrowserSessions = activeBrowserSessionCount(workspaceId);
  const expectedDesktopStreams = activeDesktopStreamCount(workspaceId);
  const desktopIndicatorStopped = desktopIndicatorActive(workspaceId);

  const desktopStreamsStopped = stopDesktopStreamsForWorkspace(workspaceId);
  stopDesktopIndicator(workspaceId);
  const desktopControlStateCleared = clearDesktopControlStateForWorkspace(workspaceId).cleared;

  const [processResult, serenaResult, browserResult] = await Promise.allSettled([
    processManager.stopAllProcessesForWorkspace(workspaceId),
    serenaManager.stopWorkspaceSessions(workspaceId),
    closeBrowserSessionsForWorkspace(workspaceId),
  ]);

  if (
    processResult.status === "rejected"
    || serenaResult.status === "rejected"
    || browserResult.status === "rejected"
  ) {
    const failures: unknown[] = [];
    if (processResult.status === "rejected") failures.push(processResult.reason);
    if (serenaResult.status === "rejected") failures.push(serenaResult.reason);
    if (browserResult.status === "rejected") failures.push(browserResult.reason);
    throw new AggregateError(
      failures,
      `Failed to release all transient resources for workspace ${workspaceId}.`,
    );
  }

  const browserSessionsClosed = browserResult.value;
  if (browserSessionsClosed !== expectedBrowserSessions) {
    throw new Error(
      `Browser workspace cleanup closed ${browserSessionsClosed} of ${expectedBrowserSessions} expected session(s) for ${workspaceId}.`,
    );
  }
  if (desktopStreamsStopped !== expectedDesktopStreams) {
    throw new Error(
      `Desktop workspace cleanup stopped ${desktopStreamsStopped} of ${expectedDesktopStreams} expected stream(s) for ${workspaceId}.`,
    );
  }

  return {
    processesStopped: processResult.value,
    serenaSessionsStopped,
    browserSessionsClosed,
    desktopStreamsStopped,
    desktopIndicatorStopped,
    desktopControlStateCleared,
  };
}
