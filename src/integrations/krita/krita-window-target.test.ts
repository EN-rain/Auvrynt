import assert from "node:assert/strict";
import {
  isKritaWindowTarget,
  regionInsideWindow,
  type KritaWindowTargetDescriptor,
} from "./krita-window-target.js";

const target: KritaWindowTargetDescriptor = {
  processName: "krita",
  title: "painting.kra — Krita",
  minimized: false,
  bounds: { x: 100, y: 80, width: 1200, height: 900 },
};

assert.equal(isKritaWindowTarget(target), true);
assert.equal(isKritaWindowTarget({ ...target, processName: "notepad" }), false);
assert.equal(isKritaWindowTarget({ ...target, title: "Krita helper" }), false);
assert.equal(isKritaWindowTarget({ ...target, minimized: true }), false);

assert.equal(regionInsideWindow({ x: 20, y: 30, width: 400, height: 300 }, target.bounds), true);
assert.equal(regionInsideWindow({ x: 1000, y: 30, width: 400, height: 300 }, target.bounds), false);
assert.equal(regionInsideWindow({ x: 20, y: 30, width: 0, height: 300 }, target.bounds), false);

console.log("krita window target tests passed");
