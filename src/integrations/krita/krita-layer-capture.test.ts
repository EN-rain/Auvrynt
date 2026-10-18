import assert from "node:assert/strict";
import { KritaActions, type KritaActionDependencies } from "./krita-actions.js";
import { clearKritaUiTargets, recordKritaUiTarget } from "./krita-ui-targets.js";
import { clearKritaShortcutProfile, markKritaShortcutsValidated, setKritaShortcutBinding } from "./krita-shortcuts.js";

const workspaceId = "layer-capture-target-test";
clearKritaUiTargets(workspaceId);
const window = {
  title: "Krita",
  actualTitle: " [Not Saved]  - Krita",
  processName: "krita",
  processId: 25012,
  windowHandle: "8587574",
  bounds: { x: 0, y: 0, width: 1942, height: 1030 },
  displayId: "display-1",
  displayScale: 1.5,
  capturedAt: new Date().toISOString(),
};
const frame = (region: { x: number; y: number; width: number; height: number }) => ({
  buffer: Buffer.from("frame"),
  mimeType: "image/png" as const,
  format: "png" as const,
  target: "app-window" as const,
  timestamp: new Date().toISOString(),
  sourceWidth: region.width,
  sourceHeight: region.height,
  width: region.width,
  height: region.height,
  bounds: region,
  processName: "krita",
  processId: 25012,
  windowHandle: "8587574",
  windowTitle: "Krita",
  captureBackend: "print-window" as const,
  occlusionSafe: true,
  foregroundWindowHandleBefore: "1",
  foregroundWindowHandleAfter: "1",
});
let capturedRegion: { x: number; y: number; width: number; height: number } | undefined;
const deps: KritaActionDependencies = {
  getWindowInfo: async () => window,
  captureFrame: async (_input) => {
    capturedRegion = _input.windowRegion;
    return frame(_input.windowRegion ?? { x: 0, y: 0, width: 100, height: 100 });
  },
  keyPress: async () => ({ pressed: [] }),
  mouseClick: async (_workspaceId, input) => ({
    clicked: true,
    x: input.x,
    y: input.y,
    button: input.button ?? "left",
    clickCount: input.clickCount ?? 1,
  }),
  mouseDrag: async (_workspaceId, input) => ({
    dragged: true,
    startX: input.startX,
    startY: input.startY,
    endX: input.endX,
    endY: input.endY,
    button: input.button ?? "left",
  }),
};
recordKritaUiTarget(workspaceId, window, {
  id: "active-layer-name",
  region: "layers_docker",
  windowRegion: { x: 1674, y: 420, width: 255, height: 26 },
  confidence: 0.9,
  source: "visual-confirmation",
});
recordKritaUiTarget(workspaceId, window, {
  id: "layers-panel",
  region: "layers_docker",
  windowRegion: { x: 1631, y: 309, width: 311, height: 377 },
  confidence: 0.9,
  source: "visual-confirmation",
});

const actions = new KritaActions(deps);
await actions.getLayersPanel(workspaceId);
assert.deepEqual(
  capturedRegion,
  { x: 1631, y: 309, width: 311, height: 377 },
  "the Layers panel capture must select the full layers-panel target, not the active-layer-name row",
);

console.log("Krita layer capture target tests passed");

const shortcutWorkspace = "layer-shortcut-focus-test";
clearKritaUiTargets(shortcutWorkspace);
clearKritaShortcutProfile(shortcutWorkspace);
setKritaShortcutBinding(shortcutWorkspace, "select_next_layer", ["DOWN"]);
markKritaShortcutsValidated(shortcutWorkspace, ["select_next_layer"]);
const shortcutEvents: string[] = [];
const shortcutDeps: KritaActionDependencies = {
  ...deps,
  refreshUiTargets: async () => undefined,
  keyPress: async () => { shortcutEvents.push("key"); return { pressed: ["DOWN"] }; },
  mouseClick: async () => { shortcutEvents.push("click"); return { clicked: true, x: 1, y: 1, button: "left", clickCount: 1 }; },
  mouseClickAndKeyPress: async () => {
    shortcutEvents.push("click-key");
    return { clicked: true, pressed: ["DOWN"], x: 1, y: 1, button: "left", clickCount: 1 };
  },
  listDisplays: async () => [{ id: "display-1", deviceName: "DISPLAY1", x: 0, y: 0, width: 1920, height: 1080, primary: true, scale: 1 }],
  getShortcutFingerprint: async () => `sha256:${"a".repeat(64)}`,
};
recordKritaUiTarget(shortcutWorkspace, window, {
  id: "active-layer-name",
  region: "layers_docker",
  windowRegion: { x: 1674, y: 420, width: 255, height: 26 },
  confidence: 0.9,
  source: "visual-confirmation",
});
await new KritaActions(shortcutDeps).selectNextLayer(shortcutWorkspace, { focusPolicy: "foreground-restore" });
assert.deepEqual(shortcutEvents, ["click-key"], "layer navigation must keep verified child-control focus through its shortcut");

shortcutEvents.length = 0;
await new KritaActions(shortcutDeps).probeShortcut(shortcutWorkspace, "select_next_layer", {
  confirmReversible: true,
  focusPolicy: "foreground-restore",
});
assert.deepEqual(shortcutEvents, ["click-key"], "layer shortcut probes must use the same atomic verified target focus path as execution");

const staleWorkspace = "layer-shortcut-stale-target-test";
clearKritaUiTargets(staleWorkspace);
clearKritaShortcutProfile(staleWorkspace);
setKritaShortcutBinding(staleWorkspace, "select_next_layer", ["PAGEDOWN"]);
markKritaShortcutsValidated(staleWorkspace, ["select_next_layer"]);
recordKritaUiTarget(staleWorkspace, window, {
  id: "active-layer-name",
  region: "layers_docker",
  windowRegion: { x: 1674, y: 420, width: 255, height: 26 },
  confidence: 0.9,
  source: "visual-confirmation",
});
let refreshedStaleTarget = false;
let staleTargetClickY: number | undefined;
const staleTargetDeps: KritaActionDependencies = {
  ...shortcutDeps,
  refreshUiTargets: async () => {
    refreshedStaleTarget = true;
    recordKritaUiTarget(staleWorkspace, window, {
      id: "active-layer-name",
      region: "layers_docker",
      windowRegion: { x: 1674, y: 472, width: 255, height: 26 },
      confidence: 0.9,
      source: "visual-confirmation",
    });
  },
  mouseClickAndKeyPress: async (_workspaceId, input) => {
    staleTargetClickY = input.y;
    return { clicked: true, pressed: ["PAGEDOWN"], x: input.x, y: input.y, button: "left", clickCount: 1 };
  },
};
await new KritaActions(staleTargetDeps).selectNextLayer(staleWorkspace, { focusPolicy: "foreground-restore" });
assert.equal(refreshedStaleTarget, true, "context-sensitive layer commands must refresh the active-row target");
assert.equal(staleTargetClickY, 485, "layer input must use the current selected-row rectangle, not a stale row");

console.log("Krita layer shortcut focus tests passed");
