import assert from "node:assert/strict";
import { compareKritaCanvasPng, createKritaCheckpoint, configureKritaCheckpointStore, listKritaCheckpoints } from "./krita-checkpoints.js";

const onePixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const frame = {
  buffer: onePixel,
  mimeType: "image/png" as const,
  format: "png" as const,
  target: "app-window" as const,
  timestamp: new Date().toISOString(),
  sourceWidth: 1,
  sourceHeight: 1,
  width: 1,
  height: 1,
  bounds: { x: 0, y: 0, width: 1, height: 1 },
};
configureKritaCheckpointStore(undefined);
const checkpoint = createKritaCheckpoint("checkpoint-test", frame, { documentPath: "C:/tmp/test.kra" });
assert.match(checkpoint.previewHash, /^sha256:/);
assert.equal(listKritaCheckpoints("checkpoint-test").length, 1);
assert.equal(compareKritaCanvasPng(onePixel, onePixel).equal, true);
assert.throws(() => createKritaCheckpoint("checkpoint-test", frame), /approveUnsavedLocation/i);

console.log("Krita checkpoint tests passed");
