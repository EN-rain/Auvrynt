import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "../../server/mcp-tool-registrar.js";

const execFileAsync = promisify(execFile);

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

/** Upstream project: https://github.com/Panniantong/Agent-Reach */
export const AGENT_REACH_REPO = "https://github.com/Panniantong/Agent-Reach";
export const AGENT_REACH_INSTALL_GUIDE =
  "https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md";
export const AGENT_REACH_UPDATE_GUIDE =
  "https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/update.md";

const ALLOWED_SUBCOMMANDS = new Set([
  "doctor",
  "--version",
  "-V",
  "version",
  "help",
  "--help",
  "-h",
]);

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

async function findAgentReachExecutable(): Promise<string | undefined> {
  const command = "agent-reach";
  const exes = process.platform === "win32" ? [`${command}.exe`, command] : [command];
  const searchDirs = [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".auvrynt", "bin"),
    join(homedir(), "AppData", "Roaming", "Python", "Scripts"),
    join(homedir(), ".agent-reach-venv", "Scripts"),
    join(homedir(), ".agent-reach-venv", "bin"),
  ];

  for (const dir of searchDirs) {
    for (const exe of exes) {
      const fullPath = join(dir, exe);
      if (existsSync(fullPath)) return fullPath;
    }
  }

  try {
    const whichCmd = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(whichCmd, [command], {
      timeout: 5_000,
      windowsHide: true,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

function assertSafeArgs(args: string[]): void {
  if (args.length === 0) {
    throw new Error("Provide at least one agent-reach argument (e.g. doctor, doctor --json).");
  }
  const head = args[0]!;
  if (!ALLOWED_SUBCOMMANDS.has(head)) {
    throw new Error(
      `Subcommand "${head}" is not allowed via this tool. Allowed: doctor, version, help. ` +
        `For install/configure, follow ${AGENT_REACH_INSTALL_GUIDE} or run agent-reach locally. ` +
        `After install, call upstream tools (twitter, yt-dlp, gh, opencli, etc.) via bash when process scope is available.`,
    );
  }
  for (const arg of args) {
    if (arg.includes("\0") || /[;&|`$<>]/.test(arg)) {
      throw new Error(`Unsafe argument rejected: ${arg}`);
    }
  }
}

async function runAgentReach(
  args: string[],
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const executable = await findAgentReachExecutable();
  if (!executable) {
    throw new Error(
      `agent-reach CLI not found on PATH. Install from ${AGENT_REACH_REPO}. ` +
        `One-line agent install guide: ${AGENT_REACH_INSTALL_GUIDE}`,
    );
  }
  assertSafeArgs(args);
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "", code: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    if (typeof err.stdout === "string" || typeof err.stderr === "string") {
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? (err.message || String(error)),
        code: typeof err.code === "number" ? err.code : 1,
      };
    }
    throw error;
  }
}

export function registerAgentReachTools(server: McpServer): void {
  registerAppTool(
    server,
    "agent_reach_status",
    {
      title: "Agent Reach status",
      description:
        "Detect whether the Agent Reach CLI (https://github.com/Panniantong/Agent-Reach) is installed. " +
        "Agent Reach gives agents free read/search access to Twitter/X, Reddit, YouTube, GitHub, Bilibili, XiaoHongShu, and more. " +
        "Enabled with the web (Playwright) integration profile.",
      inputSchema: {},
      annotations: READ_ONLY,
      _meta: {},
    },
    async () => {
      try {
        const executable = await findAgentReachExecutable();
        if (!executable) {
          return text({
            installed: false,
            executable: null,
            repo: AGENT_REACH_REPO,
            installGuide: AGENT_REACH_INSTALL_GUIDE,
            updateGuide: AGENT_REACH_UPDATE_GUIDE,
            hint:
              "Not installed. Tell the user to install via pipx/pip, or paste the install guide URL to an agent that can run shell installs.",
          });
        }
        let version: string | null = null;
        try {
          const result = await runAgentReach(["--version"], 15_000);
          version = (result.stdout || result.stderr).trim() || null;
        } catch {
          version = null;
        }
        return text({
          installed: true,
          executable,
          version,
          repo: AGENT_REACH_REPO,
          next: "Run agent_reach_doctor for channel health. Prefer upstream CLIs after setup.",
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
        "Run `agent-reach doctor` (optionally --json) to report which internet channels are ready. " +
        "Requires Agent Reach installed locally. Part of the web integration profile.",
      inputSchema: {
        json: z
          .boolean()
          .optional()
          .describe("If true, pass --json for machine-readable output. Defaults to false."),
      },
      annotations: PROCESS_HINT,
      _meta: {},
    },
    async ({ json }) => {
      try {
        const args = json ? ["doctor", "--json"] : ["doctor"];
        const result = await runAgentReach(args, 90_000);
        const body = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        if (result.code !== 0) {
          return text(
            {
              ok: false,
              code: result.code,
              output: body || "doctor failed with no output",
              installGuide: AGENT_REACH_INSTALL_GUIDE,
            },
            true,
          );
        }
        if (json) {
          try {
            return text({ ok: true, report: JSON.parse(body) });
          } catch {
            return text({ ok: true, output: body });
          }
        }
        return text({ ok: true, output: body });
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
      description:
        "Return install/update URLs and usage notes for Agent Reach without running the CLI. " +
        "Use when the CLI is missing or the agent needs setup instructions.",
      inputSchema: {},
      annotations: READ_ONLY,
      _meta: {},
    },
    async () =>
      text({
        repo: AGENT_REACH_REPO,
        installGuide: AGENT_REACH_INSTALL_GUIDE,
        updateGuide: AGENT_REACH_UPDATE_GUIDE,
        agentOneLiner: `Install Agent Reach: ${AGENT_REACH_INSTALL_GUIDE}`,
        updateOneLiner: `Update Agent Reach: ${AGENT_REACH_UPDATE_GUIDE}`,
        platforms: [
          "Web pages (Jina Reader)",
          "YouTube (yt-dlp)",
          "GitHub (gh)",
          "RSS",
          "Bilibili",
          "Twitter/X (cookie)",
          "Reddit (OpenCLI / cookie)",
          "XiaoHongShu",
          "Facebook / Instagram (OpenCLI)",
          "LinkedIn",
          "V2EX",
          "Xueqiu",
          "Web search (Exa)",
        ],
        notes: [
          "Agent Reach is an installer + doctor + router; after setup agents call upstream tools directly.",
          "Auvrynt web profile exposes agent_reach_status / agent_reach_doctor for local health checks.",
          "Cookies stay on the user's machine; prefer secondary accounts for cookie-based platforms.",
          "Playwright tools still handle local app UI verification; Agent Reach covers external platform research.",
        ],
      }),
  );
}
