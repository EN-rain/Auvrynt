import { resolve } from "node:path";
import {
  loadAuvryntFiles,
  writeAuvryntConfig,
  type AuvryntUserConfig,
} from "../user-config.js";
import type { IntegrationKey } from "../background-lifecycle.js";
import { integrationsForProfiles } from "./instance-control.js";
import { isPathInsideRoot, MAX_ALLOWED_ROOTS } from "../workspace/roots.js";

function persistedRootsForWorkspace(existingRoots: string[] | undefined, launchRoot: string): string[] {
  const root = resolve(launchRoot);
  const roots = (existingRoots ?? []).map((entry) => resolve(entry));
  if (roots.some((entry) => isPathInsideRoot(root, entry))) return roots;
  if (roots.length >= MAX_ALLOWED_ROOTS) {
    throw new Error(`Cannot persist workspace ${root}: the maximum of ${MAX_ALLOWED_ROOTS} agent-access directories is already configured.`);
  }
  return [root, ...roots];
}

export function persistedSelectionConfig(
  profiles: IntegrationKey[],
  launchRoot: string,
): AuvryntUserConfig {
  const files = loadAuvryntFiles();
  return {
    ...files.config,
    integrations: integrationsForProfiles(profiles),
    workspaceRoot: resolve(launchRoot),
    allowedRoots: persistedRootsForWorkspace(files.config.allowedRoots, launchRoot),
  };
}

export function persistSelection(profiles: IntegrationKey[], launchRoot: string): void {
  writeAuvryntConfig(persistedSelectionConfig(profiles, launchRoot));
}
