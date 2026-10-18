import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import { getCodexOrchestrator } from "../../integrations/codex/codex-orchestrator.js";
import type { CodexAgentRole } from "../../integrations/codex/codex-types.js";
import { requireRequestContext, type RequestContext } from "../../request-context.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  PROCESS_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

const roleSchema = z.enum([
  "implementation",
  "research",
  "debug",
  "test",
  "review",
  "security-review",
  "integration",
  "refactor",
  "documentation",
  "custom",
]);

const agentBatchItemSchema = z.object({
  role: roleSchema,
  task: z.string().min(1).max(50_000),
  chatName: z.string().trim().min(1).max(120).optional(),
  model: z.string().min(1).max(128).optional(),
  effort: z.string().min(1).max(64).optional(),
});

export function registerCodexTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
): void {
  const orchestrator = getCodexOrchestrator(config);

  registerAppTool(server, "codex_create_run", {
    title: "Create Codex orchestration run",
    description: "Create one Codex orchestration run under the current ChatGPT/Sol conversation. Sol Orchestrator uses normal titled user-visible Codex chats and reuses each worker lane's persistent chat for later tasks in the same conversation instead of creating a new sidebar chat every time.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      goal: z.string().min(1).max(20_000).describe("Overall goal Sol is delegating to visible Codex worker chats."),
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, goal }) => {
    workspaces.getWorkspace(workspaceId);
    const ctx = requireRequestContext();
    const run = orchestrator.createRun({
      ownerClientId: ctx.ownerClientId,
      workspaceId,
      parentMcpSessionId: ctx.sessionId,
      parentLogicalSessionId: ctx.logicalSessionId,
      goal,
    });
    return toolResult("codex_create_run", run);
  });

  registerAppTool(server, "codex_spawn_agent", {
    title: "Deploy Codex subagent",
    description: "Deploy one Codex worker inside an existing orchestration run. Auvrynt reuses the persistent visible Codex chat assigned to that Sol conversation and worker lane when available; otherwise it creates and verifies one normal titled sidebar chat. Hidden-thread fallback is refused. Elastic worker lanes have no fixed Auvrynt ceiling.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      runId: z.string().min(1),
      role: roleSchema,
      task: z.string().min(1).max(50_000),
      chatName: z.string().trim().min(1).max(120).optional().describe("Optional Codex sidebar chat title. A visible title is generated automatically when omitted."),
      model: z.string().min(1).max(128).optional(),
      effort: z.string().min(1).max(64).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, runId, role, task, chatName, model, effort }) => {
    const workspace = workspaces.getWorkspace(workspaceId);
    const ctx = requireRequestContext();
    assertRunWorkspace(orchestrator, ctx, runId, workspaceId);
    const agent = await orchestrator.spawnAgent({
      ownerClientId: ctx.ownerClientId,
      runId,
      workspaceId,
      cwd: workspace.root,
      role: role as CodexAgentRole,
      task,
      chatName,
      model,
      effort,
    });
    return toolResult("codex_spawn_agent", agent);
  });

  registerAppTool(server, "codex_spawn_agents", {
    title: "Deploy Codex worker batch",
    description: "Deploy one or more Codex workers in one call through elastic W<n> lanes. Each lane reuses its existing titled user-visible Codex chat for the current Sol conversation when possible and creates a new verified chat only when no reusable lane chat exists. Hidden-thread fallback is refused. codex_monitor_run supervises them together.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      runId: z.string().min(1),
      agents: z.array(agentBatchItemSchema).min(1),
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, runId, agents }) => {
    const workspace = workspaces.getWorkspace(workspaceId);
    const ctx = requireRequestContext();
    assertRunWorkspace(orchestrator, ctx, runId, workspaceId);
    const results = await orchestrator.spawnAgents({
      ownerClientId: ctx.ownerClientId,
      runId,
      workspaceId,
      cwd: workspace.root,
      agents: agents.map((agent) => ({ ...agent, role: agent.role as CodexAgentRole })),
    });
    const dispatcher = orchestrator.monitorRun(ctx.ownerClientId, runId, 0, 1).dispatcher;
    return toolResult("codex_spawn_agents", { results, dispatcher });
  });

  registerAppTool(server, "codex_send", {
    title: "Steer Codex subagent",
    description: "Send a follow-up instruction to one visible Codex worker chat. If it is actively working, steer its current turn; otherwise start a new turn in the same persistent Codex chat.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      agentId: z.string().min(1),
      instruction: z.string().min(1).max(50_000),
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, agentId, instruction }) => {
    const workspace = workspaces.getWorkspace(workspaceId);
    const ctx = requireRequestContext();
    assertAgentWorkspace(orchestrator, ctx, agentId, workspaceId);
    const agent = await orchestrator.send({
      ownerClientId: ctx.ownerClientId,
      agentId,
      instruction,
      cwd: workspace.root,
    });
    return toolResult("codex_send", agent);
  });

  registerAppTool(server, "codex_status", {
    title: "Read Codex subagent status",
    description: "Read the current state of one Auvrynt-controlled Codex worker chat without switching away from the parent Sol conversation.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, agentId: z.string().min(1) },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, agentId }) => {
    const ctx = requireRequestContext();
    const agent = assertAgentWorkspace(orchestrator, ctx, agentId, workspaceId);
    return toolResult("codex_status", agent);
  });

  registerAppTool(server, "codex_list_agents", {
    title: "List Codex subagents",
    description: "List every visible Codex worker chat in one orchestration run. Prefer codex_monitor_run for normal supervision because it also returns new events.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, runId: z.string().min(1) },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, runId }) => {
    const ctx = requireRequestContext();
    assertRunWorkspace(orchestrator, ctx, runId, workspaceId);
    return toolResult("codex_list_agents", { agents: orchestrator.listAgents(ctx.ownerClientId, runId) });
  });

  registerAppTool(server, "codex_monitor_run", {
    title: "Monitor all Codex subagents",
    description: "Read the aggregate state and newest events for every visible Codex worker chat in a run from this one Sol chat. This is the primary supervision tool. Pass the previous nextSequence as afterSequence to receive only new events.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      runId: z.string().min(1),
      afterSequence: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, runId, afterSequence, limit }) => {
    const ctx = requireRequestContext();
    assertRunWorkspace(orchestrator, ctx, runId, workspaceId);
    return toolResult("codex_monitor_run", orchestrator.monitorRun(
      ctx.ownerClientId,
      runId,
      afterSequence ?? 0,
      limit ?? 200,
    ));
  });

  registerAppTool(server, "codex_read_events", {
    title: "Read Codex run events",
    description: "Read cursor-based normalized events from a Codex orchestration run. Use for deeper evidence after codex_monitor_run, not as the default polling path.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      runId: z.string().min(1),
      afterSequence: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, runId, afterSequence, limit }) => {
    const ctx = requireRequestContext();
    assertRunWorkspace(orchestrator, ctx, runId, workspaceId);
    const events = orchestrator.readEvents(ctx.ownerClientId, runId, afterSequence ?? 0, limit ?? 200);
    return toolResult("codex_read_events", {
      events,
      nextSequence: events.at(-1)?.sequence ?? afterSequence ?? 0,
    });
  });

  registerAppTool(server, "codex_get_result", {
    title: "Get Codex subagent result",
    description: "Read the final compact result for one visible Codex worker chat after it completes. This fetches the persistent Codex thread but returns only the agent state and final message to avoid flooding Sol context.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, agentId: z.string().min(1) },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, agentId }) => {
    const ctx = requireRequestContext();
    assertAgentWorkspace(orchestrator, ctx, agentId, workspaceId);
    const result = await orchestrator.getResult(ctx.ownerClientId, agentId);
    return toolResult("codex_get_result", { agent: result.agent, finalMessage: result.finalMessage });
  });

  registerAppTool(server, "codex_pending_approvals", {
    title: "List Codex approvals",
    description: "List pending approval requests raised by visible Codex worker chats in one run. Auvrynt never silently approves command or file-change requests.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, runId: z.string().min(1) },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, runId }) => {
    const ctx = requireRequestContext();
    assertRunWorkspace(orchestrator, ctx, runId, workspaceId);
    return toolResult("codex_pending_approvals", {
      approvals: orchestrator.pendingApprovals(ctx.ownerClientId, runId),
    });
  });

  registerAppTool(server, "codex_resolve_approval", {
    title: "Resolve Codex approval",
    description: "Explicitly accept, accept for the current Codex session, decline, or cancel a pending command/file-change approval. Never call this without a deliberate approval decision from the parent orchestration flow or user when required by policy.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      approvalKey: z.string().min(1),
      decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, approvalKey, decision }) => {
    const ctx = requireRequestContext();
    const approval = orchestrator.store.getApprovalOwned(approvalKey, ctx.ownerClientId);
    assertAgentWorkspace(orchestrator, ctx, approval.agentId, workspaceId);
    return toolResult(
      "codex_resolve_approval",
      await orchestrator.resolveApproval(ctx.ownerClientId, approvalKey, decision),
    );
  });

  registerAppTool(server, "codex_interrupt", {
    title: "Interrupt Codex subagent",
    description: "Interrupt the active turn of one visible Codex worker chat without closing the parent Sol chat or other workers.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, agentId: z.string().min(1) },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, agentId }) => {
    const ctx = requireRequestContext();
    assertAgentWorkspace(orchestrator, ctx, agentId, workspaceId);
    return toolResult("codex_interrupt", await orchestrator.interrupt(ctx.ownerClientId, agentId));
  });

  registerAppTool(server, "codex_close", {
    title: "Close Codex subagent",
    description: "Retire one Codex worker assignment and release its lane while leaving the normal Codex sidebar chat visible and persistent. A retired lane chat will not be reused automatically; the chat is not archived or hidden.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, agentId: z.string().min(1) },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, agentId }) => {
    const ctx = requireRequestContext();
    assertAgentWorkspace(orchestrator, ctx, agentId, workspaceId);
    return toolResult("codex_close", await orchestrator.closeAgent(ctx.ownerClientId, agentId));
  });

  registerAppTool(server, "codex_complete_run", {
    title: "Complete Codex orchestration run",
    description: "Mark an orchestration run complete after all Codex worker assignments are terminal and Sol has reviewed/integrated the accepted work.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, runId: z.string().min(1) },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, runId }) => {
    const ctx = requireRequestContext();
    assertRunWorkspace(orchestrator, ctx, runId, workspaceId);
    return toolResult("codex_complete_run", orchestrator.completeRun(ctx.ownerClientId, runId));
  });
}

function assertRunWorkspace(
  orchestrator: ReturnType<typeof getCodexOrchestrator>,
  ctx: RequestContext,
  runId: string,
  workspaceId: string,
) {
  const run = orchestrator.store.getRunOwned(runId, ctx.ownerClientId);
  if (run.workspaceId !== workspaceId) throw new Error("Codex run belongs to a different workspace");
  if (run.parentLogicalSessionId) {
    if (ctx.logicalSessionId !== run.parentLogicalSessionId) {
      throw new Error("Codex run belongs to a different ChatGPT conversation");
    }
  } else if (ctx.sessionId !== run.parentMcpSessionId) {
    throw new Error("Codex run belongs to a different MCP session");
  }
  return run;
}

function assertAgentWorkspace(
  orchestrator: ReturnType<typeof getCodexOrchestrator>,
  ctx: RequestContext,
  agentId: string,
  workspaceId: string,
) {
  const agent = orchestrator.status(ctx.ownerClientId, agentId);
  if (agent.workspaceId !== workspaceId) throw new Error("Codex agent belongs to a different workspace");
  assertRunWorkspace(orchestrator, ctx, agent.runId, workspaceId);
  return agent;
}

function toolResult(tool: string, data: unknown) {
  const result = JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text: result }],
    structuredContent: { result, data },
    _meta: { tool },
  };
}
