export interface WorkspaceChangeAnalytics {
  workspaceId?: string;
  workspaceRoot?: string;
  filesCreated: number;
  filesDeleted: number;
  filesModified: number;
  additions: number;
  removals: number;
  startedAt: string;
  sampledAt: string;
}

export type WorkspaceMutationKind = "created" | "modified" | "deleted";

export interface WorkspaceMutation {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  kind: WorkspaceMutationKind;
  additions: number;
  removals: number;
}

export interface WorkspaceChangeTracker {
  activateWorkspace(workspaceId: string, workspaceRoot: string): void;
  deactivateWorkspace(workspaceId: string): boolean;
  recordMutation(mutation: WorkspaceMutation): void;
  snapshot(): WorkspaceChangeAnalytics;
}

interface WorkspaceActivity {
  workspaceId: string;
  workspaceRoot: string;
  startedAt: string;
  updatedAt: string;
  createdPaths: Set<string>;
  modifiedPaths: Set<string>;
  deletedPaths: Set<string>;
  additions: number;
  removals: number;
}

export function createWorkspaceChangeTracker(now: () => Date = () => new Date()): WorkspaceChangeTracker {
  const workspaces = new Map<string, WorkspaceActivity>();
  let activeWorkspaceKey: string | undefined;

  const ensureWorkspace = (workspaceId: string, workspaceRoot: string): [string, WorkspaceActivity] => {
    const key = workspaceKey(workspaceRoot);
    const existing = workspaces.get(key);
    if (existing) {
      existing.workspaceId = workspaceId;
      existing.workspaceRoot = workspaceRoot;
      return [key, existing];
    }

    const timestamp = now().toISOString();
    const activity: WorkspaceActivity = {
      workspaceId,
      workspaceRoot,
      startedAt: timestamp,
      updatedAt: timestamp,
      createdPaths: new Set(),
      modifiedPaths: new Set(),
      deletedPaths: new Set(),
      additions: 0,
      removals: 0,
    };
    workspaces.set(key, activity);
    return [key, activity];
  };

  return {
    activateWorkspace(workspaceId, workspaceRoot) {
      const [key] = ensureWorkspace(workspaceId, workspaceRoot);
      activeWorkspaceKey = key;
    },

    deactivateWorkspace(workspaceId) {
      let removed = false;
      for (const [key, activity] of workspaces) {
        if (activity.workspaceId !== workspaceId) continue;
        workspaces.delete(key);
        if (activeWorkspaceKey === key) activeWorkspaceKey = undefined;
        removed = true;
      }
      return removed;
    },

    recordMutation(mutation) {
      const [key, activity] = ensureWorkspace(mutation.workspaceId, mutation.workspaceRoot);
      const path = normalizePath(mutation.path);
      activeWorkspaceKey = key;
      activity.updatedAt = now().toISOString();
      activity.additions += normalizeCount(mutation.additions);
      activity.removals += normalizeCount(mutation.removals);

      if (mutation.kind === "created") activity.createdPaths.add(path);
      if (mutation.kind === "modified") activity.modifiedPaths.add(path);
      if (mutation.kind === "deleted") activity.deletedPaths.add(path);
    },

    snapshot() {
      const activity = activeWorkspaceKey ? workspaces.get(activeWorkspaceKey) : undefined;
      if (!activity) return emptyWorkspaceAnalytics(now().toISOString());

      return {
        workspaceId: activity.workspaceId,
        workspaceRoot: activity.workspaceRoot,
        filesCreated: activity.createdPaths.size,
        filesDeleted: activity.deletedPaths.size,
        filesModified: activity.modifiedPaths.size,
        additions: activity.additions,
        removals: activity.removals,
        startedAt: activity.startedAt,
        sampledAt: activity.updatedAt,
      };
    },
  };
}

export function countTextLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function workspaceKey(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function emptyWorkspaceAnalytics(timestamp: string): WorkspaceChangeAnalytics {
  return {
    filesCreated: 0,
    filesDeleted: 0,
    filesModified: 0,
    additions: 0,
    removals: 0,
    startedAt: timestamp,
    sampledAt: timestamp,
  };
}
