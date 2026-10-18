import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, opendir, stat } from "node:fs/promises";
import type { WorkspaceMode, WorkspaceStore } from "./workspace-store.js";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import type { ServerConfig } from "../config.js";
import { createManagedWorktree } from "./git-worktrees.js";
import { AccessDeniedError, assertAllowedPath, isPathInsideRoot, resolveAllowedPath } from "./roots.js";
import {
  loadWorkspaceSkills,
  markSkillActivated,
  resolveSkillReadPath,
  type LoadedSkills,
  type SkillReadResolution,
} from "./skills.js";

export interface LoadedAgentsFile {
  path: string;
  content: string;
}

export interface AvailableAgentsFile {
  path: string;
}

export interface WorkspaceWorktree {
  path: string;
  baseRef: string;
  baseSha: string;
  dirtySource: boolean;
  detached: boolean;
  managed: boolean;
}

export interface Workspace {
  id: string;
  root: string;
  mode: WorkspaceMode;
  sourceRoot?: string;
  worktree?: WorkspaceWorktree;
  skills: LoadedSkills["skills"];
  skillDiagnostics: LoadedSkills["diagnostics"];
  activatedSkillDirs: Set<string>;
  closed?: boolean;
}

export interface WorkspaceContext {
  workspace: Workspace;
  agentsFiles: LoadedAgentsFile[];
  availableAgentsFiles: AvailableAgentsFile[];
}

export interface WorkspaceReadPath {
  absolutePath: string;
  readRoots: string[];
  skillRead?: SkillReadResolution;
}

export interface OpenWorkspaceInput {
  path: string;
  mode?: WorkspaceMode;
  baseRef?: string;
}

export interface WorkspaceRegistryOptions {
  maxActiveWorkspaces?: number;
}

const MAX_ACTIVE_WORKSPACES = 128;
const ARTIFACT_DIRECTORY = "auvrynt-logs";

export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly maxActiveWorkspaces: number;
  private pendingWorkspaceOpens = 0;

  constructor(
    private readonly config: ServerConfig,
    private readonly store?: WorkspaceStore,
    options: WorkspaceRegistryOptions = {},
  ) {
    this.maxActiveWorkspaces = Number.isInteger(options.maxActiveWorkspaces)
      && options.maxActiveWorkspaces! > 0
      ? options.maxActiveWorkspaces!
      : MAX_ACTIVE_WORKSPACES;
  }

  async openWorkspace(input: string | OpenWorkspaceInput): Promise<WorkspaceContext> {
    if (this.workspaces.size + this.pendingWorkspaceOpens >= this.maxActiveWorkspaces) {
      throw new Error(`Workspace capacity reached (max ${this.maxActiveWorkspaces} active workspaces). Close an unused workspace before opening another.`);
    }
    this.pendingWorkspaceOpens += 1;
    try {
      const options = typeof input === "string" ? { path: input } : input;
      const mode = options.mode ?? "checkout";
      if (mode === "worktree") {
        return await this.openWorktreeWorkspace(options.path, options.baseRef);
      }
      return await this.openCheckoutWorkspace(options.path);
    } finally {
      this.pendingWorkspaceOpens = Math.max(0, this.pendingWorkspaceOpens - 1);
    }
  }

  markClosed(workspaceId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (workspace) workspace.closed = true;
    this.workspaces.delete(workspaceId);
    this.store?.updateSession(workspaceId, { status: "closed" });
  }

  getWorkspace(workspaceId: string): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (workspace) {
      if (workspace.closed) {
        throw new Error(`Workspace ${workspaceId} has been closed. Call open_workspace to reopen.`);
      }
      this.store?.touchSession(workspaceId);
      return workspace;
    }

    const session = this.store?.getSession(workspaceId);
    if (!session) {
      throw new Error(`Unknown workspaceId: ${workspaceId}. Call open_workspace first.`);
    }
    if (session.status !== "active") {
      throw new Error(`Workspace ${workspaceId} has been closed. Call open_workspace to reopen.`);
    }

    let root = this.assertWorkspaceRootAllowed(session.root, session.mode, session.sourceRoot);
    if (this.workspaces.size + this.pendingWorkspaceOpens >= this.maxActiveWorkspaces) {
      throw new Error(`Workspace capacity reached (max ${this.maxActiveWorkspaces} active workspaces).`);
    }

    if (session.mode === "worktree" && !existsSync(root)) {
      const sourceRoot = session.sourceRoot && assertAllowedPath(session.sourceRoot, this.config.allowedRoots);
      if (!sourceRoot || !existsSync(sourceRoot)) {
        throw new Error(`Stored worktree workspace ${session.id} is missing both its managed worktree and source checkout.`);
      }
      console.warn(`[auvrynt] Worktree directory for session ${session.id} no longer exists at ${root}. Falling back to source checkout ${sourceRoot}.`);
      root = sourceRoot;
      session.mode = "checkout";
      this.store?.updateSession(session.id, { mode: "checkout", root });
    }

    const restoredWorkspace: Workspace = {
      id: session.id,
      root,
      mode: session.mode,
      sourceRoot: session.mode === "worktree" ? session.sourceRoot : undefined,
      worktree:
        session.mode === "worktree"
          ? {
              path: root,
              baseRef: session.baseRef ?? "HEAD",
              baseSha: session.baseSha ?? "",
              dirtySource: false,
              detached: true,
              managed: session.managed,
            }
          : undefined,
      ...this.loadSkillsForWorkspace(root),
      activatedSkillDirs: new Set(),
    };
    this.store?.touchSession(workspaceId);
    this.workspaces.set(restoredWorkspace.id, restoredWorkspace);

    return restoredWorkspace;
  }

  resolvePath(workspace: Workspace, inputPath: string): string {
    const absolutePath = resolveAllowedPath(inputPath, workspace.root, [workspace.root]);
    if (!isPathInsideRoot(absolutePath, workspace.root)) {
      throw new Error(`Path is outside workspace root: ${inputPath}`);
    }

    return absolutePath;
  }

  resolveArtifactPath(workspace: Workspace, inputPath: string, category?: string): string {
    const normalized = inputPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (
      isAbsolute(inputPath) ||
      /^[a-zA-Z]:\//.test(normalized) ||
      normalized.startsWith("//") ||
      normalized.split("/").some((segment) => segment === "..")
    ) {
      throw new AccessDeniedError(`Path is outside allowed roots: ${inputPath}`);
    }

    const withoutRoot = normalized === ARTIFACT_DIRECTORY
      ? ""
      : normalized.startsWith(`${ARTIFACT_DIRECTORY}/`)
        ? normalized.slice(ARTIFACT_DIRECTORY.length + 1)
        : normalized;
    const categoryPath = category && withoutRoot !== category && !withoutRoot.startsWith(`${category}/`)
      ? `${category}/${withoutRoot}`
      : withoutRoot;
    const artifactRoot = join(workspace.root, ARTIFACT_DIRECTORY);
    return resolveAllowedPath(categoryPath || ".", artifactRoot, [artifactRoot]);
  }

  resolveReadPath(workspace: Workspace, inputPath: string): WorkspaceReadPath {
    try {
      return {
        absolutePath: this.resolvePath(workspace, inputPath),
        readRoots: [workspace.root],
      };
    } catch (workspaceError) {
      const skillRead = resolveSkillReadPath(
        workspace.skills,
        workspace.activatedSkillDirs,
        inputPath,
      );
      if (!skillRead) throw workspaceError;

      return {
        absolutePath: skillRead.absolutePath,
        readRoots: [workspace.root, skillRead.skill.baseDir],
        skillRead,
      };
    }
  }

  markReadPathLoaded(workspace: Workspace, readPath: WorkspaceReadPath): void {
    if (readPath.skillRead?.isSkillFile) {
      markSkillActivated(workspace.activatedSkillDirs, readPath.skillRead.skill);
    }
  }

  resolveWorkingDirectory(workspace: Workspace, workingDirectory: string | undefined): string {
    const directory = workingDirectory ? this.resolvePath(workspace, workingDirectory) : workspace.root;
    return assertAllowedPath(directory, [workspace.root]);
  }

  private async openCheckoutWorkspace(path: string): Promise<WorkspaceContext> {
    const root = assertAllowedPath(path, this.config.allowedRoots);
    await mkdir(root, { recursive: true });

    const rootStats = await stat(root);
    if (!rootStats.isDirectory()) {
      throw new Error(`Workspace root must be a directory: ${path}`);
    }

    return this.createWorkspaceContext({ root, mode: "checkout" });
  }

  private async openWorktreeWorkspace(path: string, baseRef: string | undefined): Promise<WorkspaceContext> {
    const worktree = await createManagedWorktree({
      sourcePath: path,
      baseRef,
      config: this.config,
    });

    return this.createWorkspaceContext({
      root: worktree.path,
      mode: "worktree",
      sourceRoot: worktree.sourceRoot,
      worktree,
    });
  }

  private async createWorkspaceContext(input: {
    root: string;
    mode: WorkspaceMode;
    sourceRoot?: string;
    worktree?: WorkspaceWorktree;
  }): Promise<WorkspaceContext> {
    const workspace: Workspace = {
      id: `ws_${randomUUID()}`,
      root: input.root,
      mode: input.mode,
      sourceRoot: input.sourceRoot,
      worktree: input.worktree,
      ...this.loadSkillsForWorkspace(input.root),
      activatedSkillDirs: new Set(),
    };

    const agentsFiles = this.loadInitialAgentsFiles(workspace.root);
    const availableAgentsFiles = await this.findAvailableAgentsFiles(workspace.root, agentsFiles);
    this.store?.createSession({
      id: workspace.id,
      root: workspace.root,
      mode: workspace.mode,
      sourceRoot: workspace.sourceRoot,
      baseRef: workspace.worktree?.baseRef,
      baseSha: workspace.worktree?.baseSha,
      managed: workspace.worktree?.managed,
    });
    this.workspaces.set(workspace.id, workspace);
    return { workspace, agentsFiles, availableAgentsFiles };
  }

  replaceAllowedRoots(roots: string[]): string[] {
    this.config.allowedRoots.splice(0, this.config.allowedRoots.length, ...roots);
    const closedWorkspaceIds: string[] = [];
    for (const [workspaceId, workspace] of this.workspaces) {
      try {
        this.assertWorkspaceRootAllowed(workspace.root, workspace.mode, workspace.sourceRoot);
      } catch (error) {
        if (!(error instanceof AccessDeniedError)) throw error;
        this.markClosed(workspaceId);
        closedWorkspaceIds.push(workspaceId);
      }
    }
    return closedWorkspaceIds;
  }

  private loadSkillsForWorkspace(root: string): Pick<Workspace, "skills" | "skillDiagnostics"> {
    const result = loadWorkspaceSkills(this.config, root);
    return {
      skills: result.skills,
      skillDiagnostics: result.diagnostics,
    };
  }

  private assertWorkspaceRootAllowed(root: string, mode: WorkspaceMode, sourceRoot: string | undefined): string {
    if (mode === "worktree") {
      if (!sourceRoot) {
        throw new Error(`Stored worktree workspace is missing sourceRoot: ${root}`);
      }
      assertAllowedPath(sourceRoot, this.config.allowedRoots);
      return assertAllowedPath(root, [this.config.worktreeRoot]);
    }

    return assertAllowedPath(root, this.config.allowedRoots);
  }

  private loadInitialAgentsFiles(root: string): LoadedAgentsFile[] {
    const agentDir = resolve(this.config.agentDir);

    return loadProjectContextFiles({ cwd: root, agentDir })
      .filter((file) => {
        const path = resolve(file.path);
        if (isPathInsideRoot(path, agentDir)) return true;
        return isPathInsideRoot(path, root) && dirname(path) === root;
      })
      .map((file) => ({
        path: resolve(file.path),
        content: file.content,
      }));
  }

  private async findAvailableAgentsFiles(
    root: string,
    loadedFiles: LoadedAgentsFile[],
  ): Promise<AvailableAgentsFile[]> {
    const loadedPaths = new Set(loadedFiles.map((file) => resolve(file.path)));
    const discovered: AvailableAgentsFile[] = [];

    await walkWorkspace(root, async (path, entry) => {
      if (!entry.isFile()) return;
      if (!CONTEXT_FILE_NAMES.has(entry.name)) return;
      if (loadedPaths.has(path)) return;
      if (discovered.length >= MAX_DISCOVERED_CONTEXT_FILES) return;

      discovered.push({ path });
    });

    return discovered.sort((a, b) => a.path.localeCompare(b.path));
  }
}

const CONTEXT_FILE_NAMES = new Set(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);
const MAX_CONTEXT_SCAN_ENTRIES = 50_000;
const MAX_CONTEXT_SCAN_DEPTH = 16;
const MAX_DISCOVERED_CONTEXT_FILES = 256;
const SKIPPED_CONTEXT_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".auvrynt",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
]);

export function formatAgentsPath(path: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) return path.split(sep).join("/");

  const relationship = relative(workspaceRoot, path);
  if (
    relationship === "" ||
    relationship.startsWith("..") ||
    relationship === ".." ||
    relationship.includes(`..${sep}`)
  ) {
    return path.split(sep).join("/");
  }

  return relationship.split(sep).join("/");
}

async function walkWorkspace(
  directory: string,
  visit: (path: string, entry: { name: string; isFile(): boolean; isDirectory(): boolean }) => Promise<void> | void,
  state: { entries: number; stopped: boolean } = { entries: 0, stopped: false },
  depth = 0,
): Promise<void> {
  if (state.stopped || depth > MAX_CONTEXT_SCAN_DEPTH) return;

  let entries;
  try {
    entries = await opendir(directory);
  } catch {
    return;
  }

  for await (const entry of entries) {
    if (state.stopped) break;
    state.entries += 1;
    if (state.entries > MAX_CONTEXT_SCAN_ENTRIES) {
      state.stopped = true;
      break;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_CONTEXT_DIRS.has(entry.name)) {
        await walkWorkspace(path, visit, state, depth + 1);
      }
      continue;
    }

    await visit(path, entry);
  }
}
