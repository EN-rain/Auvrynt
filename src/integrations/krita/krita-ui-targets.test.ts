import assert from "node:assert/strict";
import {
  clearKritaUiTargets,
  discoverKritaUiTargets,
  getKritaUiTarget,
  listKritaUiTargets,
  recordKritaUiTarget,
  refreshKritaUiTargets,
} from "./krita-ui-targets.js";
import type { KritaWindowInfo } from "./krita-window.js";
import type { RgbaImage } from "./krita-canvas-detector.js";

const window: KritaWindowInfo = {
  title: "Krita",
  actualTitle: "[Not Saved] - Krita",
  processName: "krita",
  processId: 9224,
  windowHandle: "3605672",
  bounds: { x: 0, y: 0, width: 1200, height: 800 },
  displayId: "display-1",
  displayScale: 1.5,
  capturedAt: new Date().toISOString(),
  ownedPopupDiscovery: "complete",
  ownedPopups: [],
};
clearKritaUiTargets("ui-target-test");
const target = recordKritaUiTarget("ui-target-test", window, {
  region: "toolbar",
  windowRegion: { x: 10, y: 10, width: 400, height: 48 },
  confidence: 0.95,
});
assert.equal(target.windowHandle, window.windowHandle);
assert.equal(listKritaUiTargets("ui-target-test").length, 1);
assert.deepEqual(getKritaUiTarget("ui-target-test", target.id)?.windowRegion, { x: 10, y: 10, width: 400, height: 48 });
assert.throws(
  () => recordKritaUiTarget("ui-target-test", window, { region: "toolbar", windowRegion: { x: 0, y: 0, width: 2000, height: 20 }, confidence: 0.9 }),
  /fit inside/i,
);
const refreshed = refreshKritaUiTargets("ui-target-test", { ...window, bounds: { ...window.bounds, width: 1300 } });
assert.equal(refreshed.active.length, 0);
assert.equal(refreshed.invalidated[0]?.reason, "window-geometry-changed");

const width = 500;
const height = 300;
const data = new Uint8Array(width * height * 4);
for (let offset = 0; offset < data.length; offset += 4) {
  data[offset] = 124;
  data[offset + 1] = 124;
  data[offset + 2] = 124;
  data[offset + 3] = 255;
}
const paintRect = (x: number, y: number, w: number, h: number, color: [number, number, number]) => {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      const offset = (row * width + column) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
    }
  }
};
paintRect(60, 60, 300, 190, [244, 244, 244]);
paintRect(250, 27, 58, 20, [83, 114, 142]);
paintRect(62, 27, 18, 18, [0, 0, 0]);
paintRect(82, 27, 18, 18, [245, 245, 245]);
paintRect(400, 50, 100, 200, [56, 56, 56]);
paintRect(409, 120, 84, 20, [80, 126, 166]);
const discovered = discoverKritaUiTargets(window, { width, height, data } satisfies RgbaImage);
const discoveredIds = discovered.targets.map((target) => target.id);
assert.ok(discoveredIds.includes("brush-size"));
assert.ok(discoveredIds.includes("foreground-color"));
assert.ok(discoveredIds.includes("layers-panel"));
assert.ok(discoveredIds.includes("active-layer-name"));
assert.ok(discoveredIds.includes("brush-presets"));
assert.ok(discovered.targets.every((target) => target.confidence >= 0.8));

// A verified calibration rectangle remains a safe anchor when a responsive
// dock gutter makes the full-window canvas detector ambiguous. The fallback
// still requires the same visual dock/split signals before emitting controls.
const anchoredWidth = 500;
const anchoredHeight = 300;
const anchoredData = new Uint8Array(anchoredWidth * anchoredHeight * 4);
for (let offset = 0; offset < anchoredData.length; offset += 4) {
  anchoredData[offset] = 124;
  anchoredData[offset + 1] = 124;
  anchoredData[offset + 2] = 124;
  anchoredData[offset + 3] = 255;
}
const paintAnchored = (x: number, y: number, w: number, h: number, color: [number, number, number]) => {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      const offset = (row * anchoredWidth + column) * 4;
      anchoredData[offset] = color[0];
      anchoredData[offset + 1] = color[1];
      anchoredData[offset + 2] = color[2];
    }
  }
};
paintAnchored(400, 50, 100, 200, [56, 56, 56]);
paintAnchored(409, 120, 84, 20, [80, 126, 166]);
const anchored = discoverKritaUiTargets(
  window,
  { width: anchoredWidth, height: anchoredHeight, data: anchoredData } satisfies RgbaImage,
  { x: 60, y: 60, width: 300, height: 190 },
);
const anchoredIds = anchored.targets.map((target) => target.id);
assert.ok(anchoredIds.includes("layers-panel"), "verified calibration must anchor responsive dock discovery");
assert.ok(anchoredIds.includes("brush-presets"), "anchored discovery must retain the dock split gate");
assert.ok(!anchored.rejected.includes("canvas-not-detected"));

console.log("Krita UI target tests passed");
