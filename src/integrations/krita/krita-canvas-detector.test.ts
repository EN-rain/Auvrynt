import assert from "node:assert/strict";
import { detectKritaCanvasRegion, type RgbaImage } from "./krita-canvas-detector.js";

function image(width: number, height: number, color: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data.set(color, index);
  }
  return { width, height, data };
}

function fill(imageValue: RgbaImage, x: number, y: number, width: number, height: number, color: [number, number, number, number]): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      imageValue.data.set(color, ((row * imageValue.width) + column) * 4);
    }
  }
}

const screenshot = image(400, 300, [96, 96, 96, 255]);
fill(screenshot, 50, 40, 300, 220, [248, 248, 248, 255]);
const detection = detectKritaCanvasRegion(screenshot);
assert.ok(detection, "a high-contrast canvas rectangle should be detected");
assert.deepEqual(detection.region, { x: 50, y: 40, width: 300, height: 220 });
assert.equal(detection.method, "center-contrast");
assert.ok(detection.confidence >= 0.9);

const paintedCanvas = image(800, 600, [96, 96, 96, 255]);
fill(paintedCanvas, 100, 80, 600, 440, [248, 248, 248, 255]);
// The center scanline crosses this painted shape, but the canvas center pixel
// remains the original canvas color. A profile-based detector must recover the
// full canvas instead of treating the stroke as its left boundary.
fill(paintedCanvas, 270, 295, 120, 10, [0, 0, 0, 255]);
const paintedDetection = detectKritaCanvasRegion(paintedCanvas);
assert.ok(paintedDetection, "painted canvas should be detected");
assert.deepEqual(paintedDetection.region, { x: 100, y: 80, width: 600, height: 440 });
assert.equal(paintedDetection.method, "sampled-profile");
assert.ok(paintedDetection.confidence >= 0.9);

assert.equal(detectKritaCanvasRegion(image(400, 300, [96, 96, 96, 255])), undefined);

const outer = image(400, 300, [248, 248, 248, 255]);
fill(outer, 1, 1, 398, 298, [96, 96, 96, 255]);
assert.equal(detectKritaCanvasRegion(outer), undefined, "outer bounds must never be treated as the canvas");

const compact = image(160, 120, [96, 96, 96, 255]);
fill(compact, 30, 20, 100, 80, [248, 248, 248, 255]);
assert.deepEqual(
  detectKritaCanvasRegion(compact)?.region,
  { x: 30, y: 20, width: 100, height: 80 },
  "a compact non-fullscreen Krita window should still calibrate its canvas",
);

console.log("Krita canvas detector tests passed");
