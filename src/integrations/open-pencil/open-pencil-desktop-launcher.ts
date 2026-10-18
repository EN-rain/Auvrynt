import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";

/** OpenPencil's Windows desktop calls 'openpencil-mcp-http' from %APPDATA%\\npm.
 * The Auvrynt stdio adapter alone cannot start the editor's HTTP/WebSocket bridge.
 * Publish only a managed command shim; never replace an existing user's command. */
const MARKER = "Auvrynt-managed OpenPencil MCP HTTP launcher";
export function resolveOpenPencilHttpEntry(installDir: string): string | undefined {
  const dir = join(installDir, "node_modules", "@open-pencil", "mcp");
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return undefined;
  try {
    const data = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; bin?: Record<string, string> };
    const bin = data.name === "@open-pencil/mcp" ? data.bin?.["openpencil-mcp-http"] : undefined;
    if (!bin || isAbsolute(bin)) return undefined;
    const entry = resolve(dir, bin);
    if (relative(dir, entry).startsWith("..") || !existsSync(entry)) return undefined;
    return entry;
  } catch { return undefined; }
}

export function ensureOpenPencilDesktopLauncher(
  installDir: string,
  roamingAppData = process.env.APPDATA,
  nodeExecutable = process.execPath,
): string {
  if (process.platform !== "win32") return "";
  const entry = resolveOpenPencilHttpEntry(installDir);
  if (!entry) throw new Error("The private official OpenPencil package has no HTTP MCP entry.");
  if (!roamingAppData) throw new Error("APPDATA is missing; OpenPencil desktop launcher cannot be registered.");
  // cmd.exe quoting does not safely handle embedded quotes, newlines or percent expansions.
  if ([nodeExecutable, entry, roamingAppData].some((value) => /["\r\n%]/.test(value))) {
    throw new Error("Unsafe Windows path for OpenPencil MCP launcher.");
  }
  const path = join(roamingAppData, "npm", "openpencil-mcp-http.cmd");
  const content = `@echo off\r\nrem ${MARKER}\r\n"${nodeExecutable}" "${entry}" %*\r\n`;
  if (existsSync(path)) {
    const previous = readFileSync(path, "utf8");
    if (!previous.includes(MARKER)) {
      throw new Error(`An existing openpencil-mcp-http command is not owned by Auvrynt: ${path}`);
    }
    if (previous === content) return path;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: "utf8", flag: "w" });
  return path;
}
