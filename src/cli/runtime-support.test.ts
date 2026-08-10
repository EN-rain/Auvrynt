import assert from "node:assert/strict";
import {
  dashboardUrl,
  RUNNING_COMMAND_HINTS,
} from "./cli/runtime-support.js";

assert.equal(dashboardUrl("127.0.0.1", 49321), "http://127.0.0.1:49321/dashboard");
assert.equal(dashboardUrl("0.0.0.0", 49321), "http://127.0.0.1:49321/dashboard");
assert.equal(dashboardUrl("::", 49321), "http://127.0.0.1:49321/dashboard");
assert.equal(dashboardUrl("::1", 49321), "http://[::1]:49321/dashboard");
assert.deepEqual(RUNNING_COMMAND_HINTS, [
  "# auvrynt token  — show the owner token for authentication",
  "# auvrynt stop   — stop Auvrynt and exit",
]);
