import * as prompts from "@clack/prompts";
import { INTEGRATION_KEYS, INTEGRATION_LABELS, type IntegrationKey } from "../../background-lifecycle.js";
import {
  loadAuvryntFiles,
  writeAuvryntConfig,
  type AuvryntIntegrationsConfig,
} from "../../user-config.js";

export function completeIntegrationsConfig(
  config: AuvryntIntegrationsConfig | undefined,
): Record<IntegrationKey, boolean> {
  return {
    godotGdscript: config?.godotGdscript ?? false,
    godotCsharp: config?.godotCsharp ?? false,
    blender: config?.blender ?? false,
    aseprite: config?.aseprite ?? false,
    serena: config?.serena ?? false,
    playwright: config?.playwright ?? false,
    context7: config?.context7 ?? false,
    obsidian: config?.obsidian ?? false,
    roblox: config?.roblox ?? false,
  };
}

function writeIntegrationConfig(integrations: Record<IntegrationKey, boolean>): void {
  const files = loadAuvryntFiles();
  writeAuvryntConfig({ ...files.config, integrations });
}

export async function ensureIntegrationChoicesConfigured(): Promise<void> {
  const files = loadAuvryntFiles();
  if (files.config.integrations) return;

  prompts.intro("  Auvrynt integrations  ");
  const integrations = completeIntegrationsConfig(undefined);
  for (const key of INTEGRATION_KEYS) {
    const answer = await prompts.confirm({
      message: `Enable ${INTEGRATION_LABELS[key]}?`,
      initialValue: false,
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Integration setup cancelled.");
      process.exit(1);
    }
    integrations[key] = Boolean(answer);
  }

  writeAuvryntConfig({ ...files.config, integrations });
  prompts.outro("Saved integration choices. Change them later with `auvrynt enable` or `auvrynt disable`.");
}

async function runToggleCommand(enable: boolean): Promise<void> {
  const files = loadAuvryntFiles();
  const integrations = completeIntegrationsConfig(files.config.integrations);
  const verb = enable ? "Enable" : "Disable";
  prompts.intro(`  ${verb} Auvrynt integrations  `);

  while (true) {
    prompts.note(
      [
        "0. Done",
        ...INTEGRATION_KEYS.map((key, index) =>
          `${index + 1}. ${INTEGRATION_LABELS[key]}  ${integrations[key] ? "[enabled]" : "[disabled]"}`),
      ].join("\n"),
      "Integrations",
    );
    const picked = await prompts.text({
      message: `Type numbers to ${enable ? "enable" : "disable"}, or 0 when finished`,
      placeholder: "1 3 5 or 0",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "Enter one or more numbers, or 0.";
        const values = raw.split(/[\s,]+/).map(Number);
        if (values.includes(0)) return values.length === 1 ? undefined : "Use 0 by itself when finished.";
        if (values.some((value) => !Number.isInteger(value) || value < 1 || value > INTEGRATION_KEYS.length)) {
          return `Use 0 or numbers from 1 to ${INTEGRATION_KEYS.length}.`;
        }
        const alreadyDesired = values.every((value) => integrations[INTEGRATION_KEYS[value - 1]] === enable);
        if (alreadyDesired) return `Choose at least one ${enable ? "disabled" : "enabled"} integration, or type 0.`;
        return undefined;
      },
    });
    if (prompts.isCancel(picked)) {
      prompts.cancel(`${verb} cancelled.`);
      return;
    }
    const values = String(picked).trim().split(/[\s,]+/).map(Number);
    if (values[0] === 0) break;
    for (const value of new Set(values)) integrations[INTEGRATION_KEYS[value - 1]] = enable;
    writeIntegrationConfig(integrations);
  }

  prompts.outro("Integration settings updated. Restart any running Auvrynt server for the change to take effect.");
}

export function runEnableCommand(): Promise<void> {
  return runToggleCommand(true);
}

export function runDisableCommand(): Promise<void> {
  return runToggleCommand(false);
}
