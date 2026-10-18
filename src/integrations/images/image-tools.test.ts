import assert from "node:assert/strict";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../infrastructure/config.js";
import { compareImages, inspectImage, inspectSprite, splitSpriteSheet } from "./image-tools.js";
import { decodePng, encodePng } from "./png-codec.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-img-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  const reference = solidPng(2, 2, [255, 0, 0, 255]);
  const candidatePixels = Buffer.from(decodePng(reference).data);
  candidatePixels.set([0, 0, 255, 255], 0);
  const candidate = encodePng({ width: 2, height: 2, data: candidatePixels });
  const spriteSheet = encodePng({
    width: 4,
    height: 2,
    data: Buffer.from([
      255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255,
      255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255,
    ]),
  });

  await writeFile(join(root, "reference.png"), reference);
  await writeFile(join(root, "candidate.png"), candidate);
  await writeFile(join(root, "sheet.png"), spriteSheet);

  const inspectResult = await inspectImage(registry, { workspaceId, path: "reference.png" });
  assert.equal(inspectResult.isError, undefined);
  const inspectData = textJson(inspectResult);
  assert.equal(inspectData.width, 2);
  assert.equal(inspectData.height, 2);
  assert.equal(inspectData.mimeType, "image/png");
  assert.equal(inspectData.hasAlpha, true);

  const exactResult = await compareImages(registry, {
    workspaceId,
    referencePath: "reference.png",
    candidatePath: "reference.png",
    diffOutputPath: "exact-diff.png",
  });
  const exactData = textJson(exactResult);
  assert.equal(exactData.isExactByteMatch, true);
  assert.equal(exactData.isExactPixelMatch, true);
  assert.equal(exactData.exactMatchPercentage, 100);
  assert.equal(exactData.changedPixels, 0);
  assert.equal(
    (await stat(join(root, "auvrynt-logs", "images", "exact-diff.png"))).isFile(),
    true,
  );

  const changedResult = await compareImages(registry, {
    workspaceId,
    referencePath: "reference.png",
    candidatePath: "candidate.png",
    diffOutputPath: "changed-diff.png",
  });
  const changedData = textJson(changedResult);
  assert.equal(changedData.isExactByteMatch, false);
  assert.equal(changedData.isExactPixelMatch, false);
  assert.equal(changedData.comparedPixels, 4);
  assert.equal(changedData.exactMatchingPixels, 3);
  assert.equal(changedData.matchingPixels, 3);
  assert.equal(changedData.changedPixels, 1);
  assert.equal(changedData.exactMatchPercentage, 75);
  assert.equal(changedData.toleranceMatchPercentage, 75);
  assert.equal(changedData.maxChannelDifference, 255);
  assert.ok(changedData.meanRgbaDifference > 0);

  const thresholdResult = await compareImages(registry, {
    workspaceId,
    referencePath: "reference.png",
    candidatePath: "candidate.png",
    threshold: 255,
  });
  const thresholdData = textJson(thresholdResult);
  assert.equal(thresholdData.isExactPixelMatch, false);
  assert.equal(thresholdData.exactMatchPercentage, 75);
  assert.equal(thresholdData.toleranceMatchPercentage, 100);
  assert.equal(thresholdData.changedPixels, 0);

  const diff = decodePng(await import("node:fs/promises").then(({ readFile }) =>
    readFile(join(root, "auvrynt-logs", "images", "changed-diff.png"))));
  assert.equal(diff.width, 2);
  assert.equal(diff.height, 2);
  assert.deepEqual([...diff.data.subarray(0, 4)], [255, 0, 255, 255]);

  const spriteResult = await inspectSprite(registry, {
    workspaceId,
    path: "sheet.png",
    expectedCellWidth: 2,
    expectedCellHeight: 2,
  });
  const spriteData = textJson(spriteResult);
  assert.equal(spriteData.possibleColumns, 2);
  assert.equal(spriteData.possibleRows, 1);
  assert.equal(spriteData.dividesEvenly, true);

  const splitResult = await splitSpriteSheet(registry, {
    workspaceId,
    path: "sheet.png",
    columns: 2,
    rows: 1,
    outputDirectory: "frames",
  });
  assert.equal(splitResult.isError, undefined);
  assert.match(textContent(splitResult), /frame_0_0\.png/);
  const leftFramePath = join(root, "auvrynt-logs", "images", "frames", "frame_0_0.png");
  const rightFramePath = join(root, "auvrynt-logs", "images", "frames", "frame_1_0.png");
  const { readFile } = await import("node:fs/promises");
  const leftFrame = decodePng(await readFile(leftFramePath));
  const rightFrame = decodePng(await readFile(rightFramePath));
  assert.deepEqual({ width: leftFrame.width, height: leftFrame.height }, { width: 2, height: 2 });
  assert.deepEqual({ width: rightFrame.width, height: rightFrame.height }, { width: 2, height: 2 });
  assert.deepEqual([...leftFrame.data.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...rightFrame.data.subarray(0, 4)], [0, 255, 0, 255]);
  assert.notDeepEqual(leftFrame.data, rightFrame.data);

  await assert.rejects(
    splitSpriteSheet(registry, {
      workspaceId,
      path: "sheet.png",
      columns: 2,
      rows: 1,
      outputDirectory: "unsafe",
      namingPattern: "../../escape_{col}_{row}.png",
    }),
    /safe PNG filename/,
  );
  await assert.rejects(access(join(root, "escape_0_0.png")));

  await assert.rejects(
    splitSpriteSheet(registry, {
      workspaceId,
      path: "sheet.png",
      columns: 2,
      rows: 1,
      outputDirectory: "unsafe-colon",
      namingPattern: "frame:{col}_{row}.png",
    }),
    /safe PNG filename/,
  );

  await assert.rejects(
    splitSpriteSheet(registry, {
      workspaceId,
      path: "sheet.png",
      columns: 2,
      rows: 1,
      outputDirectory: "unsafe-reserved",
      namingPattern: "CON.png",
    }),
    /reserved on Windows/,
  );

  await assert.rejects(
    splitSpriteSheet(registry, {
      workspaceId,
      path: "sheet.png",
      columns: 2,
      rows: 1,
      outputDirectory: "frames",
    }),
    /Refusing to overwrite existing sprite frame/,
  );

  await writeFile(join(root, "malformed.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await assert.rejects(
    inspectImage(registry, { workspaceId, path: "malformed.png" }),
    /too small/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset);
  return encodePng({ width, height, data });
}

function textContent(result: Awaited<ReturnType<typeof inspectImage>>): string {
  return result.content.find((entry) => entry.type === "text")?.text ?? "";
}

function textJson(result: Awaited<ReturnType<typeof inspectImage>>): Record<string, any> {
  return JSON.parse(textContent(result)) as Record<string, any>;
}
