import assert from "node:assert/strict";
import { KritaActions, type KritaActionDependencies } from "./krita-actions.js";
import { clearKritaShortcutProfile, markKritaShortcutsValidated, setKritaShortcutBinding } from "./krita-shortcuts.js";
import { clearKritaUiTargets } from "./krita-ui-targets.js";
import type { KritaUiAutomationElement } from "./krita-ui-text.js";

const makeWindow = () => ({
  title: "Krita",
  actualTitle: "[Not Saved] - Krita",
  processName: "krita",
  processId: 321,
  windowHandle: "654",
  bounds: { x: 0, y: 0, width: 1200, height: 800 },
  displayId: "display-1",
  displayScale: 1,
  capturedAt: new Date().toISOString(),
});
const frame = () => ({
  buffer: Buffer.from("frame"),
  mimeType: "image/png" as const,
  format: "png" as const,
  target: "app-window" as const,
  timestamp: new Date().toISOString(),
  sourceWidth: 100,
  sourceHeight: 40,
  width: 100,
  height: 40,
  bounds: { x: 0, y: 0, width: 100, height: 40 },
  processName: "krita",
  processId: 321,
  windowHandle: "654",
  windowTitle: "Krita",
  captureBackend: "print-window" as const,
  occlusionSafe: true,
  foregroundWindowHandleBefore: "1",
  foregroundWindowHandleAfter: "1",
});

const workspaceId = "final-fixes-actions-test";
clearKritaUiTargets(workspaceId);
clearKritaShortcutProfile(workspaceId);
setKritaShortcutBinding(workspaceId, "rename_layer", ["F2"]);
markKritaShortcutsValidated(workspaceId, ["rename_layer"]);
const textReads: string[] = ["40.00 px", "25.00 px", "Renamed", "Fit View (110.6%)"];
const calls: string[][] = [];
const deps: KritaActionDependencies = {
  getWindowInfo: async () => makeWindow(),
  captureFrame: async () => frame(),
  keyPress: async (_workspaceId, keys) => { calls.push(keys); return { pressed: keys }; },
  mouseClick: async (_workspaceId, input) => ({ clicked: true, x: input.x, y: input.y, button: input.button ?? "left", clickCount: input.clickCount ?? 1 }),
  mouseDrag: async (_workspaceId, input) => ({ dragged: true, startX: input.startX, startY: input.startY, endX: input.endX, endY: input.endY, button: input.button ?? "left" }),
  typeText: async (_workspaceId, text) => ({ typedCharacters: text.length }),
  listDisplays: async () => [{ id: "display-1", deviceName: "DISPLAY1", x: 0, y: 0, width: 1920, height: 1080, primary: true, scale: 1 }],
  readUiTargetText: async () => textReads.shift(),
  refreshUiTargets: async () => undefined,
};
const actions = new KritaActions(deps);
await actions.registerUiTarget(workspaceId, { id: "brush-size", region: "toolbar", windowRegion: { x: 10, y: 10, width: 100, height: 40 }, confidence: 0.95 });
await actions.registerUiTarget(workspaceId, { id: "active-layer-name", region: "layers_docker", windowRegion: { x: 200, y: 200, width: 200, height: 30 }, confidence: 0.95 });
await actions.registerUiTarget(workspaceId, { id: "status-bar", region: "status_bar", windowRegion: { x: 900, y: 760, width: 200, height: 30 }, confidence: 0.95 });

const brush = await actions.setBrushSize(workspaceId, 25);
assert.equal(brush.before, 40);
assert.equal(brush.observed, 25);
assert.equal(brush.confidence, "visually_verified");
const rename = await actions.renameActiveLayer(workspaceId, "Renamed");
assert.equal(rename.observedName, "Renamed");
assert.equal(rename.confidence, "visually_verified");
assert.ok(calls.some((keys) => keys.join("+") === "F2"));
const view = await actions.getViewState(workspaceId);
assert.equal(view.zoom, 110.6);
assert.equal((view.confidence as { zoom: string }).zoom, "visually_verified");

const colorWorkspace = "final-fixes-color-test";
clearKritaUiTargets(colorWorkspace);
let colorDialogOpen = true;
const colorWindow = () => ({
  ...makeWindow(),
  ownedPopups: colorDialogOpen ? [{
    handle: "987",
    processId: 321,
    processName: "krita",
    title: "Select Foreground Color",
    visible: true,
    minimized: false,
    zOrder: 1,
    bounds: { x: 300, y: 200, width: 500, height: 300 },
    ownerHandle: "654",
    rootOwnerHandle: "654",
  }] : [],
  ownedPopupDiscovery: "complete" as const,
});
const colorDeps: KritaActionDependencies = {
  ...deps,
  getWindowInfo: async () => colorWindow(),
  captureFrame: async () => ({ ...frame(), sourceWidth: 500, sourceHeight: 300, width: 500, height: 300, bounds: { x: 300, y: 200, width: 500, height: 300 }, windowHandle: "987", windowTitle: "Select Foreground Color" }),
  queryUiTargetElements: async () => [
    { name: "", value: "#3366FF", automationId: "colorHex", className: "QLineEdit", controlType: "ControlType.Edit", bounds: { x: 400, y: 350, width: 200, height: 30 }, offscreen: false },
    { name: "OK", value: "", automationId: "ok", className: "QPushButton", controlType: "ControlType.Button", bounds: { x: 650, y: 450, width: 80, height: 30 }, offscreen: false },
    { name: "Cancel", value: "", automationId: "cancel", className: "QPushButton", controlType: "ControlType.Button", bounds: { x: 550, y: 450, width: 80, height: 30 }, offscreen: false },
  ] satisfies KritaUiAutomationElement[],
  mouseClick: async (_workspaceId, input) => {
    if (input.windowHandle === "987" && input.x > 600) colorDialogOpen = false;
    return { clicked: true, x: input.x, y: input.y, button: input.button ?? "left", clickCount: input.clickCount ?? 1 };
  },
  readUiTargetText: async (_workspaceId, target) => target.id === "color-hex-field" ? "#3366FF" : undefined,
};
const colorActions = new KritaActions(colorDeps);
await colorActions.registerUiTarget(colorWorkspace, { id: "foreground-color", region: "foreground_color_control", windowRegion: { x: 250, y: 70, width: 40, height: 40 }, confidence: 0.95 });
const colorResult = await colorActions.setForegroundColor(colorWorkspace, "#3366FF");
assert.equal(colorResult.observedColor, "#3366FF");
assert.equal(colorResult.confidence, "visually_verified");
assert.equal(colorResult.dialogClosed, true);

const presetWorkspace = "final-fixes-preset-test";
clearKritaUiTargets(presetWorkspace);
let presetQueryCount = 0;
const presetDeps: KritaActionDependencies = {
  ...deps,
  queryUiTargetElements: async () => [{
    name: "Basic-5 Size",
    value: "",
    automationId: "preset-basic-5",
    className: "KisPresetListItem",
    controlType: "ControlType.ListItem",
    bounds: { x: 400, y: 400, width: 120, height: 80 },
    offscreen: false,
    selected: presetQueryCount++ > 0,
  }],
  readUiTargetText: undefined,
};
const presetActions = new KritaActions(presetDeps);
await presetActions.registerUiTarget(presetWorkspace, { id: "brush-presets", region: "brush_presets_docker", windowRegion: { x: 300, y: 300, width: 500, height: 400 }, confidence: 0.95 });
const presetResult = await presetActions.setApprovedBrush(presetWorkspace, "inking_basic");
assert.equal(presetResult.requestedPreset, "Basic-5 Size");
assert.equal(presetResult.observedPreset, "Basic-5 Size");
assert.equal(presetResult.confidence, "visually_verified");
assert.equal(presetResult.selectionVerified, true);

const namedPresetWorkspace = "final-fixes-named-preset-test";
clearKritaUiTargets(namedPresetWorkspace);
let namedPresetQueryCount = 0;
const namedPresetActions = new KritaActions({
  ...deps,
  queryUiTargetElements: async () => [{
    name: "Custom Exact Ink",
    value: "",
    automationId: "custom-exact-ink",
    className: "KisPresetListItem",
    controlType: "ControlType.ListItem",
    bounds: { x: 420, y: 420, width: 140, height: 70 },
    offscreen: false,
    selected: namedPresetQueryCount++ > 0,
  }],
  readUiTargetText: undefined,
});
await namedPresetActions.registerUiTarget(namedPresetWorkspace, { id: "brush-presets", region: "brush_presets_docker", windowRegion: { x: 300, y: 300, width: 500, height: 400 }, confidence: 0.95 });
const namedPresetResult = await namedPresetActions.setBrush(namedPresetWorkspace, "Custom Exact Ink");
assert.equal(namedPresetResult.requestedPreset, "Custom Exact Ink");
assert.equal(namedPresetResult.observedPreset, "Custom Exact Ink");
assert.equal(namedPresetResult.selectionVerified, true);
assert.equal(namedPresetResult.confidence, "visually_verified");

const layerWorkspace = "final-fixes-layer-select-test";
clearKritaUiTargets(layerWorkspace);
let layerQueryCount = 0;
const layerActions = new KritaActions({
  ...deps,
  queryUiTargetElements: async () => [{
    name: "Line Art",
    value: "",
    automationId: "layer-line-art",
    className: "KisNodeViewItem",
    controlType: "ControlType.TreeItem",
    bounds: { x: 850, y: 250, width: 220, height: 28 },
    offscreen: false,
    selected: layerQueryCount++ > 0,
  }],
  readUiTargetText: undefined,
});
await layerActions.registerUiTarget(layerWorkspace, { id: "layers-panel", region: "layers_docker", windowRegion: { x: 800, y: 150, width: 350, height: 500 }, confidence: 0.95 });
const layerResult = await layerActions.selectLayer(layerWorkspace, "Line Art");
assert.equal(layerResult.requestedLayer, "Line Art");
assert.equal(layerResult.observedLayer, "Line Art");
assert.equal(layerResult.selectionVerified, true);
assert.equal(layerResult.confidence, "visually_verified");
assert.equal(layerActions.getState(layerWorkspace).fields.activeLayerName.value, "Line Art");
assert.equal(layerActions.getState(layerWorkspace).fields.activeLayerName.confidence, "visually_verified");

const fragmentedLayerWorkspace = "final-fixes-fragmented-layer-select-test";
clearKritaUiTargets(fragmentedLayerWorkspace);
let fragmentedLayerQueryCount = 0;
const fragmentedLayerActions = new KritaActions({
  ...deps,
  queryUiTargetElements: async () => {
    const selected = fragmentedLayerQueryCount++ > 0;
    return [
      { name: "Background", value: "", automationId: "", className: "", controlType: "ControlType.TreeItem", bounds: { x: 819, y: 409, width: 22, height: 27 }, offscreen: false, selected: false },
      { name: "Background", value: "", automationId: "", className: "", controlType: "ControlType.TreeItem", bounds: { x: 841, y: 409, width: 22, height: 27 }, offscreen: false, selected: false },
      { name: "Background", value: "", automationId: "", className: "", controlType: "ControlType.TreeItem", bounds: { x: 863, y: 409, width: 255, height: 27 }, offscreen: false, selected },
    ];
  },
  readUiTargetText: undefined,
});
await fragmentedLayerActions.registerUiTarget(fragmentedLayerWorkspace, { id: "layers-panel", region: "layers_docker", windowRegion: { x: 800, y: 300, width: 340, height: 390 }, confidence: 0.95 });
const fragmentedLayerResult = await fragmentedLayerActions.selectLayer(fragmentedLayerWorkspace, "Background");
assert.equal(fragmentedLayerResult.requestedLayer, "Background");
assert.equal(fragmentedLayerResult.observedLayer, "Background");
assert.equal(fragmentedLayerResult.selectionVerified, true);
assert.equal(fragmentedLayerResult.confidence, "visually_verified");

const highlightedLayerWorkspace = "final-fixes-highlighted-layer-select-test";
clearKritaUiTargets(highlightedLayerWorkspace);
const highlightedLayerActions = new KritaActions({
  ...deps,
  queryUiTargetElements: async () => [
    { name: "Background", value: "", automationId: "", className: "", controlType: "ControlType.TreeItem", bounds: { x: 819, y: 409, width: 22, height: 27 }, offscreen: false },
    { name: "Background", value: "", automationId: "", className: "", controlType: "ControlType.TreeItem", bounds: { x: 841, y: 409, width: 22, height: 27 }, offscreen: false },
    { name: "Background", value: "", automationId: "", className: "", controlType: "ControlType.TreeItem", bounds: { x: 863, y: 409, width: 255, height: 27 }, offscreen: false },
  ],
  readUiTargetText: undefined,
});
await highlightedLayerActions.registerUiTarget(highlightedLayerWorkspace, { id: "layers-panel", region: "layers_docker", windowRegion: { x: 800, y: 300, width: 340, height: 390 }, confidence: 0.95 });
await highlightedLayerActions.registerUiTarget(highlightedLayerWorkspace, { id: "active-layer-name", region: "layers_docker", windowRegion: { x: 863, y: 409, width: 255, height: 27 }, confidence: 0.95 });
const highlightedLayerResult = await highlightedLayerActions.selectLayer(highlightedLayerWorkspace, "Background");
assert.equal(highlightedLayerResult.requestedLayer, "Background");
assert.equal(highlightedLayerResult.observedLayer, "Background");
assert.equal(highlightedLayerResult.selectionVerified, true);
assert.equal(highlightedLayerResult.verificationSource, "active-layer-highlight");
assert.equal(highlightedLayerResult.confidence, "visually_verified");

console.log("Krita final fixes action tests passed");
