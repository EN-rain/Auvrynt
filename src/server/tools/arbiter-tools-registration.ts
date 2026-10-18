import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import { ArbiterClient, ArbiterClientError, type ArbiterQuestion } from "../../integrations/arbiter/arbiter-client.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import { READ_ONLY_ANNOTATIONS, toolWidgetDescriptorMeta } from "../tool-registration-shared.js";

export const questionSchema = z.object({
  type: z.enum(["choice", "score", "noul"]),
  instructions: z.string().trim().min(1).max(4_000),
  criteria: z.union([
    z.record(z.string().min(1).max(255), z.string().max(1_000)),
    z.array(z.string().min(1).max(255)).min(2).max(255),
  ]).optional(),
}).strict().superRefine((question, ctx) => {
  const criteria = question.criteria;
  if (question.type === "choice" && (!criteria || Object.keys(criteria).length < 2 || Object.keys(criteria).length > 255)) {
    ctx.addIssue({ code: "custom", path: ["criteria"], message: "Choice questions require 2–255 options." });
  }
  if (question.type === "score" && (!Array.isArray(criteria) || criteria.length > 10)) {
    ctx.addIssue({ code: "custom", path: ["criteria"], message: "Score questions require 2–10 level descriptions." });
  }
  if (question.type === "noul" && criteria !== undefined &&
      (Array.isArray(criteria) || Object.keys(criteria).some((key) => key !== "true" && key !== "false"))) {
    ctx.addIssue({ code: "custom", path: ["criteria"], message: "Noul criteria may contain only true and false keys." });
  }
});

const stateSchema = z.union([
  z.string().max(100_000),
  z.record(z.string().max(255), z.unknown()),
]);

export function registerArbiterTools(server: McpServer, config: ServerConfig): void {
  registerAppTool(server, "arbiter_decide", {
    title: "Ask Arbiter for a typed decision",
    description: "Send typed choice, score, or noul questions to the configured authenticated Arbiter service. This is a read-only decision signal, not a generative coding model, test substitute, or deterministic safety validator; never use it alone to authorize destructive actions.",
    inputSchema: {
      state: stateSchema.describe("Text or structured state for the typed decision."),
      questions: z.record(z.string().min(1).max(255), questionSchema),
      model: z.string().min(1).max(128).optional().describe("Optional Arbiter model override; defaults to configured model."),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ state, questions, model }) => {
    try {
      const client = new ArbiterClient({
        endpoint: config.arbiter.endpoint,
        apiKey: config.arbiter.apiKey ?? "",
        model: config.arbiter.model,
        timeoutMs: config.arbiter.timeoutMs,
      });
      const result = await client.decide({
        state,
        questions: questions as Record<string, ArbiterQuestion>,
        model,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: { result },
      };
    } catch (error) {
      if (error instanceof ArbiterClientError) throw new Error(error.message);
      throw new Error("Arbiter decision failed.");
    }
  });
}
