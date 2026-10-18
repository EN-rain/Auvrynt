import assert from "node:assert/strict";
import type { DesktopDisplay } from "../desktop/desktop-displays.js";
import {
  canvasDisplayRegion,
  mapNormalizedCanvasPoint,
  selectDisplayForBounds,
  type KritaCanvasCalibration,
} from "./krita-calibration.js";

const displays: DesktopDisplay[] = [
  {
    id: "display-1",
    deviceName: "DISPLAY1",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    primary: true,
    scale: 1,
  },
  {
    id: "display-2",
    deviceName: "DISPLAY2",
    x: 1920,
    y: 0,
    width: 2560,
    height: 1440,
    primary: false,
    scale: 1.25,
  },
];

assert.equal(
  selectDisplayForBounds(displays, { x: 2000, y: 100, width: 1000, height: 800 }).id,
  "display-2",
);
assert.equal(
  selectDisplayForBounds(displays, { x: 1800, y: 100, width: 400, height: 800 }).id,
  "display-2",
  "window center should select the second display when a window straddles displays",
);
assert.throws(
  () => selectDisplayForBounds(displays, { x: -5000, y: -5000, width: 100, height: 100 }),
  /not inside any enumerated display/i,
);

const calibration: KritaCanvasCalibration = {
  workspaceId: "calibration-test",
  windowTitle: "Krita",
  processName: "krita",
  windowHandle: "1234",
  displayId: "display-2",
  displayScale: 1.25,
  windowBounds: { x: 2000, y: 50, width: 1400, height: 1000 },
  displayBounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  canvasWindowRegion: { x: 100, y: 100, width: 1000, height: 800 },
  canvasScreenRegion: { x: 2100, y: 150, width: 1000, height: 800 },
  calibratedAt: "2026-09-08T00:00:00.000Z",
};

assert.deepEqual(canvasDisplayRegion(calibration), {
  x: 180,
  y: 150,
  width: 1000,
  height: 800,
});

assert.deepEqual(mapNormalizedCanvasPoint(calibration, { x: 0, y: 0 }), {
  screenX: 2100,
  screenY: 150,
  displayX: 180,
  displayY: 150,
  displayId: "display-2",
});
assert.deepEqual(mapNormalizedCanvasPoint(calibration, { x: 1, y: 1 }), {
  screenX: 3099,
  screenY: 949,
  displayX: 1179,
  displayY: 949,
  displayId: "display-2",
});
assert.deepEqual(mapNormalizedCanvasPoint(calibration, { x: 0.5, y: 0.5 }), {
  screenX: 2600,
  screenY: 550,
  displayX: 680,
  displayY: 550,
  displayId: "display-2",
});

assert.throws(
  () => mapNormalizedCanvasPoint(calibration, { x: 1.01, y: 0.5 }),
  /between 0 and 1/i,
);

console.log("krita calibration tests passed");
