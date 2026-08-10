import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "../../server/mcp-tool-registrar.js";
import {
  resolveContext7ApiKey,
  summarizeContext7Auth,
  context7ApiKeyFingerprint,
} from "../../infrastructure/context7-auth.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function text(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function context7Get(path: string, params: Record<string, string>): Promise<unknown> {
  const key = resolveContext7ApiKey();
  if (!key) {
    throw new Error("Context7 API key is not configured. Add it in the Secrets tab or set AUVRYNT_CONTEXT7_API_KEY.");
  }
  const url = new URL(`https://context7.com${path}`);
  for (const [param, value] of Object.entries(params)) {
    if (value) url.searchParams.set(param, value);
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  let parsed: unknown = body;
  try {
    parsed = JSON.parse(body);
  } catch {
    // keep raw text
  }
  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : body.slice(0, 500);
    throw new Error(`Context7 HTTP ${response.status}: ${message}`);
  }
  return parsed;
}

export function registerContext7Tools(server: McpServer): void {
  registerAppTool(
    server,
    "context7_resolve_library",
    {
      title: "Resolve Context7 library",
      description:
        "Search Context7 for a library by name and return matching library IDs (e.g. /vercel/next.js). Use before context7_query_docs when the exact ID is unknown.",
      inputSchema: {
        libraryName: z.string().min(1).describe("Library or package name to search for (e.g. next.js, react, zod)."),
        query: z.string().optional().describe("Optional task/question used to rank matches by relevance."),
      },
      annotations: READ_ONLY,
      _meta: {},
    },
    async ({ libraryName, query }) => {
      try {
        const data = await context7Get("/api/v2/libs/search", {
          libraryName,
          query: query ?? libraryName,
        });
        return text(data);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "context7_query_docs",
    {
      title: "Query Context7 docs",
      description:
        "Fetch up-to-date documentation snippets for a Context7 library ID. Prefer resolve_library first when the ID is unknown.",
      inputSchema: {
        libraryId: z
          .string()
          .min(2)
          .describe("Exact Context7 library ID such as /vercel/next.js or /mongodb/docs."),
        query: z.string().min(1).describe("Natural-language question or task to retrieve relevant docs for."),
        type: z.enum(["json", "txt"]).optional().describe("Response type. Defaults to json."),
      },
      annotations: READ_ONLY,
      _meta: {},
    },
    async ({ libraryId, query, type }) => {
      try {
        const data = await context7Get("/api/v2/context", {
          libraryId,
          query,
          type: type ?? "json",
        });
        return text(data);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "context7_status",
    {
      title: "Context7 status",
      description: "Report whether a Context7 API key is configured (fingerprint only; the key is never returned).",
      inputSchema: {},
      annotations: READ_ONLY,
      _meta: {},
    },
    async () => {
      const summary = summarizeContext7Auth();
      return text({
        configured: summary.configured,
        fingerprint: summary.fingerprint ?? null,
        environmentOverride: summary.environmentOverride,
      });
    },
  );
}
