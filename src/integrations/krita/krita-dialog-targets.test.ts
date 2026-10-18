import assert from "node:assert/strict";
import {
  clearKritaDialogSubtargets,
  discoverKritaDialogSubtargets,
  getKritaDialogSubtarget,
  refreshKritaDialogSubtargets,
} from "./krita-dialog-targets.js";
import type { KritaUiAutomationElement } from "./krita-ui-text.js";

const workspaceId = "dialog-targets-test";
clearKritaDialogSubtargets(workspaceId);
const window = {
  title: "Krita",
  actualTitle: "[Not Saved] - Krita",
  processName: "krita",
  processId: 123,
  windowHandle: "456",
  bounds: { x: 0, y: 0, width: 1200, height: 800 },
  displayId: "display-1",
  displayScale: 1,
  capturedAt: new Date().toISOString(),
  ownedPopups: [{
    handle: "789",
    processId: 123,
    processName: "krita",
    title: "Save As",
    visible: true,
    minimized: false,
    zOrder: 1,
    bounds: { x: 200, y: 150, width: 600, height: 400 },
    ownerHandle: "456",
    rootOwnerHandle: "456",
  }],
  ownedPopupDiscovery: "complete" as const,
};
const state = {
  present: true as const,
  title: "Save As",
  ownerHandle: "456",
  handle: "789",
  kind: "save_as" as const,
  bounds: { x: 200, y: 150, width: 600, height: 400 },
  confidence: "verified-owner" as const,
  capturedAt: new Date().toISOString(),
};
const frame = {
  buffer: Buffer.from("popup"),
  mimeType: "image/png" as const,
  format: "png" as const,
  target: "app-window" as const,
  timestamp: new Date().toISOString(),
  sourceWidth: 600,
  sourceHeight: 400,
  width: 600,
  height: 400,
  bounds: { x: 200, y: 150, width: 600, height: 400 },
  processName: "krita",
  processId: 123,
  windowHandle: "789",
  windowTitle: "Save As",
  captureBackend: "print-window" as const,
  occlusionSafe: true,
  foregroundWindowHandleBefore: "42",
  foregroundWindowHandleAfter: "42",
};
const element = (input: Partial<KritaUiAutomationElement>): KritaUiAutomationElement => ({
  name: "",
  value: "",
  automationId: "",
  className: "",
  controlType: "ControlType.Text",
  bounds: { x: 0, y: 0, width: 20, height: 20 },
  offscreen: false,
  ...input,
});
const targets = discoverKritaDialogSubtargets(workspaceId, window, state, frame, [
  element({ name: "File name", value: "house.kra", className: "QLineEdit", controlType: "ControlType.Edit", bounds: { x: 260, y: 440, width: 400, height: 30 } }),
  element({ name: "Save", className: "QPushButton", controlType: "ControlType.Button", bounds: { x: 650, y: 500, width: 80, height: 30 } }),
  element({ name: "Cancel", className: "QPushButton", controlType: "ControlType.Button", bounds: { x: 550, y: 500, width: 80, height: 30 } }),
  element({ name: "File type", className: "QComboBox", controlType: "ControlType.ComboBox", bounds: { x: 260, y: 400, width: 400, height: 30 } }),
]);
assert.deepEqual(new Set(targets.map((target) => target.id)), new Set(["dialog-filename", "dialog-confirm", "dialog-cancel", "dialog-format"]));
assert.equal(getKritaDialogSubtarget(workspaceId, "dialog-filename")?.windowHandle, "789");
const invalidated = refreshKritaDialogSubtargets(workspaceId, window, { ...state, present: false, confidence: "none" });
assert.equal(invalidated.invalidated.length, 4);
assert.equal(invalidated.active.length, 0);

console.log("Krita dialog target tests passed");
