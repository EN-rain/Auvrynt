import assert from "node:assert/strict";
import { virtualKeyForName } from "./desktop-input.js";

assert.equal(virtualKeyForName("+"), 0x6b, "Krita plus zoom binding must use VK_ADD");
assert.equal(virtualKeyForName("PLUS"), 0x6b, "PLUS is an alias for VK_ADD");
assert.equal(virtualKeyForName("ADD"), 0x6b, "ADD must map to VK_ADD");
assert.equal(virtualKeyForName("-"), 0x6d, "Krita minus zoom binding must use VK_SUBTRACT");
assert.equal(virtualKeyForName("MINUS"), 0x6d, "MINUS is an alias for VK_SUBTRACT");
assert.equal(virtualKeyForName("SUBTRACT"), 0x6d, "SUBTRACT must map to VK_SUBTRACT");
assert.throws(() => virtualKeyForName("not-a-key"), /Unsupported key name/);

console.log("desktop input virtual-key tests passed");
