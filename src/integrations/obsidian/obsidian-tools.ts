import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "../../server/mcp-tool-registrar.js";
import type { ServerConfig } from "../../config.js";
import { expandHomePath } from "../../roots.js";
import { createInterface } from "node:readline";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MUTATING = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

function text(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function resolveVaultRoot(config: ServerConfig): string {
  const raw = config.obsidian.vaultPath?.trim();
  if (!raw) {
    throw new Error(
      "Obsidian vault path is not configured. Set AUVRYNT_OBSIDIAN_VAULT or config.obsidian.vaultPath to your vault folder.",
    );
  }
  return resolve(expandHomePath(raw));
}

function assertInsideVault(vaultRoot: string, target: string): string {
  const absolute = resolve(vaultRoot, target);
  const root = vaultRoot.endsWith(sep) ? vaultRoot : vaultRoot + sep;
  if (absolute !== vaultRoot && !absolute.startsWith(root)) {
    throw new Error("Path escapes the configured Obsidian vault.");
  }
  return absolute;
}

async function listMarkdownFiles(vaultRoot: string, subdir = "", limit = 200): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (results.length >= limit) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".obsidian") continue;
        await walk(full);
      } else if (entry.isFile() && ["md", "markdown"].includes(extname(entry.name).slice(1).toLowerCase())) {
        results.push(relative(vaultRoot, full).replace(/\\/g, "/"));
      }
    }
  }
  const start = subdir ? assertInsideVault(vaultRoot, subdir) : vaultRoot;
  if (!existsSync(start)) throw new Error(`Vault path not found: ${start}`);
  await walk(start);
  return results;
}

export function registerObsidianTools(server: McpServer, config: ServerConfig): void {
  registerAppTool(
    server,
    "obsidian_status",
    {
      title: "Obsidian vault status",
      description: "Report the configured Obsidian vault path and whether it exists on disk.",
      inputSchema: {},
      annotations: READ_ONLY,
      _meta: {},
    },
    async () => {
      try {
        const vaultPath = config.obsidian.vaultPath
          ? resolve(expandHomePath(config.obsidian.vaultPath))
          : null;
        const exists = vaultPath ? existsSync(vaultPath) : false;
        let noteCount: number | null = null;
        if (exists && vaultPath) {
          noteCount = (await listMarkdownFiles(vaultPath, "", 5_000)).length;
        }
        return text({
          configured: Boolean(vaultPath),
          vaultPath,
          exists,
          noteCount,
        });
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "obsidian_list_notes",
    {
      title: "List Obsidian notes",
      description: "List markdown notes under the configured Obsidian vault (relative paths).",
      inputSchema: {
        subdir: z.string().optional().describe("Optional subdirectory relative to the vault root."),
        limit: z.number().int().min(1).max(2000).optional().describe("Max notes to return (default 200)."),
      },
      annotations: READ_ONLY,
      _meta: {},
    },
    async ({ subdir, limit }) => {
      try {
        const vault = resolveVaultRoot(config);
        const notes = await listMarkdownFiles(vault, subdir ?? "", limit ?? 200);
        return text({ vault, count: notes.length, notes });
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "obsidian_read_note",
    {
      title: "Read Obsidian note",
      description: "Read a markdown note from the configured Obsidian vault by relative path.",
      inputSchema: {
        path: z.string().min(1).describe("Note path relative to the vault root (e.g. Projects/idea.md)."),
      },
      annotations: READ_ONLY,
      _meta: {},
    },
    async ({ path }) => {
      try {
        const vault = resolveVaultRoot(config);
        const absolute = assertInsideVault(vault, path);
        const content = await readFile(absolute, "utf8");
        const info = await stat(absolute);
        return text({
          path: relative(vault, absolute).replace(/\\/g, "/"),
          bytes: info.size,
          modifiedAt: info.mtime.toISOString(),
          content,
        });
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "obsidian_search",
    {
      title: "Search Obsidian vault",
      description: "Case-insensitive full-text search across markdown notes in the configured vault.",
      inputSchema: {
        query: z.string().min(1).describe("Text to search for."),
        limit: z.number().int().min(1).max(100).optional().describe("Max matching notes (default 25)."),
      },
      annotations: READ_ONLY,
      _meta: {},
    },
    async ({ query, limit }) => {
      try {
        const vault = resolveVaultRoot(config);
        const notes = await listMarkdownFiles(vault, "", 5_000);
        const needle = query.toLowerCase();
        const max = limit ?? 25;
        const matches: Array<{ path: string; line: number; preview: string }> = [];
        for (const note of notes) {
          if (matches.length >= max) break;
          const absolute = join(vault, note);
          const stream = createReadStream(absolute, { encoding: "utf8" });
          const rl = createInterface({ input: stream, crlfDelay: Infinity });
          let lineNo = 0;
          for await (const line of rl) {
            lineNo += 1;
            if (line.toLowerCase().includes(needle)) {
              matches.push({ path: note, line: lineNo, preview: line.trim().slice(0, 240) });
              if (matches.length >= max) break;
            }
          }
        }
        return text({ vault, query, count: matches.length, matches });
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  registerAppTool(
    server,
    "obsidian_write_note",
    {
      title: "Write Obsidian note",
      description: "Create or overwrite a markdown note in the configured Obsidian vault.",
      inputSchema: {
        path: z.string().min(1).describe("Note path relative to the vault root. .md is appended if missing."),
        content: z.string().describe("Full markdown body to write."),
        append: z.boolean().optional().describe("If true, append to an existing note instead of replacing."),
      },
      annotations: MUTATING,
      _meta: {},
    },
    async ({ path, content, append }) => {
      try {
        const vault = resolveVaultRoot(config);
        let rel = path.replace(/\\/g, "/");
        if (!rel.toLowerCase().endsWith(".md") && !rel.toLowerCase().endsWith(".markdown")) {
          rel = `${rel}.md`;
        }
        const absolute = assertInsideVault(vault, rel);
        await mkdir(dirname(absolute), { recursive: true });
        if (append && existsSync(absolute)) {
          const previous = await readFile(absolute, "utf8");
          await writeFile(absolute, `${previous}${previous.endsWith("\n") ? "" : "\n"}${content}`, "utf8");
        } else {
          await writeFile(absolute, content, "utf8");
        }
        return text({
          path: relative(vault, absolute).replace(/\\/g, "/"),
          bytes: Buffer.byteLength(content, "utf8"),
          append: Boolean(append),
        });
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );
}
