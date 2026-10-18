import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import { logEvent } from "../../logger.js";
import type { ProcessManager } from "../../processes.js";
import type { SerenaManager } from "../../serena-manager.js";
import { getRequestContext, requireRequestContext } from "../../request-context.js";
import type { createReviewCheckpointManager } from "../../review-checkpoints.js";
import type { RoomRegistry } from "../../room-registry.js";
import type { SessionRegistry } from "../../session-registry.js";
import { formatPathForPrompt } from "../../skills.js";
import { formatAgentsPath, type WorkspaceRegistry } from "../../workspaces.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import { MUTATING_ANNOTATIONS, PROCESS_ANNOTATIONS, toolWidgetDescriptorMeta } from "../tool-registration-shared.js";
import type { WorkspaceChangeTracker } from "../workspace-analytics.js";
import { cleanupWorkspaceResources } from "../workspace-resource-cleanup.js";

const workspaceSkillOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
});
const workspaceAgentsFileOutputSchema = z.object({ path: z.string(), content: z.string() });
const workspaceAvailableAgentsFileOutputSchema = z.object({ path: z.string() });

type LogToolCall = (config: ServerConfig, fields: {
  tool: string;
  workspaceId?: string;
  path?: string;
  command?: string;
  success: boolean;
  durationMs: number;
  error?: string;
}) => void;

export function registerWorkspaceLifecycleTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  reviewCheckpoints: ReturnType<typeof createReviewCheckpointManager>,
  processManager: ProcessManager,
  serenaManager: SerenaManager,
  roomRegistry: RoomRegistry,
  sessionRegistry: SessionRegistry,
  workspaceChanges: WorkspaceChangeTracker,
  logToolCall: LogToolCall,
): void {
  registerAppTool(server, "open_workspace", {
    title: "Open workspace",
    description: "Open a local project directory as a coding workspace. Call this once per project folder or worktree before reading, editing, searching, writing, showing changes, or running commands. Reuse the returned workspaceId for later calls in the same folder; do not call open_workspace again unless switching folders/worktrees, changing checkout/worktree mode, the workspaceId is rejected as unknown, or the user explicitly asks to reopen. By default this opens the actual checkout; set mode=\"worktree\" when the user asks for an isolated or parallel coding session. Returns a workspaceId, loaded root project instructions, and nested instruction file paths the model should read before working in those directories.",
    inputSchema: {
      path: z.string().describe("Absolute path, or a leading-tilde home path such as ~/project, to a local project directory inside an allowed root."),
      mode: z.enum(["checkout", "worktree"]).optional().describe("Defaults to checkout. Use checkout to work in the actual directory. Use worktree to create an isolated managed Git worktree for parallel work."),
      baseRef: z.string().optional().describe("Git ref to base a worktree on. Only used with mode=\"worktree\". Defaults to HEAD."),
    },
    outputSchema: {
      workspaceId: z.string(),
      root: z.string(),
      mode: z.enum(["checkout", "worktree"]),
      sourceRoot: z.string().optional(),
      worktree: z.object({
        path: z.string(), baseRef: z.string(), baseSha: z.string(), dirtySource: z.boolean(),
        detached: z.boolean(), managed: z.boolean(),
      }).optional(),
      agentsFiles: z.array(workspaceAgentsFileOutputSchema),
      availableAgentsFiles: z.array(workspaceAvailableAgentsFileOutputSchema),
      skills: z.array(workspaceSkillOutputSchema),
      skillDiagnostics: z.array(z.unknown()),
      instruction: z.string(),
    },
    ...toolWidgetDescriptorMeta(config, "workspace"),
    annotations: PROCESS_ANNOTATIONS,
  }, async ({ path, mode, baseRef }) => {
    const startedAt = performance.now();
    const { workspace, agentsFiles, availableAgentsFiles } = await workspaces.openWorkspace({ path, mode, baseRef });
    workspaceChanges.activateWorkspace(workspace.id, workspace.root);
    const ctx = getRequestContext();
    if (ctx) {
      const room = roomRegistry.create(ctx.ownerClientId, workspace.id);
      sessionRegistry.bindWorkspace(ctx.sessionId, room.roomId, workspace.id);
    }
    if (config.widgets === "changes") {
      void reviewCheckpoints.initializeWorkspace({ workspaceId: workspace.id, root: workspace.root }).catch((error) => {
        logEvent(config.logging, "warn", "review_checkpoint_init_failed", {
          workspaceId: workspace.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    const visibleSkills = workspace.skills
      .filter((skill) => !skill.disableModelInvocation)
      .map((skill) => ({ name: skill.name, description: skill.description, path: formatPathForPrompt(skill.filePath) }));
    const loadedAgentsFiles = agentsFiles.map((file) => ({
      path: formatAgentsPath(file.path, workspace.root), content: file.content,
    }));
    const availableAgentsFileOutputs = availableAgentsFiles.map((file) => ({ path: formatAgentsPath(file.path, workspace.root) }));
    const instruction = config.skillsEnabled
      ? "Use this workspaceId in all subsequent tool calls for this project. Do not call open_workspace again for this same folder unless this workspaceId stops working, the user asks to reopen, or you switch to a different folder/worktree. Follow loaded agentsFiles instructions. Before working under a path listed in availableAgentsFiles, read that instruction file. When a task matches an available skill in skills, read its path before proceeding."
      : "Use this workspaceId in all subsequent tool calls for this project. Do not call open_workspace again for this same folder unless this workspaceId stops working, the user asks to reopen, or you switch to a different folder/worktree. Follow loaded agentsFiles instructions. Before working under a path listed in availableAgentsFiles, read that instruction file.";
    const content = [{
      type: "text" as const,
      text: [
        `Opened workspace ${workspace.id}`,
        `Root: ${workspace.root}`,
        `Mode: ${workspace.mode}`,
        loadedAgentsFiles.length > 0 ? `Loaded project instructions: ${loadedAgentsFiles.map((file) => file.path).join(", ")}` : undefined,
        availableAgentsFileOutputs.length > 0 ? `Available nested instructions: ${availableAgentsFileOutputs.map((file) => file.path).join(", ")}` : undefined,
        visibleSkills.length > 0 ? `Available skills: ${visibleSkills.map((skill) => skill.name).join(", ")}` : undefined,
        instruction,
      ].filter(Boolean).join("\n"),
    }];
    logToolCall(config, {
      tool: "open_workspace", workspaceId: workspace.id, path: workspace.root, success: true,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      content,
      _meta: {
        tool: "open_workspace",
        card: {
          workspaceId: workspace.id, root: workspace.root, path: workspace.root,
          summary: {
            agentsFiles: loadedAgentsFiles.length,
            availableAgentsFiles: availableAgentsFileOutputs.length,
            skills: visibleSkills.length,
            skillDiagnostics: workspace.skillDiagnostics.length,
          },
        },
      },
      structuredContent: {
        workspaceId: workspace.id,
        root: workspace.root,
        mode: workspace.mode,
        sourceRoot: workspace.sourceRoot,
        worktree: workspace.worktree,
        agentsFiles: loadedAgentsFiles,
        availableAgentsFiles: availableAgentsFileOutputs,
        skills: visibleSkills,
        skillDiagnostics: workspace.skillDiagnostics,
        instruction,
      },
    };
  });

  registerAppTool(server, "close_workspace", {
    title: "Close workspace",
    description: "Explicitly close an open workspace, stopping its processes and releasing resources. Use this when done working in a workspace to ensure proper cleanup. The workspaceId will no longer be valid after this call.",
    inputSchema: { workspaceId: z.string().describe("Workspace identifier returned by open_workspace.") },
    ...toolWidgetDescriptorMeta(config, "workspace"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    const startedAt = performance.now();
    const ctx = requireRequestContext();
    roomRegistry.requireWorkspaceAccess(ctx.ownerClientId, workspaceId);
    workspaces.getWorkspace(workspaceId);

    try {
      const cleanup = await cleanupWorkspaceResources(workspaceId, processManager, serenaManager);
      try {
        await reviewCheckpoints.releaseWorkspace({ workspaceId });
      } catch (error) {
        logEvent(config.logging, "warn", "review_checkpoint_release_failed", {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      roomRegistry.closeWorkspace(workspaceId);
      sessionRegistry.unbindWorkspaceEverywhere(workspaceId);
      workspaceChanges.deactivateWorkspace(workspaceId);
      workspaces.markClosed(workspaceId);
      logToolCall(config, {
        tool: "close_workspace", workspaceId, success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return {
        content: [{
          type: "text" as const,
          text: `Workspace ${workspaceId} closed. Released ${cleanup.processesStopped} processes, ${cleanup.serenaSessionsStopped} Serena sessions, ${cleanup.browserSessionsClosed} browser sessions, and ${cleanup.desktopStreamsStopped} desktop streams.`,
        }],
      };
    } catch (error) {
      logToolCall(config, {
        tool: "close_workspace",
        workspaceId,
        success: false,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}
