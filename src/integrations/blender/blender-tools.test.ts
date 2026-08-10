import assert from "node:assert/strict";
import { BlenderClient } from "./blender-client.js";

// Test host enforcement
assert.throws(() => new BlenderClient({ host: "0.0.0.0" }), /Forbidden host/);
assert.throws(() => new BlenderClient({ host: "192.168.1.1" }), /Forbidden host/);

assert.doesNotThrow(() => new BlenderClient({ host: "127.0.0.1" }));
assert.doesNotThrow(() => new BlenderClient({ host: "localhost" }));

console.log("BlenderClient unit tests passed!");
