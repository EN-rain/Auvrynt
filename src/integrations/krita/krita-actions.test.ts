import assert from "node:assert/strict";
import {
  clearKritaShortcutProfile,
  markKritaShortcutsValidated,
  setKritaShortcutBinding,
} from "./krita-shortcuts.js";
import { KritaActions, scaleKritaRegionToWindow, type KritaActionDependencies } from "./krita-actions.js";

const workspaceId = "krita-actions-test";
assert.deepEqual(
  scaleKritaRegionToWindow({ x: 25, y: 20, width: 200, height: 160 }, 400, 320, { width: 1200, height: 960 }),
  { x: 75, y: 60, width: 600, height: 480 },
  "canvas regions must scale proportionally from the captured image to the live window",
);
clearKritaShortcutProfile(workspaceId);
setKritaShortcutBinding(workspaceId, "new_layer", ["INSERT"]);
markKritaShortcutsValidated(workspaceId, ["new_layer"]);

const calls: string[][] = [];
const focusPolicies: Array<string | undefined> = [];
const deps: KritaActionDependencies = {
  getWindowInfo: async () => ({
    title: "Krita",
    actualTitle: "Krita",
    processName: "krita",
    processId: 123,
    windowHandle: "456",
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    displayId: "display-1",
    displayScale: 1,
    capturedAt: new Date().toISOString(),
  }),
  getStatusWindowInfo: async () => ({
    title: "Krita",
    actualTitle: " [Not Saved]  - Krita",
    processName: "krita",
    processId: 123,
    windowHandle: "456",
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    displayId: "display-1",
    displayScale: 1,
    capturedAt: new Date().toISOString(),
    visible: true,
    minimized: true,
  }),
  captureFrame: async () => { throw new Error("not used"); },
  checkCanvasCalibration: async () => ({ valid: false, reason: "missing" as const }),
  keyPress: async (_workspaceId, keys, _windowTitle, _windowHandle, _processName, options) => {
    calls.push(keys);
    focusPolicies.push(options?.focusPolicy);
    return { pressed: keys };
  },
  mouseClick: async () => { throw new Error("not used"); },
  mouseDrag: async () => { throw new Error("not used"); },
};

const actions = new KritaActions(deps);
const status = await actions.status(workspaceId);
assert.equal(status.online, true);
assert.equal((status.window as { minimized?: boolean }).minimized, true);
assert.ok(actions.listActions().some((action) => action.id === "create_layer"));
assert.deepEqual(actions.searchActions("layer").map((action) => action.id), [
  "create_layer",
  "select_layer",
  "set_layer",
  "delete_layer",
  "duplicate_layer",
  "rename_layer",
  "move_layer_up",
  "move_layer_down",
  "toggle_layer_visibility",
  "toggle_layer_lock",
  "select_previous_layer",
  "select_next_layer",
  "pick_layer_at_point",
]);
assert.equal(actions.listActions(workspaceId).find((action) => action.id === "create_layer")?.ready, true);
assert.equal(actions.listActions(workspaceId).find((action) => action.id === "fill")?.requiresCalibration, true);

const result = await actions.triggerAction(workspaceId, "create_layer");
assert.equal(result.action, "create_layer");
assert.equal(result.shortcutCommand, "new_layer");
assert.deepEqual(calls, [["INSERT"]]);
await actions.command(workspaceId, "new_layer", { focusPolicy: "foreground-restore" });
assert.equal(focusPolicies.at(-1), "foreground-restore", "Krita commands must propagate the explicit focus policy");

const probe = await actions.probeShortcut(workspaceId, "undo", { confirmReversible: true });
assert.equal(probe.probe.command, "undo");
assert.equal(probe.probe.requiresVisualConfirmation, true);
assert.equal(actions.getShortcuts(workspaceId).bindings.undo?.validated, false);
const confirmed = actions.validateShortcuts(workspaceId, ["undo"], [probe.probe.probeId]);
assert.equal(confirmed.bindings.undo?.validated, true);

const calibration = {
  workspaceId,
  windowTitle: "Krita",
  processName: "krita",
  windowHandle: "456",
  displayId: "display-1",
  displayScale: 1,
  windowBounds: { x: 0, y: 0, width: 1200, height: 800 },
  displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
  canvasWindowRegion: { x: 100, y: 100, width: 1000, height: 600 },
  canvasScreenRegion: { x: 100, y: 100, width: 1000, height: 600 },
  calibratedAt: new Date().toISOString(),
  verifiedAt: new Date().toISOString(),
};
let adaptiveChecks = 0;
let adaptiveRecalibrations = 0;
const adaptiveActions = new KritaActions({
  ...deps,
  checkCanvasCalibration: async () => {
    adaptiveChecks += 1;
    return adaptiveChecks === 1
      ? { valid: false as const, reason: "geometry-changed" as const }
      : { valid: true as const, calibration };
  },
  autoCalibrate: async () => {
    adaptiveRecalibrations += 1;
    return { automatic: true };
  },
  captureFrame: async () => ({
    buffer: Buffer.from("window"),
    mimeType: "image/png" as const,
    format: "png" as const,
    target: "app-window" as const,
    timestamp: new Date().toISOString(),
    sourceWidth: 1200,
    sourceHeight: 800,
    width: 1200,
    height: 800,
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    processName: "krita",
    processId: 123,
    windowHandle: "456",
    windowTitle: "Krita",
    captureBackend: "print-window" as const,
    occlusionSafe: true,
    foregroundWindowHandleBefore: "1",
    foregroundWindowHandleAfter: "1",
  }),
  requireCalibration: undefined,
});
await adaptiveActions.captureCanvas("krita-adaptive-test");
assert.equal(adaptiveRecalibrations, 1, "stale geometry should trigger one safe automatic recalibration");
const panActions = new KritaActions({
  ...deps,
  requireCalibration: async () => calibration,
  mouseDrag: async (_workspaceId, input) => ({
    dragged: true as const,
    startX: input.startX,
    startY: input.startY,
    endX: input.endX,
    endY: input.endY,
    button: input.button ?? "left",
  }),
});
const middleState = panActions.getState(workspaceId);
assert.equal(middleState.fields.modified.value, undefined);
await panActions.stroke(workspaceId, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }, { button: "middle" });
assert.equal(panActions.getState(workspaceId).fields.modified.value, undefined);
await panActions.pathStroke(workspaceId, [
  { x: 0.3, y: 0.3 },
  { x: 0.4, y: 0.4 },
], { button: "middle" });
assert.equal(panActions.getState(workspaceId).fields.modified.value, undefined);

const created = await actions.createLayer(workspaceId);
assert.equal(created.action, "create_layer");

const batch = await actions.batch(workspaceId, [
  { type: "action", actionId: "create_layer" },
]);
assert.equal(batch.completed, 1);
assert.equal(batch.results[0]?.action, "create_layer");

await assert.rejects(
  () => actions.pathStroke(workspaceId, [{ x: 0.1, y: 0.1 }]),
  /between 2 and 512 points/i,
);
assert.ok(actions.listActions().some((action) => action.id === "zoom_in"));

await assert.rejects(
  () => actions.triggerAction(workspaceId, "set_color"),
  /dedicated parameterized|target/i,
);

console.log("Krita action execution tests passed");
