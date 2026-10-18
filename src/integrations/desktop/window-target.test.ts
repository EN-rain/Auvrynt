import assert from "node:assert/strict";
import { selectDesktopWindow, selectOccludingDesktopWindows, selectOwnedDesktopWindows, type DesktopWindowCandidate } from "./window-target.js";

const main: DesktopWindowCandidate = {
  handle: "100",
  processId: 17936,
  processName: "krita",
  title: "Krita",
  visible: true,
  minimized: false,
  isMainWindow: true,
  zOrder: 1,
  ownerHandle: undefined,
  rootOwnerHandle: undefined,
  bounds: { x: 100, y: 100, width: 800, height: 600 },
};
const popup: DesktopWindowCandidate = {
  handle: "200",
  processId: 17936,
  processName: "krita",
  title: "Create new document - Krita",
  visible: true,
  minimized: false,
  isMainWindow: false,
  zOrder: 0,
  ownerHandle: "100",
  rootOwnerHandle: "100",
  bounds: { x: 150, y: 150, width: 200, height: 100 },
};
const minimizedPopup: DesktopWindowCandidate = { ...popup, handle: "201", minimized: true };
const unrelatedKritaWindow: DesktopWindowCandidate = {
  ...popup,
  handle: "202",
  title: "Krita Tool Window",
  ownerHandle: "999",
  rootOwnerHandle: "999",
  bounds: { x: 0, y: 0, width: 200, height: 100 },
};
const unsavedKrita: DesktopWindowCandidate = {
  ...main,
  handle: "3605672",
  title: " [Not Saved]  - Krita",
};
const other: DesktopWindowCandidate = {
  handle: "300",
  processId: 21916,
  processName: "chrome",
  title: "Create new document - Krita",
  visible: true,
  minimized: false,
  isMainWindow: true,
  zOrder: 0,
  bounds: { x: 50, y: 50, width: 500, height: 400 },
};
const edgeStrip: DesktopWindowCandidate = {
  ...other,
  handle: "400",
  zOrder: 0,
  bounds: { x: 0, y: 690, width: 800, height: 10 },
};
const tinyShellWindow: DesktopWindowCandidate = {
  ...other,
  handle: "401",
  zOrder: 0,
  bounds: { x: 100, y: 100, width: 1, height: 1 },
};
const candidates = [other, popup, main, minimizedPopup, unrelatedKritaWindow];

assert.equal(selectDesktopWindow(candidates, { title: "Krita", processName: "krita" })?.handle, "100");
assert.equal(selectDesktopWindow(candidates, { title: "Create new document - Krita", processName: "krita" })?.handle, "200");
assert.equal(selectDesktopWindow(candidates, { handle: "200", processName: "krita" })?.handle, "200");
assert.equal(selectDesktopWindow(candidates, { processId: 17936 })?.handle, "100");
assert.equal(selectDesktopWindow(candidates, { handle: "201", processName: "krita" }), undefined);
assert.equal(
  selectDesktopWindow(candidates, { handle: "201", processName: "krita", includeMinimized: true })?.handle,
  "201",
  "read-only Krita status may inspect a visible but minimized main window",
);
assert.equal(selectDesktopWindow(candidates, { title: "Create new document - Krita", processName: "notepad" }), undefined);
assert.deepEqual(
  selectOwnedDesktopWindows(candidates, main, { includeMinimized: true }).map((candidate) => candidate.handle),
  ["200", "201"],
  "owned popup discovery must exclude unrelated windows and other processes even for diagnostics",
);
assert.deepEqual(
  selectOwnedDesktopWindows(candidates, main, { includeMinimized: false }).map((candidate) => candidate.handle),
  ["200"],
  "popup capture defaults to visible, non-minimized windows",
);
assert.deepEqual(
  selectOccludingDesktopWindows([other, edgeStrip, tinyShellWindow, popup, main, minimizedPopup, unrelatedKritaWindow], main).map((candidate) => candidate.handle),
  ["300"],
  "occlusion must include only meaningful visible foreign overlap, not shell-sized or edge strips",
);
assert.equal(
  selectDesktopWindow([unsavedKrita], { title: "[Not Saved] - Krita", processName: "krita" })?.handle,
  "3605672",
  "Krita window titles must tolerate Windows-added whitespace around the document marker",
);
assert.equal(
  selectDesktopWindow([unsavedKrita], { handle: "3605672", title: "[Not Saved] - Krita", processName: "krita" })?.handle,
  "3605672",
  "an explicitly confirmed Krita handle must remain selectable with a normalized title",
);

console.log("desktop window target tests passed");
