import { mkdtemp, mkdir, rm, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../../infrastructure/config.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";
import { executeViewImage } from "./view-image.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-view-image-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  // Setup test image files
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);

  await writeFile(join(root, "sample.png"), pngBytes);
  await writeFile(join(root, "sample.jpg"), jpegBytes);
  await writeFile(join(root, "sample.jpeg"), jpegBytes);
  await writeFile(join(root, "sample.webp"), webpBytes);
  await writeFile(join(root, "vector.svg"), "<svg></svg>");
  await mkdir(join(root, "subfolder"));

  // 1. Successfully reading a PNG
  const pngResult = await executeViewImage(registry, { workspaceId, path: "sample.png" });
  assert.equal(pngResult.isError, undefined);
  assert.equal(pngResult.content.length, 1);
  assert.equal(pngResult.content[0].type, "image");
  if (pngResult.content[0].type === "image") {
    assert.equal(pngResult.content[0].mimeType, "image/png");
  }

  // 8. Confirmation that returned Base64 decodes to original file bytes
  if (pngResult.content[0].type === "image") {
    const decodedBuffer = Buffer.from(pngResult.content[0].data, "base64");
    assert.equal(Buffer.compare(decodedBuffer, pngBytes), 0);
  }

  // 2. Correct MIME type for JPEG and WebP
  const jpgResult = await executeViewImage(registry, { workspaceId, path: "sample.jpg" });
  assert.equal(jpgResult.isError, undefined);
  if (jpgResult.content[0].type === "image") {
    assert.equal(jpgResult.content[0].mimeType, "image/jpeg");
  }

  const jpegResult = await executeViewImage(registry, { workspaceId, path: "sample.jpeg" });
  assert.equal(jpegResult.isError, undefined);
  if (jpegResult.content[0].type === "image") {
    assert.equal(jpegResult.content[0].mimeType, "image/jpeg");
  }

  const webpResult = await executeViewImage(registry, { workspaceId, path: "sample.webp" });
  assert.equal(webpResult.isError, undefined);
  if (webpResult.content[0].type === "image") {
    assert.equal(webpResult.content[0].mimeType, "image/webp");
  }

  // 3. Rejection of unsupported file types (.svg)
  const svgResult = await executeViewImage(registry, { workspaceId, path: "vector.svg" });
  assert.equal(svgResult.isError, true);
  assert.match(svgResult.content[0].type === "text" ? svgResult.content[0].text : "", /Unsupported image extension/i);

  // 4. Rejection of paths outside the workspace
  const outsideResult = await executeViewImage(registry, { workspaceId, path: "../outside.png" });
  assert.equal(outsideResult.isError, true);
  assert.match(outsideResult.content[0].type === "text" ? outsideResult.content[0].text : "", /outside/i);

  // 5. Rejection of directories
  const dirResult = await executeViewImage(registry, { workspaceId, path: "subfolder" });
  assert.equal(dirResult.isError, true);

  // 6. Rejection of oversized images (>20 MB)
  const hugePath = join(root, "huge.png");
  await writeFile(hugePath, Buffer.alloc(100));
  // Set file size to 21 MB via truncate
  await truncate(hugePath, 21 * 1024 * 1024);
  const oversizedResult = await executeViewImage(registry, { workspaceId, path: "huge.png" });
  assert.equal(oversizedResult.isError, true);
  assert.match(oversizedResult.content[0].type === "text" ? oversizedResult.content[0].text : "", /exceeds maximum allowed limit/i);

  // 7. Failure when workspace ID is invalid
  const invalidWsResult = await executeViewImage(registry, { workspaceId: "invalid_ws_id", path: "sample.png" });
  assert.equal(invalidWsResult.isError, true);
  assert.match(invalidWsResult.content[0].type === "text" ? invalidWsResult.content[0].text : "", /Unknown workspaceId/i);
} finally {
  await rm(root, { recursive: true, force: true });
}
