import assert from "node:assert/strict";
import { classifyKritaDialogTitle, resolveKritaDialogState } from "./krita-dialogs.js";
import type { KritaWindowInfo } from "./krita-window.js";

assert.equal(classifyKritaDialogTitle("Save As"), "save_as");
assert.equal(classifyKritaDialogTitle("Export Advanced"), "export");
assert.equal(classifyKritaDialogTitle("Overwrite file?"), "overwrite");
const state = resolveKritaDialogState({
  title: "Krita",
  actualTitle: "Krita",
  processName: "krita",
  processId: 1,
  windowHandle: "100",
  bounds: { x: 0, y: 0, width: 1000, height: 700 },
  displayId: "display-1",
  displayScale: 1,
  capturedAt: new Date().toISOString(),
  ownedPopupDiscovery: "complete",
  ownedPopups: [{
    handle: "101",
    processId: 1,
    processName: "krita",
    title: "Save As",
    visible: true,
    minimized: false,
    zOrder: 1,
    bounds: { x: 100, y: 100, width: 500, height: 400 },
    ownerHandle: "100",
    rootOwnerHandle: "100",
  }],
} satisfies KritaWindowInfo);
assert.equal(state.present, true);
assert.equal(state.confidence, "verified-owner");
assert.equal(state.kind, "save_as");
assert.equal(state.handle, "101");

console.log("Krita dialog tests passed");
