import { existsSync, type Dirent } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { expandHomePath } from "../roots.js";
import {
  discoverLocalIntegrations,
  processDetected,
  type LocalIntegrationDiscovery,
} from "../integration-discovery.js";
import { ensureGlobalGodotPlugin } from "../godot-tools.js";
import { ensureGlobalAsepriteBridge } from "../integrations/aseprite/aseprite-live-tools.js";
import { ensurePlaywrightRuntime } from "../playwright-runtime.js";
import type { IntegrationKey } from "../background-lifecycle.js";
import { findCommand } from "../tunnels/tunnel-utils.js";
import { ensureOpenPencilMcpInstalled, openPencilInstallDirectory, verifyOpenPencilDocuments } from "../integrations/open-pencil/open-pencil-client.js";
import { probeOpenPencilBridge } from "../integrations/open-pencil/open-pencil-health.js";
import { ensureOpenPencilDesktopLauncher } from "../integrations/open-pencil/open-pencil-desktop-launcher.js";

const MANAGED_SERENA_PACKAGE = "serena-agent==1.6.0";
const MANAGED_UV_PACKAGE = "uv==0.11.32";
const MAX_GODOT_PROJECTS = 64;
const MAX_GODOT_PROJECT_DEPTH = 5;
const GODOT_SCAN_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".godot",
  ".svn",
  "auvrynt-logs",
  "bin",
  "node_modules",
  "obj",
]);

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function ensureGodotPluginForLaunchRoot(launchRoot: string): Promise<void> {
  const projectFile = join(launchRoot, "project.godot");
  if (!existsSync(projectFile)) return;

  const sourceDir = join(packageRoot(), "addons", "auvrynt_bridge");
  if (!existsSync(sourceDir)) return;

  const targetDir = join(launchRoot, "addons", "auvrynt_bridge");
  await mkdir(dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });

  const pluginPath = "res://addons/auvrynt_bridge/plugin.cfg";
  let project = await readFile(projectFile, "utf8");
  if (project.includes(`\"${pluginPath}\"`)) return;

  const sectionPattern = /\[editor_plugins\][\s\S]*?(?=\r?\n\[[^\]]+\]|$)/;
  const sectionMatch = project.match(sectionPattern);
  if (sectionMatch) {
    const section = sectionMatch[0];
    const enabledPattern = /enabled\s*=\s*PackedStringArray\(([^)]*)\)/;
    const enabledMatch = section.match(enabledPattern);
    const updatedSection = enabledMatch
      ? section.replace(enabledPattern, (_full, values: string) => {
          const separator = values.trim() ? ", " : "";
          return `enabled=PackedStringArray(${values}${separator}\"${pluginPath}\")`;
        })
      : `${section.trimEnd()}\r\nenabled=PackedStringArray(\"${pluginPath}\")\r\n`;
    project = project.replace(section, updatedSection);
  } else {
    project = `${project.trimEnd()}\r\n\r\n[editor_plugins]\r\n\r\nenabled=PackedStringArray(\"${pluginPath}\")\r\n`;
  }

  await writeFile(projectFile, project, "utf8");
}

export async function findGodotProjectRoots(
  launchRoot: string,
  maxDepth = MAX_GODOT_PROJECT_DEPTH,
): Promise<string[]> {
  const projects: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (projects.length >= MAX_GODOT_PROJECTS || depth > maxDepth) return;
    if (existsSync(join(directory, "project.godot"))) {
      projects.push(directory);
      return;
    }

    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (projects.length >= MAX_GODOT_PROJECTS) return;
      if (!entry.isDirectory() || GODOT_SCAN_EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      await visit(join(directory, entry.name), depth + 1);
    }
  };

  await visit(resolve(launchRoot), 0);
  return projects;
}

export async function selfHealStartIntegrations(
  launchRoot: string,
  executables: Record<string, string | undefined>,
  integrations: Record<IntegrationKey, boolean>,
  options: { requireOpenPencilDocument?: boolean } = {},
): Promise<{ serenaExecutable?: string }> {
  let serenaExecutable: string | undefined;
  if (integrations.serena) {
    process.env.AUVRYNT_SERENA_ENABLED = "true";
    serenaExecutable = await ensureSerenaExecutable();
    process.env.AUVRYNT_SERENA_EXECUTABLE = serenaExecutable;
    if (!isSerenaExecutableUsable(serenaExecutable)) {
      throw new Error(
        `Serena executable is not runnable after installation: ${serenaExecutable}`,
      );
    }
  } else {
    process.env.AUVRYNT_SERENA_ENABLED = "false";
  }

  if (integrations.openPencil) {
    const discovery = await discoverLocalIntegrations({ forceRefresh: true });
    if (discovery.executables.openPencil || processDetected(discovery, "openPencil")) {
      try {
        await ensureOpenPencilMcpInstalled();
        ensureOpenPencilDesktopLauncher(openPencilInstallDirectory());
        const bridge = await probeOpenPencilBridge();
        if (bridge.state === "connected") {
          const documents = await verifyOpenPencilDocuments(launchRoot);
          if (!documents.connected && options.requireOpenPencilDocument) throw new Error(documents.detail);
          if (!documents.connected) console.warn(`[auvrynt] OpenPencil not connected: ${documents.detail}`);
        } else {
          if (options.requireOpenPencilDocument) {
            throw new Error(`OpenPencil's own MCP server has not attached to its editor: ${bridge.detail} The official editor does not expose a remote restart endpoint; Auvrynt cannot safely reload an open unsaved design.`);
          }
          console.warn(`[auvrynt] OpenPencil not connected: ${bridge.detail}`);
        }
      } catch (error) {
        if (options.requireOpenPencilDocument) throw error;
        console.warn(`[auvrynt] OpenPencil MCP setup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (integrations.playwright) ensurePlaywrightRuntime();
  if (integrations.aseprite) {
    try {
      await ensureGlobalAsepriteBridge();
    } catch (error) {
      console.warn(`[auvrynt] Could not install the Aseprite live bridge: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!integrations.godotGdscript && !integrations.godotCsharp) {
    return { serenaExecutable };
  }

  ensureGlobalGodotPlugin();
  const godotProjectRoots = await findGodotProjectRoots(launchRoot);
  for (const projectRoot of godotProjectRoots) {
    await ensureGodotPluginForLaunchRoot(projectRoot);
  }
  if (godotProjectRoots.length === 0) {
    return { serenaExecutable };
  }

  let discovery: LocalIntegrationDiscovery = await discoverLocalIntegrations({ forceRefresh: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (discovery.ports.auvrynt_godot_bridge) return { serenaExecutable };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    discovery = await discoverLocalIntegrations({ forceRefresh: true });
  }

  if (processDetected(discovery, "godot")) {
    console.warn(
      `[auvrynt] Installed/enabled the Auvrynt bridge in ${godotProjectRoots.length} workspace Godot project(s). `
      + "Godot is already running but the bridge is not reachable; reopen the intended project editor once so Godot loads the addon.",
    );
    return { serenaExecutable };
  }

  const godotExecutable = integrations.godotCsharp
    ? executables.godotCsharp
      || executables.godot
      || discovery.executables.godotCsharp
      || discovery.executables.godot
    : executables.godot || discovery.executables.godot;

  const launchProjectRoot = godotProjectRoots.length === 1 ? godotProjectRoots[0] : undefined;
  if (godotExecutable && existsSync(godotExecutable) && launchProjectRoot) {
    const child = spawn(godotExecutable, ["--editor", "--path", launchProjectRoot], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    console.log("[auvrynt] Godot editor launched with Auvrynt bridge plugin.");
  }

  return { serenaExecutable };
}

/**
 * Probe a Serena command without allowing a broken launcher to make the
 * dashboard mutation fail with an opaque child-process exception.
 */
export function isSerenaExecutableUsable(executable: string): boolean {
  try {
    execFileSync(executable, ["--version"], {
      timeout: 15_000,
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function serenaExecutableCandidates(): string[] {
  const candidates = [findCommand("serena"), findInstalledExecutable("serena")];
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

function findWorkingSerenaExecutable(): string | undefined {
  return serenaExecutableCandidates().find((candidate) => isSerenaExecutableUsable(candidate));
}

async function ensureSerenaExecutable(): Promise<string> {
  const existing = findWorkingSerenaExecutable();
  if (existing) return existing;

  const broken = serenaExecutableCandidates()[0];
  if (broken) {
    console.warn(
      `[auvrynt] Serena executable ${broken} failed its --version probe; reinstalling a managed copy.`,
    );
  }

  const configuredLocalSource = process.env.AUVRYNT_SERENA_LOCAL_SOURCE?.trim();
  const localSource = configuredLocalSource
    ? resolve(expandHomePath(configuredLocalSource))
    : undefined;
  if (localSource && !existsSync(join(localSource, "pyproject.toml"))) {
    throw new Error(
      `AUVRYNT_SERENA_LOCAL_SOURCE does not contain pyproject.toml: ${localSource}`,
    );
  }

  const uv = await ensureUvExecutable();
  console.log(
    localSource
      ? `Serena is not installed; installing explicitly configured local source ${localSource}...`
      : `Serena is not installed; installing pinned ${MANAGED_SERENA_PACKAGE}...`,
  );
  const installArgs = localSource
    ? ["tool", "install", "--force", "--editable", localSource]
    : ["tool", "install", "--force", MANAGED_SERENA_PACKAGE];
  execFileSync(uv, installArgs, { stdio: "inherit", windowsHide: true });

  const installed = findWorkingSerenaExecutable();
  if (!installed) {
    throw new Error(
      "Serena was installed but no working executable was found. Restart PowerShell and run `where.exe serena`.",
    );
  }
  return installed;
}

async function ensureUvExecutable(): Promise<string> {
  const existing = findCommand("uv");
  if (existing) return existing;

  const python = findCommand("py") ?? findCommand("python");
  if (!python) {
    throw new Error(
      "Serena requires uv, and Python was not found to install it automatically.",
    );
  }

  console.log(
    `uv is not installed; installing pinned ${MANAGED_UV_PACKAGE} for Serena...`,
  );
  execFileSync(
    python,
    ["-m", "pip", "install", "--user", MANAGED_UV_PACKAGE],
    { stdio: "inherit", windowsHide: true },
  );

  const installed = findCommand("uv") ?? findInstalledExecutable("uv");
  if (!installed) {
    throw new Error(
      "uv was installed but its executable is not available. Restart PowerShell and run `uv --version`.",
    );
  }
  return installed;
}

function findInstalledExecutable(name: string): string | undefined {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [
    join(homedir(), ".local", "bin", executable),
    join(process.env.LOCALAPPDATA ?? "", "uv", "bin", executable),
    join(process.env.APPDATA ?? "", "uv", "bin", executable),
    join(process.env.APPDATA ?? "", "Python", "Python313", "Scripts", executable),
    join(process.env.APPDATA ?? "", "Python", "Python312", "Scripts", executable),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}
