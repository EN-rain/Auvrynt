import * as prompts from "@clack/prompts";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { expandHomePath } from "../../roots.js";
import {
  generateOwnerToken,
  loadAuvryntFiles,
  writeAuvryntAuth,
  writeAuvryntConfig,
  type AuvryntUserConfig,
} from "../../user-config.js";
import { httpUrl } from "../runtime-support.js";

class SetupCancelledError extends Error {}

type TextPromptOptions = Omit<Parameters<typeof prompts.text>[0], "validate"> & {
  defaultValue: string;
  validate?: (value: string | undefined) => string | Error | undefined;
};

async function textPrompt(options: TextPromptOptions): Promise<string> {
  const result = await prompts.text({
    ...options,
    validate: (value) => options.validate?.(value?.trim() ? value : options.defaultValue),
  });
  if (prompts.isCancel(result)) throw new SetupCancelledError();
  const value = String(result).trim();
  return value || options.defaultValue;
}

function validatePort(value: string | undefined): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? undefined
    : "Enter a port between 1 and 65535.";
}

function validatePublicBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? undefined
      : "Use an http or https URL.";
  } catch {
    return "Enter a valid URL, for example https://your-tunnel-host.example.com.";
  }
}

function validateRequiredPublicBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "Enter the public URL from your tunnel or reverse proxy.";
  if (trimmed.endsWith("/mcp")) return "Enter the base URL only, without /mcp.";
  return validatePublicBaseUrl(trimmed);
}

function normalizePublicBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export async function ensureConfigured(options: { directoryScoped?: boolean } = {}): Promise<void> {
  const files = loadAuvryntFiles();
  if (files.configExists && files.authExists) return;
  if (process.env.AUVRYNT_OAUTH_OWNER_TOKEN) return;

  if (options.directoryScoped) {
    const launchRoot = resolve(process.cwd());
    if (!files.configExists) {
      writeAuvryntConfig({
        host: files.config.host ?? "127.0.0.1",
        port: files.config.port ?? 49321,
        allowedRoots: [launchRoot],
        workspaceRoot: launchRoot,
        publicBaseUrl: files.config.publicBaseUrl ?? `http://127.0.0.1:${files.config.port ?? 49321}`,
      });
    }
    if (!files.authExists) writeAuvryntAuth({ ownerToken: generateOwnerToken() });
    return;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error([
      "Auvrynt is not configured and this terminal is non-interactive.",
      "",
      "Run:",
      "  auvrynt init",
      "",
      "Or provide AUVRYNT_OAUTH_OWNER_TOKEN and AUVRYNT_ALLOWED_ROOTS.",
    ].join("\n"));
  }
  await runInitCommand({ force: false });
}

export async function runInitCommand({ force }: { force: boolean }): Promise<void> {
  const files = loadAuvryntFiles();
  if (!force && files.configExists && files.authExists) {
    prompts.log.info(`Auvrynt is already configured at ${files.dir}`);
    prompts.log.info("Run `auvrynt init --force` to update it.");
    return;
  }

  try {
    prompts.intro("Auvrynt setup");
    const defaultRoots = files.config.allowedRoots?.join(", ") || process.cwd();
    const rootsAnswer = await textPrompt({
      message: `Where are your projects located? Press Enter to use ${defaultRoots}`,
      placeholder: defaultRoots,
      defaultValue: defaultRoots,
      validate: (value) => value?.trim() ? undefined : "Enter at least one project root.",
    });
    const allowedRoots = rootsAnswer.split(",")
      .map((root) => resolve(expandHomePath(root.trim())))
      .filter(Boolean);

    const defaultPort = String(files.config.port ?? 49321);
    const port = Number(await textPrompt({
      message: `Which local port should Auvrynt use? Press Enter to use ${defaultPort}`,
      placeholder: defaultPort,
      defaultValue: defaultPort,
      validate: validatePort,
    }));

    prompts.note([
      "Auvrynt needs a public base URL so ChatGPT, Claude, or Gemini can reach this MCP server.",
      "Create a tunnel or reverse proxy with Cloudflare Tunnel, ngrok, Pinggy, Tailscale Funnel, or your own HTTPS proxy.",
      "Paste the public origin here, without /mcp.",
      "",
      "Example: https://your-tunnel-host.example.com",
    ].join("\n"), "Public URL required");
    const publicBaseUrl = normalizePublicBaseUrl(await textPrompt({
      message: files.config.publicBaseUrl
        ? `What is the public base URL? Press Enter to keep ${files.config.publicBaseUrl}`
        : "What is the public base URL?",
      placeholder: files.config.publicBaseUrl ?? "https://your-tunnel-host.example.com",
      defaultValue: files.config.publicBaseUrl ?? "",
      validate: validateRequiredPublicBaseUrl,
    }));

    const config: AuvryntUserConfig = {
      host: files.config.host ?? "127.0.0.1",
      port,
      allowedRoots,
      workspaceRoot: allowedRoots[0],
      publicBaseUrl,
    };
    const auth = { ownerToken: files.auth.ownerToken ?? generateOwnerToken() };
    const configPath = writeAuvryntConfig(config);
    const authPath = writeAuvryntAuth(auth);
    prompts.note([
      `Config: ${configPath}`,
      `Auth: ${authPath}`,
      `Local MCP URL: ${httpUrl(config.host ?? "127.0.0.1", config.port ?? 49321, "/mcp")}`,
      `Public MCP URL: ${publicBaseUrl}/mcp`,
    ].join("\n"), "Auvrynt configured");
    prompts.note([
      `Owner token: ${auth.ownerToken}`,
      "Use this when ChatGPT, Claude, or Gemini asks you to approve Auvrynt access.",
      `Stored at: ${authPath}`,
    ].join("\n"), "Owner token");
    prompts.outro("Run `auvrynt start` to start the MCP server.");
  } catch (error) {
    if (error instanceof SetupCancelledError) {
      prompts.cancel("Setup cancelled");
      return;
    }
    throw error;
  }
}
