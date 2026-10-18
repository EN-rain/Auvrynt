import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveOpenPencilMcpEntry } from "./open-pencil-client.js";

const installRoot = await mkdtemp(join(tmpdir(), "auvrynt-open-pencil-mcp-"));
try {
  const packageDir = join(installRoot, "node_modules", "@open-pencil", "mcp");
  const binDir = join(packageDir, "dist");
  await mkdir(binDir, { recursive: true });
  const manifest = join(packageDir, "package.json");
  const entry = join(binDir, "stdio.mjs");
  assert.equal(resolveOpenPencilMcpEntry(installRoot), undefined);
  await writeFile(entry, "#!/usr/bin/env node\n");
  await writeFile(manifest, JSON.stringify({
    name: "@open-pencil/mcp",
    bin: { "openpencil-mcp": "dist/stdio.mjs" },
  }));
  assert.equal(resolveOpenPencilMcpEntry(installRoot), entry);
  await writeFile(manifest, JSON.stringify({
    name: "@open-pencil/not-mcp",
    bin: { "openpencil-mcp": "dist/stdio.mjs" },
  }));
  assert.equal(resolveOpenPencilMcpEntry(installRoot), undefined, "reject unrelated npm packages");
  await writeFile(manifest, JSON.stringify({
    name: "@open-pencil/mcp",
    bin: { "openpencil-mcp": "../../../escape.mjs" },
  }));
  assert.equal(resolveOpenPencilMcpEntry(installRoot), undefined, "reject entry traversal");
  await writeFile(manifest, "{bad JSON");
  assert.equal(resolveOpenPencilMcpEntry(installRoot), undefined, "reject corrupt package metadata");
} finally {
  await rm(installRoot, { recursive: true, force: true });
}
console.log("OpenPencil official MCP package discovery tests passed!");
