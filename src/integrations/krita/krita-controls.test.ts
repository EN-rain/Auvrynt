import assert from "node:assert/strict";
import { listKritaApprovedBrushes, normalizeKritaBrushSize, normalizeKritaColor } from "./krita-controls.js";

assert.equal(normalizeKritaBrushSize(14.126), 14.13);
assert.equal(normalizeKritaColor("4a90e2"), "#4A90E2");
assert.throws(() => normalizeKritaColor("rgb(1,2,3)"), /RRGGBB/i);
assert.equal(listKritaApprovedBrushes().length, 4);

console.log("Krita control tests passed");
