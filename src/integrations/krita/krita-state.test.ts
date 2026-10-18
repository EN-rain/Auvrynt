import assert from "node:assert/strict";
import {
  KRITA_TRACKED_STATE_FIELDS,
  clearKritaExpectedState,
  getKritaExpectedState,
  markKritaStateUnknown,
  markKritaStateVisuallyVerified,
  resetKritaExpectedState,
  updateKritaExpectedState,
} from "./krita-state.js";

const workspaceId = "krita-state-test";
clearKritaExpectedState(workspaceId);

const empty = getKritaExpectedState(workspaceId);
assert.deepEqual(empty.uncertainFields, [...KRITA_TRACKED_STATE_FIELDS]);
for (const field of KRITA_TRACKED_STATE_FIELDS) {
  assert.equal(empty.fields[field].confidence, "unknown");
  assert.equal(empty.fields[field].value, undefined);
}

const expected = updateKritaExpectedState(workspaceId, {
  activeTool: "freehand_brush",
  brushSize: 20,
  foregroundColor: "#12abef",
}, { confidence: "expected", source: "test-action" });
assert.equal(expected.fields.activeTool.value, "freehand_brush");
assert.equal(expected.fields.activeTool.confidence, "expected");
assert.equal(expected.fields.brushSize.value, 20);
assert.equal(expected.fields.foregroundColor.value, "#12ABEF");
assert(expected.uncertainFields.includes("activeTool"));

const verified = markKritaStateVisuallyVerified(workspaceId, ["activeTool", "brushSize"]);
assert.equal(verified.fields.activeTool.confidence, "visually_verified");
assert.equal(verified.fields.brushSize.confidence, "visually_verified");
assert(!verified.uncertainFields.includes("activeTool"));
assert(!verified.uncertainFields.includes("brushSize"));
assert(verified.uncertainFields.includes("foregroundColor"));

const unknown = markKritaStateUnknown(workspaceId, ["activeTool"], "external-change");
assert.equal(unknown.fields.activeTool.confidence, "unknown");
assert.equal(unknown.fields.activeTool.value, undefined);
assert(unknown.uncertainFields.includes("activeTool"));

assert.throws(
  () => updateKritaExpectedState(workspaceId, { foregroundColor: "not-a-color" }),
  /foregroundColor/i,
);
assert.throws(
  () => markKritaStateVisuallyVerified(workspaceId, ["activeTool"]),
  /no expected value/i,
);

const reset = resetKritaExpectedState(workspaceId);
assert.deepEqual(reset.uncertainFields, [...KRITA_TRACKED_STATE_FIELDS]);
assert.equal(reset.fields.brushSize.value, undefined);

console.log("krita expected-state tests passed");
