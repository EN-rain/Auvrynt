import assert from "node:assert/strict";
import { decodePngRgba } from "./krita-png-decoder.js";

const onePixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const decoded = decodePngRgba(onePixel);
assert.equal(decoded.width, 1);
assert.equal(decoded.height, 1);
assert.deepEqual([...decoded.data], [0, 0, 0, 255]);
assert.throws(() => decodePngRgba(Buffer.from("not-a-png")), /PNG/i);

console.log("Krita PNG decoder tests passed");
