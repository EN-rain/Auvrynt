import assert from "node:assert/strict";
import {
  clearKritaShortcutProfile,
  getKritaShortcutProfile,
  markKritaShortcutsUnvalidated,
  markKritaShortcutsValidated,
  resetKritaShortcutBinding,
  getKritaRecommendedShortcuts,
  resolveKritaShortcut,
  setKritaShortcutBinding,
} from "./krita-shortcuts.js";

const workspaceId = "krita-shortcuts-test";
clearKritaShortcutProfile(workspaceId);

const initial = getKritaShortcutProfile(workspaceId);
assert.deepEqual(initial.bindings.new_document?.keys, ["CTRL", "N"]);
assert.equal(initial.bindings.new_document?.validated, false);
assert(initial.missingCommands.includes("new_layer"));
assert(initial.missingCommands.includes("transform_tool"));
assert.deepEqual(getKritaRecommendedShortcuts().select_rect, ["CTRL", "R"]);
assert.deepEqual(getKritaRecommendedShortcuts().move_layer_up, ["CTRL", "PAGEUP"]);
assert.deepEqual(getKritaRecommendedShortcuts().move_layer_down, ["CTRL", "PAGEDOWN"]);
assert.deepEqual(getKritaRecommendedShortcuts().select_previous_layer, ["PAGEUP"]);
assert.deepEqual(getKritaRecommendedShortcuts().select_next_layer, ["PAGEDOWN"]);
assert.equal(getKritaRecommendedShortcuts().toggle_layer_visibility, undefined);
assert.equal(getKritaRecommendedShortcuts().toggle_layer_lock, undefined);

assert.throws(
  () => resolveKritaShortcut(workspaceId, "new_document"),
  /not validated/i,
);

markKritaShortcutsValidated(workspaceId, ["new_document"]);
const validated = resolveKritaShortcut(workspaceId, "new_document");
assert.deepEqual(validated.keys, ["CTRL", "N"]);
assert.equal(validated.validated, true);

const overridden = setKritaShortcutBinding(workspaceId, "new_document", ["CTRL", "SHIFT", "N"]);
assert.deepEqual(overridden.bindings.new_document?.keys, ["CTRL", "SHIFT", "N"]);
assert.equal(overridden.bindings.new_document?.source, "override");
assert.equal(overridden.bindings.new_document?.validated, false);
assert.throws(() => resolveKritaShortcut(workspaceId, "new_document"), /not validated/i);

resetKritaShortcutBinding(workspaceId, "new_document");
assert.deepEqual(getKritaShortcutProfile(workspaceId).bindings.new_document?.keys, ["CTRL", "N"]);
assert.equal(getKritaShortcutProfile(workspaceId).bindings.new_document?.validated, false);

assert.throws(
  () => resolveKritaShortcut(workspaceId, "new_layer", { requireValidated: false }),
  /not configured/i,
);
setKritaShortcutBinding(workspaceId, "new_layer", ["INSERT"]);
assert.deepEqual(
  resolveKritaShortcut(workspaceId, "new_layer", { requireValidated: false }).keys,
  ["INSERT"],
);
markKritaShortcutsValidated(workspaceId, ["new_layer"]);
assert.equal(resolveKritaShortcut(workspaceId, "new_layer").validated, true);

markKritaShortcutsUnvalidated(workspaceId, ["new_layer"]);
assert.throws(() => resolveKritaShortcut(workspaceId, "new_layer"), /not validated/i);

assert.throws(
  () => setKritaShortcutBinding(workspaceId, "save", ["CTRL", "CTRL"]),
  /cannot repeat/i,
);

console.log("krita shortcut tests passed");
