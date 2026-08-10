import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../infrastructure/config.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { globFiles, searchText, inspectProject } from "./search-discovery.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-search-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  // Setup test files
  await mkdir(join(root, "src"));
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "my-app", scripts: { dev: "vite", build: "vite build" }, dependencies: { react: "^19.0.0" } }));
  await writeFile(join(root, "tsconfig.json"), "{}");
  await writeFile(join(root, "src", "main.ts"), "console.log('Hello World');\nconst secret = 'auvrynt';\n");
  await writeFile(join(root, "src", "helper.ts"), "export function help() { return 'helping'; }\n");
  await writeFile(join(root, "node_modules", "ignored.txt"), "should be ignored");

  // 1. globFiles test
  const globRes = await globFiles(registry, { workspaceId, pattern: "*.ts" });
  assert.equal(globRes.files.length, 2);
  assert.ok(globRes.files.includes("src/main.ts"));
  assert.ok(globRes.files.includes("src/helper.ts"));
  assert.ok(!globRes.files.includes("node_modules/ignored.txt"));

  // 2. searchText test
  const searchRes = await searchText(registry, { workspaceId, query: "Hello World" });
  assert.equal(searchRes.matches.length, 1);
  assert.equal(searchRes.matches[0].path, "src/main.ts");
  assert.equal(searchRes.matches[0].line, 1);
  assert.match(searchRes.matches[0].match, /Hello World/);

  // 3. inspectProject test
  const inspectRes = await inspectProject(registry, { workspaceId });
  assert.ok(inspectRes.projectTypes.includes("nodejs"));
  assert.ok(inspectRes.projectTypes.includes("typescript"));
  assert.ok(inspectRes.frameworks.includes("react"));
  assert.equal(inspectRes.recommendedCommands.run, "npm run dev");
  assert.equal(inspectRes.recommendedCommands.build, "npm run build");
} finally {
  await rm(root, { recursive: true, force: true });
}
