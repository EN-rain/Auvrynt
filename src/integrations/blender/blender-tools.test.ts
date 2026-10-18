import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { BlenderClient } from "./blender-client.js";
import { sceneCatalogTools } from "./blender-catalog-scene.js";

// Test host enforcement
assert.throws(() => new BlenderClient({ host: "0.0.0.0" }), /Forbidden host/);
assert.throws(() => new BlenderClient({ host: "192.168.1.1" }), /Forbidden host/);

assert.doesNotThrow(() => new BlenderClient({ host: "127.0.0.1" }));
assert.doesNotThrow(() => new BlenderClient({ host: "localhost" }));

const registrationSource = await readFile(
  new URL("../../server/tools/blender-tools-registration.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(registrationSource, /blender-catalog-stubs|stubCatalogTools/);
assert.doesNotMatch(registrationSource, /blender_get_console_errors|blenderGetConsoleErrors/);

const toolSource = await readFile(new URL("./blender-tools.ts", import.meta.url), "utf8");
assert.doesNotMatch(toolSource, /fill_type='\$\{fillType\}'/);
assert.doesNotMatch(toolSource, /type='\$\{lightType\}'/);
assert.doesNotMatch(toolSource, /type='\$\{emptyType\}'/);
assert.doesNotMatch(toolSource, /apply_scale_options='\$\{applyScale\}'/);

const versionTool = sceneCatalogTools.find((tool) => tool.name === "blender_get_blender_version");
assert.ok(versionTool, "blender_get_blender_version must remain registered in the scene catalog");
const versionCode = versionTool.build({}, {} as any);
assert.match(versionCode, /getattr\(bpy\.app, 'build_hash', None\)/, "Blender 5.2 build_hash must be preferred");
assert.match(versionCode, /getattr\(bpy\.app, 'build_commit_hash', b''\)/, "older Blender build_commit_hash must remain a fallback");
assert.match(versionCode, /decode\('utf-8', errors='replace'\)/, "byte version metadata must be decoded to stable strings");
assert.match(versionCode, /'build_date': _stable_text\(getattr\(bpy\.app, 'build_date', ''\)\)/, "Blender build_date bytes must be normalized");

for (const catalogFile of [
  "blender-catalog-scene.ts",
  "blender-catalog-select.ts",
  "blender-catalog-mesh.ts",
  "blender-catalog-object.ts",
]) {
  const catalogSource = await readFile(new URL(`./${catalogFile}`, import.meta.url), "utf8");
  assert.doesNotMatch(catalogSource, /status\s*:\s*["']registered["']/i, `${catalogFile} must not contain registered no-op results`);
  assert.match(catalogSource, /result\s*=/, `${catalogFile} must return an explicit Blender result`);
}

const responseServer = createServer((socket) => {
  socket.once("data", () => {
    socket.end(`${JSON.stringify({ status: "ok", result: false })}\0`);
  });
});
await new Promise<void>((resolve) => responseServer.listen(0, "127.0.0.1", resolve));
try {
  const { port } = responseServer.address() as AddressInfo;
  assert.equal(await new BlenderClient({ port }).sendExecute("result = False"), false);
} finally {
  await new Promise<void>((resolve, reject) => responseServer.close((error) => error ? reject(error) : resolve()));
}

const missingResultServer = createServer((socket) => {
  socket.once("data", () => {
    socket.end(`${JSON.stringify({ status: "ok" })}\0`);
  });
});
await new Promise<void>((resolve) => missingResultServer.listen(0, "127.0.0.1", resolve));
try {
  const { port } = missingResultServer.address() as AddressInfo;
  await assert.rejects(
    () => new BlenderClient({ port }).sendExecute("bpy.ops.wm.save_mainfile()"),
    /explicit result/i,
  );
} finally {
  await new Promise<void>((resolve, reject) => missingResultServer.close((error) => error ? reject(error) : resolve()));
}

console.log("BlenderClient unit tests passed!");
