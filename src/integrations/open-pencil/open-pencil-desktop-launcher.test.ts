import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureOpenPencilDesktopLauncher, resolveOpenPencilHttpEntry } from "./open-pencil-desktop-launcher.js";

const root = mkdtempSync(join(tmpdir(), "auvrynt-open-pencil-desktop-"));
try {
  const pkg = join(root, "private", "node_modules", "@open-pencil", "mcp");
  const dist = join(pkg, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({
    name: "@open-pencil/mcp",
    bin: { "openpencil-mcp-http": "dist/index.mjs" },
  }));
  writeFileSync(join(dist, "index.mjs"), "");
  assert.equal(resolveOpenPencilHttpEntry(join(root, "private")), join(dist, "index.mjs"));

  if (process.platform === "win32") {
    const appdata = join(root, "roaming");
    const shim = ensureOpenPencilDesktopLauncher(join(root, "private"), appdata, "C:\\node\\node.exe");
    assert.match(readFileSync(shim, "utf8"), /Auvrynt-managed OpenPencil MCP HTTP launcher/);
    assert.match(readFileSync(shim, "utf8"), /index\.mjs/);
    assert.equal(ensureOpenPencilDesktopLauncher(join(root, "private"), appdata, "C:\\node\\node.exe"), shim);
    writeFileSync(shim, "@echo off\r\nrem user-owned command\r\n");
    assert.throws(() => ensureOpenPencilDesktopLauncher(join(root, "private"), appdata), /not owned/);
  }

  writeFileSync(join(pkg, "package.json"), JSON.stringify({
    name: "@open-pencil/mcp", bin: { "openpencil-mcp-http": "../../../escape.mjs" },
  }));
  assert.equal(resolveOpenPencilHttpEntry(join(root, "private")), undefined);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("OpenPencil desktop HTTP launcher tests passed.");
