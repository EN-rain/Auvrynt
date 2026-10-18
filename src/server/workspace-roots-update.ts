import type { ServerConfig } from "../config.js";
import { logEvent } from "../logger.js";
import type { ProcessManager } from "../processes.js";
import type { ReviewCheckpointManager } from "../review-checkpoints.js";
import type { RoomRegistry } from "../room-registry.js";
import type { SerenaManager } from "../serena-manager.js";
import type { SessionRegistry } from "../session-registry.js";
import type { WorkspaceRegistry } from "../workspaces.js";
import type { WorkspaceChangeTracker } from "./workspace-analytics.js";
import { cleanupWorkspaceResources } from "./workspace-resource-cleanup.js";

export interface WorkspaceRootsUpdateContext {
  activeToolCalls: number;
  config: ServerConfig;
  workspaces: WorkspaceRegistry;
  processManager: ProcessManager;
  serenaManager: SerenaManager;
  reviewCheckpoints: ReviewCheckpointManager;
  roomRegistry: RoomRegistry;
  sessionRegistry: SessionRegistry;
  workspaceChanges: WorkspaceChangeTracker;
}

export async function executeWorkspaceRootsUpdate(
  roots: string[],
  ctx: WorkspaceRootsUpdateContext,
): Promise<{ updated: boolean; activeToolCalls: number; closedWorkspaces: number; resourceCleanupFailures: number }> {
  if (ctx.activeToolCalls > 0) {
    return { updated: false, activeToolCalls: ctx.activeToolCalls, closedWorkspaces: 0, resourceCleanupFailures: 0 };
  }
  const closedWorkspaceIds = ctx.workspaces.replaceAllowedRoots(roots);
  let resourceCleanupFailures = 0;
  for (const workspaceId of closedWorkspaceIds) {
    try {
      await cleanupWorkspaceResources(workspaceId, ctx.processManager, ctx.serenaManager);
    } catch (error) {
      resourceCleanupFailures++;
      logEvent(ctx.config.logging, "error", "workspace_resource_cleanup_failed", {
        workspaceId,
        reason: "allowed_roots_updated",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await ctx.reviewCheckpoints.releaseWorkspace({ workspaceId });
    } catch (error) {
      logEvent(ctx.config.logging, "warn", "review_checkpoint_release_failed", {
        workspaceId,
        reason: "allowed_roots_updated",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    ctx.roomRegistry.closeWorkspace(workspaceId);
    ctx.sessionRegistry.unbindWorkspaceEverywhere(workspaceId);
    ctx.workspaceChanges.deactivateWorkspace(workspaceId);
  }
  return {
    updated: true,
    activeToolCalls: 0,
    closedWorkspaces: closedWorkspaceIds.length,
    resourceCleanupFailures,
  };
}
