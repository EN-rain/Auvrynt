import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool as registerExtAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { ServerConfig } from "../config.js";
import type { WorkspaceRegistry } from "../workspaces.js";
import type { RoomRegistry } from "../room-registry.js";
import { assertBlenderWorkspaceBound } from "../blender-tools.js";
import { getRequestContext, runWithContext } from "../request-context.js";
import { enqueueIntegration } from "../integration-queue.js";
import { registerToolCapability } from "../tool-capabilities.js";
import { limitToolResultPayload } from "../tool-result-budget.js";
import {
  recoveryCoordinatorForStateDir,
  type RecoveryToolAnnotations,
} from "../process/recovery-core.js";
import {
  godotToolBelongsToIntegration,
  godotToolFamily,
  hasRequiredScopes,
  isGodotToolName,
  requiredScopesForToolCall,
  requiredScopesForToolName,
  toolIntegrationEnabled,
} from "./mcp-policy.js";

export interface McpToolGuardContext {
  config: ServerConfig;
  workspaces: WorkspaceRegistry;
  rooms: RoomRegistry;
}

const guards = new WeakMap<McpServer, McpToolGuardContext>();
const registeredTools = new WeakMap<McpServer, Map<string, RegisteredTool>>();
const toolInventory = new Map<string, string>();
const BLENDER_UNBOUND_TOOL_NAMES = new Set([
  "blender_ping",
  "blender_get_current_file",
  "blender_open_file",
  "blender_save_file_as",
  "blender_list_checkpoints",
]);

export function integrationKeyForTool(name: string): string {
  if (name.startsWith("blender_")) return "blender";
  if (name.startsWith("aseprite_")) return "aseprite";
  const godotFamily = godotToolFamily(name);
  if (godotFamily) return godotFamily;
  if (name.startsWith("serena_")) return "serena";
  if (name.startsWith("codex_")) return "solOrchestrator";
  if (name.startsWith("agent_reach_")) return "agentReach";
  if (name.startsWith("desktop_")) return "desktop";
  if (name.startsWith("krita_")) return "krita";
  if (name.startsWith("roblox_")) return "roblox";
  if (name.startsWith("openpencil_")) return "openPencil";
  if (name.startsWith("arbiter_")) return "core";
  if (
    name.startsWith("browser_")
    || ["capture_page_screenshot", "inspect_page", "test_responsive_page"].includes(name)
  ) return "playwright";
  return "core";
}

function inventoryKeysForDashboardIntegration(integration: string): string[] {
  if (integration === "godotCsharp") return ["godotCsharp", "godotShared", "godot"];
  if (integration === "godotGdscript") return ["godotGdscript", "godotShared", "godot"];
  return [integration];
}

export function registeredToolNamesForIntegration(integration: string): string[] {
  const keys = new Set(inventoryKeysForDashboardIntegration(integration));
  return Array.from(toolInventory.entries())
    .filter(([name, key]) => {
      if (!keys.has(key)) return false;
      if (integration === "godotCsharp" || integration === "godotGdscript") {
        return godotToolBelongsToIntegration(name, integration) || key === integration;
      }
      return true;
    })
    .map(([name]) => name);
}

export function toolInventoryEnabledCount(integration: string, config: ServerConfig): number {
  return registeredToolNamesForIntegration(integration)
    .filter((name) => toolIntegrationEnabled(config, name)).length;
}

function bumpCount(
  counts: Record<string, { total: number; enabled: number }>,
  key: string,
  enabled: boolean,
): void {
  const entry = counts[key] ?? { total: 0, enabled: 0 };
  entry.total += 1;
  if (enabled) entry.enabled += 1;
  counts[key] = entry;
}

export function integrationToolCounts(config: ServerConfig): Record<string, { total: number; enabled: number }> {
  const counts: Record<string, { total: number; enabled: number }> = {};
  for (const [name, key] of toolInventory) {
    const enabled = toolIntegrationEnabled(config, name);
    if (key === "godotShared" || key === "godot" || isGodotToolName(name)) {
      const family = godotToolFamily(name) ?? (key as "godotCsharp" | "godotGdscript" | "godotShared");
      if (family === "godotCsharp") bumpCount(counts, "godotCsharp", enabled);
      else if (family === "godotGdscript") bumpCount(counts, "godotGdscript", enabled);
      else {
        bumpCount(counts, "godotCsharp", enabled);
        bumpCount(counts, "godotGdscript", enabled);
      }
      continue;
    }
    bumpCount(counts, key, enabled);
  }
  return counts;
}

export function configureMcpToolGuard(server: McpServer, context: McpToolGuardContext): void {
  guards.set(server, context);
  if (!registeredTools.has(server)) registeredTools.set(server, new Map());
}

export function syncMcpToolAvailability(
  server: McpServer,
  config: ServerConfig,
): { enabled: number; disabled: number } {
  const tools = registeredTools.get(server);
  if (!tools) return { enabled: 0, disabled: 0 };

  let enabled = 0;
  let disabled = 0;
  for (const [name, tool] of tools) {
    const shouldEnable = toolIntegrationEnabled(config, name);
    if (shouldEnable && !tool.enabled) {
      tool.enable();
      enabled++;
    } else if (!shouldEnable && tool.enabled) {
      tool.disable();
      disabled++;
    }
  }
  return { enabled, disabled };
}

function recoveryAnnotationsFromToolConfig(toolConfig: unknown): RecoveryToolAnnotations | undefined {
  if (!toolConfig || typeof toolConfig !== "object" || !("annotations" in toolConfig)) return undefined;
  const annotations = (toolConfig as { annotations?: unknown }).annotations;
  if (!annotations || typeof annotations !== "object") return undefined;
  const candidate = annotations as RecoveryToolAnnotations;
  return {
    readOnlyHint: candidate.readOnlyHint,
    destructiveHint: candidate.destructiveHint,
    idempotentHint: candidate.idempotentHint,
  };
}

export const registerAppTool = ((server: McpServer, name: string, toolConfig: unknown, handler: Function) => {
  const requiredScopes = requiredScopesForToolName(name);
  const guard = guards.get(server);
  if (guard && !hasRequiredScopes(guard.config.oauth.scopes, requiredScopes)) return undefined;
  registerToolCapability(name);

  const guardedHandler = async (...args: unknown[]) => {
    const input = args[0];
    const extra = args.at(-1) as { authInfo?: { clientId?: string; scopes?: string[] } } | undefined;
    const requestContext = getRequestContext();
    const ownerClientId = requestContext?.ownerClientId ?? extra?.authInfo?.clientId;
    const callScopes = requiredScopesForToolCall(name, input);

    if (guard && !toolIntegrationEnabled(guard.config, name)) {
      throw new Error(`Forbidden: ${name} integration is disabled by the local profile`);
    }
    if (!extra?.authInfo?.scopes || !hasRequiredScopes(extra.authInfo.scopes, callScopes)) {
      throw new Error(`Forbidden: ${name} requires ${callScopes.join(" + ")}`);
    }

    let workspaceId: string | undefined;
    if (guard && input && typeof input === "object" && "workspaceId" in input) {
      const candidate = (input as { workspaceId?: unknown }).workspaceId;
      if (typeof candidate === "string") {
        if (!ownerClientId) throw new Error("Forbidden: workspace access requires an authenticated OAuth client");
        guard.rooms.requireWorkspaceAccess(ownerClientId, candidate);
        guard.workspaces.getWorkspace(candidate);
        workspaceId = candidate;
        if (name.startsWith("blender_") && !BLENDER_UNBOUND_TOOL_NAMES.has(name)) {
          await assertBlenderWorkspaceBound(guard.workspaces, candidate);
        }
      }
    }

    const invokeHandler = async () => {
      const recovery = guard && workspaceId && !name.startsWith("recovery_")
        ? recoveryCoordinatorForStateDir(guard.config.stateDir)
        : undefined;
      const tracked = recovery
        ? await recovery.beginToolCall({
            workspaceId: workspaceId!,
            sessionId: requestContext?.sessionId,
            integration: integrationKeyForTool(name),
            toolName: name,
            input,
            annotations: recoveryAnnotationsFromToolConfig(toolConfig),
          })
        : undefined;

      try {
        const result = limitToolResultPayload(await Reflect.apply(handler, undefined, args));
        if (tracked && recovery) await recovery.finishToolCall(workspaceId!, tracked.actionId);
        return result;
      } catch (error) {
        if (tracked && recovery) {
          try {
            await recovery.finishToolCall(workspaceId!, tracked.actionId, error);
          } catch (recoveryError) {
            throw new AggregateError(
              [error, recoveryError],
              `Tool ${name} failed and its recovery journal could not be settled.`,
            );
          }
        }
        throw error;
      }
    };
    const invokeByIntegration = () => {
      if (name.startsWith("blender_")) return enqueueIntegration("blender", invokeHandler);
      if (name.startsWith("aseprite_")) return enqueueIntegration("aseprite", invokeHandler);
      if (name.startsWith("godot_")) return enqueueIntegration("godot", invokeHandler);
      if (name.startsWith("serena_")) return enqueueIntegration("serena", invokeHandler);
      if (name.startsWith("roblox_")) return enqueueIntegration("roblox", invokeHandler);
      if (name.startsWith("openpencil_")) return enqueueIntegration("openPencil", invokeHandler);
      if (name.startsWith("desktop_")) return enqueueIntegration("desktop", invokeHandler);
      if (name.startsWith("krita_")) return enqueueIntegration("krita", invokeHandler);
      return invokeHandler();
    };

    if (requestContext && workspaceId) {
      const room = guard?.rooms.requireWorkspaceAccess(requestContext.ownerClientId, workspaceId);
      return runWithContext({
        ...requestContext,
        workspaceId,
        roomId: room?.roomId,
      }, invokeByIntegration);
    }
    return invokeByIntegration();
  };

  const registered = Reflect.apply(
    registerExtAppTool,
    undefined,
    [server, name, toolConfig, guardedHandler],
  ) as RegisteredTool | undefined;
  if (!registered) return undefined;
  if (!toolInventory.has(name)) toolInventory.set(name, integrationKeyForTool(name));

  const tools = registeredTools.get(server) ?? new Map<string, RegisteredTool>();
  tools.set(name, registered);
  registeredTools.set(server, tools);
  if (guard && !toolIntegrationEnabled(guard.config, name)) {
    registered.disable();
  }
  return registered;
}) as unknown as typeof registerExtAppTool;
