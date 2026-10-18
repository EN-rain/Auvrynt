import assert from "node:assert/strict";
import {
  getKritaAction,
  listKritaActions,
  searchKritaActions,
} from "./krita-action-catalog.js";

const actions = listKritaActions();
assert.ok(actions.length >= 10);
assert.equal(new Set(actions.map((action) => action.id)).size, actions.length);

const createLayer = getKritaAction("create_layer");
assert.equal(createLayer?.execution, "shortcut");
assert.equal(createLayer?.shortcutCommand, "new_layer");
assert.equal(createLayer?.available, true);
assert.equal(createLayer?.supported, true);
assert.equal(createLayer?.ready, false);
assert.deepEqual(createLayer?.blockingPreconditions, ["validated_shortcut"]);

const color = getKritaAction("set_color");
assert.equal(color?.available, true);
assert.equal(color?.supported, true);
assert.equal(color?.execution, "ui-target");
assert.deepEqual(color?.blockingPreconditions, ["verified_foreground-color_target"]);
const colorWithTarget = getKritaAction("set_color", { uiTargetRegions: ["foreground_color_control"] });
assert.equal(colorWithTarget?.ready, false);
assert.deepEqual(colorWithTarget?.blockingPreconditions, ["verified_foreground-color_target"]);
const colorWithGenericToolbarOnly = getKritaAction("set_color", {
  uiTargetIds: ["toolbar"],
  uiTargetRegions: ["toolbar"],
});
assert.equal(colorWithGenericToolbarOnly?.ready, false);
assert.deepEqual(colorWithGenericToolbarOnly?.blockingPreconditions, ["verified_foreground-color_target"]);
const renameWithGenericLayersOnly = getKritaAction("rename_layer", {
  uiTargetIds: ["layers-panel"],
  uiTargetRegions: ["layers_docker"],
});
assert.equal(renameWithGenericLayersOnly?.ready, false);
assert.ok(renameWithGenericLayersOnly?.blockingPreconditions.includes("verified_active-layer-name_target"));
const brush = getKritaAction("set_brush");
assert.equal(brush?.available, true);
assert.equal(brush?.supported, true);
assert.equal(brush?.execution, "ui-target");
assert.deepEqual(brush?.blockingPreconditions, ["verified_brush-presets_target"]);
const brushWithGenericRegionOnly = getKritaAction("set_brush", { uiTargetRegions: ["brush_presets_docker"] });
assert.equal(brushWithGenericRegionOnly?.ready, false);
assert.deepEqual(brushWithGenericRegionOnly?.blockingPreconditions, ["verified_brush-presets_target"]);
const brushWithTarget = getKritaAction("set_brush", { uiTargetIds: ["brush-presets"], uiTargetRegions: ["brush_presets_docker"] });
assert.equal(brushWithTarget?.ready, true);
assert.deepEqual(brushWithTarget?.blockingPreconditions, []);

const selectLayer = getKritaAction("select_layer", { uiTargetIds: ["layers-panel"], uiTargetRegions: ["layers_docker"] });
assert.equal(selectLayer?.supported, true);
assert.equal(selectLayer?.execution, "ui-target");
assert.equal(selectLayer?.ready, true);
assert.deepEqual(selectLayer?.blockingPreconditions, []);
const setLayer = getKritaAction("set_layer", { uiTargetIds: ["layers-panel"], uiTargetRegions: ["layers_docker"] });
assert.equal(setLayer?.supported, true);
assert.equal(setLayer?.execution, "ui-target");
assert.equal(setLayer?.ready, true);
assert.deepEqual(setLayer?.blockingPreconditions, []);
const brushWithGenericToolbarOnly = getKritaAction("set_brush_size", {
  uiTargetIds: ["toolbar"],
  uiTargetRegions: ["toolbar"],
});
assert.equal(brushWithGenericToolbarOnly?.ready, false);
assert.ok(brushWithGenericToolbarOnly?.blockingPreconditions.includes("verified_brush-size_target"));
assert.equal(getKritaAction("zoom_in")?.available, true);
assert.equal(getKritaAction("fit_canvas")?.shortcutCommand, "fit_canvas");
assert.equal(getKritaAction("batch")?.available, true);
assert.equal(getKritaAction("fill")?.available, true);
assert.equal(getKritaAction("fill")?.supported, true);
assert.equal(getKritaAction("fill")?.requiresCalibration, true);
assert.deepEqual(getKritaAction("fill")?.blockingPreconditions, [
  "validated_fill_tool_shortcut",
  "verified_calibration",
]);

assert.deepEqual(
  searchKritaActions("layer").map((action) => action.id),
  [
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
  ],
);
assert.deepEqual(searchKritaActions("  ").map((action) => action.id), actions.map((action) => action.id));
assert.equal(getKritaAction("missing-action"), undefined);

console.log("Krita action catalog tests passed");
