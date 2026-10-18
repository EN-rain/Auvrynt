import assert from "node:assert/strict";
import { buildKritaReadinessReport } from "./krita-readiness.js";
import { getKritaExpectedState } from "./krita-state.js";
import { getKritaShortcutProfile } from "./krita-shortcuts.js";

const report = buildKritaReadinessReport({
  windowCapture: true,
  canvasCapture: false,
  autoCalibration: true,
  calibrationValid: false,
  shortcuts: getKritaShortcutProfile("readiness-test"),
  state: getKritaExpectedState("readiness-test"),
  targets: [],
});
assert.equal((report.observation as { windowCapture: string }).windowCapture, "ready");
assert.equal((report.drawing as { stroke: string }).stroke, "blocked");
assert.equal((report.brush as { size: string }).size, "blocked");

const readyReport = buildKritaReadinessReport({
  windowCapture: true,
  canvasCapture: true,
  autoCalibration: true,
  calibrationValid: true,
  calibrationVerifiedAt: new Date().toISOString(),
  shortcuts: getKritaShortcutProfile("readiness-ready-test"),
  state: getKritaExpectedState("readiness-ready-test"),
  targets: [
    { id: "brush-size", region: "toolbar", windowHandle: "1", processId: 1, processName: "krita", windowDimensions: { width: 100, height: 100 }, displayScale: 1, windowRegion: { x: 1, y: 1, width: 20, height: 20 }, confidence: 0.9, verifiedAt: new Date().toISOString(), fingerprint: "f", source: "visual-confirmation" },
    { id: "foreground-color", region: "foreground_color_control", windowHandle: "1", processId: 1, processName: "krita", windowDimensions: { width: 100, height: 100 }, displayScale: 1, windowRegion: { x: 1, y: 1, width: 20, height: 20 }, confidence: 0.9, verifiedAt: new Date().toISOString(), fingerprint: "f", source: "visual-confirmation" },
    { id: "brush-presets", region: "brush_presets_docker", windowHandle: "1", processId: 1, processName: "krita", windowDimensions: { width: 100, height: 100 }, displayScale: 1, windowRegion: { x: 40, y: 40, width: 50, height: 50 }, confidence: 0.9, verifiedAt: new Date().toISOString(), fingerprint: "p", source: "visual-confirmation" },
  ],
});
assert.equal((readyReport.drawing as { stroke: string }).stroke, "ready");
assert.equal((readyReport.brush as { size: string }).size, "ready");
assert.equal((readyReport.brush as { color: string }).color, "ready");
assert.equal((readyReport.brush as { preset: string }).preset, "ready");
assert.equal((readyReport.brush as { presetBlocker?: string }).presetBlocker, undefined);

console.log("Krita readiness tests passed");
