import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "../../server/mcp-tool-registrar.js";
import { getRequestContext } from "../../request-context.js";
import {
  findOnPath,
  nativeDoctor,
  readUrl,
  searchPlatform,
  type ReachPlatform,
} from "./native-channels.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const PROCESS_HINT = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Upstream project inspiration: https://github.com/Panniantong/Agent-Reach */
export const AGENT_REACH_REPO = "https://github.com/Panniantong/Agent-Reach";
export const AGENT_REACH_INSTALL_GUIDE =
  "https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md";
export const AGENT_REACH_UPDATE_GUIDE =
  "https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/update.md";

const PLATFORM_ENUM = z.enum([
  "auto",
  "web",
  "rss",
  "v2ex",
  "youtube",
  "github",
  "bilibili",
  "reddit",
  "twitter",
  "xiaohongshu",
  "facebook",
  "instagram",
  "linkedin",
  "xueqiu",
  "exa",
]);

function callerAllowsProcess(): boolean {
  return getRequestContext()?.authScopes.includes("auvrynt:process") ?? false;
}

function text(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

export function registerAgentReachTools(server: McpServer): void {
  registerAppTool(
    server,
    "agent_reach_status",
    {
      title: "Agent Reach status",
      description:
        "Report native Auvrynt Reach capability status (built-in web/RSS/V2EX/Bilibili plus optional upstream CLIs). " +
        "Does not require the external agent-reach package.",
      inputSchema: {},
      annotations: READ_ONLY,
      _meta: {},
    },
    async () => {
      try {
        const [agentReach, ytdlp, gh, opencli, rdt, twitter, mcporter] = await Promise.all([
          findOnPath("agent-reach"),
          findOnPath("yt-dlp"),
          findOnPath("gh"),
          findOnPath("opencli"),
          findOnPath("rdt"),
          findOnPath("twitter"),
          findOnPath("mcporter"),
        ]);
        return text({
          mode: "auvrynt-native",
          nativeChannels: ["web", "rss", "v2ex", "bilibili"],
          optionalCli: {
            "agent-reach": agentReach ?? null,
            "yt-dlp": ytdlp ?? null,
            gh: gh ?? null,
            opencli: opencli ?? null,
            rdt: rdt ?? null,
            twitter: twitter ?? null,
            mcporter: mcporter ?? null,
          },
          tools: ["agent_reach_status", "agent_reach_doctor", "agent_reach_guide", "agent_reach_read", "agent_reach_search"],
          repoInspiration: AGENT_REACH_REPO,
        });
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "agent_reach_doctor",
    {
      title: "Agent Reach doctor",
      description:
        "Probe which internet channels work from this machine (native Auvrynt checks + optional upstream CLIs).",
      inputSchema: {
        json: z.boolean().optional().describe("If true, return structured JSON only. Defaults to true."),
      },
      annotations: PROCESS_HINT,
      _meta: {},
    },
    async ({ json }) => {
      try {
        const channels = await nativeDoctor();
        const ok = channels.filter((c) => c.status === "ok").length;
        const partial = channels.filter((c) => c.status === "partial").length;
        const missing = channels.filter((c) => c.status === "missing").length;
        const report = {
          ok: true,
          mode: "auvrynt-native",
          summary: { ok, partial, missing, total: channels.length },
          channels,
        };
        if (json === false) {
          const lines = [
            "Auvrynt Reach doctor",
            "====================",
            ...channels.map((c) => {
              const mark = c.status === "ok" ? "OK" : c.status === "partial" ? "!" : "X";
              return `[${mark}] ${c.name} — ${c.detail}`;
            }),
            `Summary: ${ok} ok / ${partial} partial / ${missing} missing`,
          ];
          return text({ ok: true, output: lines.join("\n") });
        }
        return text(report);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "agent_reach_guide",
    {
      title: "Agent Reach guide",
      description: "Usage notes for Auvrynt-native Reach tools and optional upstream CLIs.",
      inputSchema: {},
      annotations: READ_ONLY,
      _meta: {},
    },
    async () =>
      text({
        mode: "auvrynt-native",
        tools: {
          agent_reach_read: "Read a URL (auto-detect platform or force platform).",
          agent_reach_search: "Search a platform (web/exa, github, youtube, bilibili, reddit, ...).",
          agent_reach_doctor: "Channel health probe.",
          agent_reach_status: "Installed CLI + native capability summary.",
        },
        zeroConfig: ["web", "rss", "v2ex", "bilibili-search"],
        needsCli: {
          youtube: "yt-dlp",
          github: "gh",
          exa: "mcporter + exa config",
          reddit: "opencli or rdt-cli + login",
          twitter: "twitter-cli cookies or opencli",
          xiaohongshu_facebook_instagram: "opencli + Chrome session",
        },
        optionalExternalPackage: {
          repo: AGENT_REACH_REPO,
          installGuide: AGENT_REACH_INSTALL_GUIDE,
          updateGuide: AGENT_REACH_UPDATE_GUIDE,
          note: "Optional. Auvrynt Reach no longer requires agent-reach CLI for core tools.",
        },
      }),
  );

  registerAppTool(
    server,
    "agent_reach_read",
    {
      title: "Agent Reach read",
      description:
        "Read internet content by URL. Native backends for web (Jina), RSS, V2EX, Bilibili; " +
        "uses yt-dlp/gh/opencli/twitter when installed for other platforms.",
      inputSchema: {
        url: z.string().url().describe("URL to read."),
        platform: PLATFORM_ENUM.optional().describe("Force platform. Default: auto-detect from URL."),
      },
      annotations: READ_ONLY,
      _meta: {},
    },
    async ({ url, platform }) => {
      try {
        const result = await readUrl(url, (platform ?? "auto") as ReachPlatform, {
          allowCli: callerAllowsProcess(),
        });
        return text(result, !result.ok);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "agent_reach_search",
    {
      title: "Agent Reach search",
      description:
        "Search a platform. Supports web/exa, github, youtube, bilibili, v2ex, reddit, twitter, and OpenCLI platforms when available.",
      inputSchema: {
        platform: PLATFORM_ENUM.describe("Platform to search."),
        query: z.string().min(1).describe("Search query."),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
      },
      annotations: READ_ONLY,
      _meta: {},
    },
    async ({ platform, query, limit }) => {
      try {
        if (platform === "auto") {
          return text({ ok: false, error: "Pick an explicit platform for search (e.g. web, github, reddit)." }, true);
        }
        const result = await searchPlatform(platform as ReachPlatform, query, limit ?? 10, {
          allowCli: callerAllowsProcess(),
        });
        return text(result, !result.ok);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );
}
