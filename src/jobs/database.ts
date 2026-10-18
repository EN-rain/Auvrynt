import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

export interface JobsDatabaseHandle {
  sqlite: Database.Database;
  close(): void;
}

export function jobsDatabasePath(stateDir: string): string {
  return join(stateDir, "jobs.sqlite");
}

export function openJobsDatabase(stateDir: string): JobsDatabaseHandle {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(stateDir, 0o700);
  } catch {
    // Best effort on platforms without POSIX permission bits.
  }

  const path = jobsDatabasePath(stateDir);
  const sqlite = new Database(path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // The containing state directory is still private when chmod is unavailable.
  }
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  return { sqlite, close: () => sqlite.close() };
}

export function backupJobsDatabase(stateDir: string): void {
  const source = jobsDatabasePath(stateDir);
  const backup = `${source}.migrate.bak`;
  try {
    copyFileSync(source, backup);
  } catch {
    // A migration backup is best effort; the migration remains transactional.
  }
}
