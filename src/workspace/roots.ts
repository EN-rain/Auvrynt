import { homedir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";

export const MAX_ALLOWED_ROOTS = 5;

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

export function isPathInsideRoot(path: string, root: string): boolean {
  const resolvedPath = canonicalizePath(path);
  const resolvedRoot = canonicalizePath(root);
  const relationship = relative(resolvedRoot, resolvedPath);

  return (
    relationship === "" ||
    (!relationship.startsWith("..") && relationship !== ".." && !relationship.includes(`..${sep}`))
  );
}

export function assertAllowedPath(path: string, allowedRoots: string[]): string {
  const resolvedPath = canonicalizePath(path);
  if (allowedRoots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    // Return the canonical path that was actually authorized rather than the
    // original symlink/junction spelling. This narrows the time-of-check /
    // time-of-use window for callers that subsequently open or mutate it.
    return resolvedPath;
  }

  throw new AccessDeniedError(`Path is outside allowed roots: ${path}`);
}

export function resolveAllowedPath(inputPath: string, cwd: string, allowedRoots: string[]): string {
  const absolutePath = resolve(cwd, inputPath);
  return assertAllowedPath(absolutePath, allowedRoots);
}

/**
 * Resolve the existing portion of a path through symlinks/junctions before
 * applying workspace boundaries. This also handles new files whose parent
 * directory already exists behind a link.
 */
function canonicalizePath(path: string): string {
  const resolved = resolve(expandHomePath(path));
  const missing: string[] = [];
  let existing = resolved;

  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolved;
    missing.unshift(basename(existing));
    existing = parent;
  }

  return resolve(realpathSync.native(existing), ...missing);
}
