#!/usr/bin/env node
import { resolve } from "node:path";
import { parseStartRequest } from "./background-lifecycle.js";
import { runServeCommand } from "./cli/commands/serve-command.js";
import { runTunnelCommand } from "./cli/commands/tunnel-command.js";
import { runCloudflareCommand } from "./cli/commands/cloudflare-command.js";
import { printHelp } from "./cli/commands/help-command.js";
import {
  runConfigCommand,
  runConnectedCommand,
  runTokenCommand,
  runUninstallCommand,
} from "./cli/commands/user-config-commands.js";
import {
  assertSupportedNode,
  runDoctorCommand,
  runStatusCommand,
} from "./cli/commands/status-commands.js";
import {
  runDisableCommand,
  runEnableCommand,
} from "./cli/commands/integration-commands.js";
import { runSetupCommand } from "./cli/commands/setup-command.js";
import { ensureConfigured, runInitCommand } from "./cli/commands/init-command.js";
import { createLifecycleManager } from "./cli/lifecycle-manager.js";
import { selfHealStartIntegrations } from "./cli/integration-bootstrap.js";

const lifecycle = createLifecycleManager(selfHealStartIntegrations);

type Command =
  | "serve"
  | "init"
  | "doctor"
  | "status"
  | "connected"
  | "token"
  | "uninstall"
  | "config"
  | "setup"
  | "enable"
  | "disable"
  | "add"
  | "change"
  | "stop"
  | "restart"
  | "tunnel"
  | "cloudflare"
  | "help";

async function main(argv: string[]): Promise<void> {
  assertSupportedNode();
  const [rawCommand, ...args] = argv;
  const command = normalizeCommand(rawCommand);

  switch (command) {
    case "serve":
      await runServeCommand(rawCommand, args, lifecycle);
      return;
    case "init":
      await runInitCommand({ force: args.includes("--force") });
      return;
    case "doctor":
      await runDoctorCommand();
      return;
    case "status":
      await runStatusCommand({
        readActiveInstance: lifecycle.readActiveInstance,
      });
      return;
    case "connected":
      runConnectedCommand();
      return;
    case "token":
      runTokenCommand(args);
      return;
    case "uninstall":
      await runUninstallCommand(args.includes("--yes") || args.includes("-y"));
      return;
    case "config":
      runConfigCommand(args);
      return;
    case "setup":
      await runSetupCommand(args);
      return;
    case "enable":
      await runEnableCommand();
      return;
    case "disable":
      await runDisableCommand();
      return;
    case "add":
      await lifecycle.addProfiles(args);
      return;
    case "change": {
      if (args.length > 0) throw new Error("Usage: auvrynt change");
      const launchRoot = setDirectoryScopedRoot();
      await ensureConfigured({ directoryScoped: true });
      await lifecycle.changeWorkspace(launchRoot);
      return;
    }
    case "stop":
      await lifecycle.stop();
      return;
    case "tunnel":
      await runTunnelCommand({
        readActiveInstance: lifecycle.readActiveInstance,
        restart: lifecycle.restart,
      });
      return;
    case "cloudflare":
      await runCloudflareCommand(args);
      return;
    case "restart": {
      const hard = args[0]?.toLowerCase() === "hard";
      const restartRequest = parseStartRequest(hard ? args.slice(1) : args);
      // Restart must reload the persisted allowed-root list. Directory-scoping
      // belongs to `change`; applying it here would silently hide additional
      // dashboard-managed directories after every restart.
      const launchRoot = resolve(process.cwd());
      await ensureConfigured({ directoryScoped: true });
      await lifecycle.restart(restartRequest, launchRoot, hard);
      return;
    }
    case "help":
      printHelp();
      return;
  }
}

function normalizeCommand(command: string | undefined): Command {
  if (!command || command === "serve" || command === "start") return "serve";
  if (command === "init" || command === "doctor" || command === "config") {
    return command;
  }
  if (
    command === "status"
    || command === "connected"
    || command === "token"
    || command === "uninstall"
  ) {
    return command;
  }
  if (
    command === "setup"
    || command === "enable"
    || command === "disable"
    || command === "add"
    || command === "change"
    || command === "stop"
    || command === "restart"
    || command === "tunnel"
    || command === "cloudflare"
  ) {
    return command;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    return "help";
  }
  throw new Error(`Unknown command: ${command}`);
}

function setDirectoryScopedRoot(): string {
  const launchRoot = resolve(process.cwd());
  process.env.AUVRYNT_ALLOWED_ROOTS = launchRoot;
  process.env.AUVRYNT_WORKTREE_ROOT = launchRoot;
  return launchRoot;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
