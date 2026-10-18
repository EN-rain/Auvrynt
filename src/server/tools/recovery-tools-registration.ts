import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import { recoveryCoordinatorForStateDir } from "../../process/recovery-core.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

const reconciliationOutcomeSchema = z.enum([
  "verified_applied",
  "verified_no_effect",
  "restored_checkpoint",
  "user_resolved",
]);

export function registerRecoveryTools(server: McpServer, config: ServerConfig): void {
  registerAppTool(server, "recovery_status", {
    title: "Get recovery status",
    description: "Inspect durable Auvrynt recovery state for a workspace. Use this after an unexpected disconnect/restart before retrying a mutation. Read-only inspection remains available even when mutations are blocked by RECOVERY_REQUIRED.",
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    const status = await recoveryCoordinatorForStateDir(config.stateDir).status(workspaceId);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
      structuredContent: { ...status },
    };
  });

  registerAppTool(server, "recovery_reconcile", {
    title: "Reconcile recovery action",
    description: "Resolve one prior-instance mutation whose outcome became unknown after a disconnect/crash. Reconcile only after independently inspecting current application/file state. Requires the current recovery generation so stale reconciliation attempts fail closed.",
    inputSchema: {
      workspaceId: z.string().describe("Workspace identifier returned by open_workspace."),
      actionId: z.string().min(1).describe("Unknown action id returned by recovery_status."),
      expectedRecoveryGeneration: z.number().int().positive().describe("Current recovery generation from recovery_status."),
      outcome: reconciliationOutcomeSchema,
      evidence: z.string().min(1).max(2_000).describe("Concise evidence used to determine what actually happened. Do not include secrets."),
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, actionId, expectedRecoveryGeneration, outcome, evidence }) => {
    const status = await recoveryCoordinatorForStateDir(config.stateDir).reconcile({
      workspaceId,
      actionId,
      expectedRecoveryGeneration,
      outcome,
      evidence,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
      structuredContent: { ...status },
    };
  });
}
