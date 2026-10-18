import assert from "node:assert/strict";
import { captureWindowTitleNeedle } from "./desktop-capture.js";

assert.equal(
  captureWindowTitleNeedle("Krita", " [Not Saved]  (48.0 KiB) * - Krita"),
  "Krita",
  "capture validation must keep the caller's stable title query instead of freezing a dynamic document title",
);
assert.equal(
  captureWindowTitleNeedle("[Not Saved] - Krita", " [Not Saved]  - Krita"),
  "[Not Saved] - Krita",
  "explicit caller title queries remain unchanged",
);

console.log("desktop capture title-race tests passed");
