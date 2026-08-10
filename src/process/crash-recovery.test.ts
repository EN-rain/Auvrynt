import assert from "node:assert/strict";
import {
  CRASH_RECOVERY_WINDOW_MS,
  MAX_CRASH_RECOVERY_ATTEMPTS,
  planCrashRecovery,
} from "./crash-recovery.js";

const base = planCrashRecovery({}, 1_000);
assert.equal(base.allowed, true);
assert.equal(base.attempt, 1);
assert.equal(base.environment.AUVRYNT_CRASH_WINDOW_STARTED_AT, "1000");

let environment = base.environment;
for (let attempt = 2; attempt <= MAX_CRASH_RECOVERY_ATTEMPTS; attempt++) {
  const plan = planCrashRecovery(environment, 1_000 + attempt);
  assert.equal(plan.allowed, true);
  assert.equal(plan.attempt, attempt);
  environment = plan.environment;
}

const blocked = planCrashRecovery(environment, 2_000);
assert.equal(blocked.allowed, false);
assert.equal(blocked.attempt, MAX_CRASH_RECOVERY_ATTEMPTS + 1);

const reset = planCrashRecovery(environment, 1_000 + CRASH_RECOVERY_WINDOW_MS + 1);
assert.equal(reset.allowed, true);
assert.equal(reset.attempt, 1);

console.log("Crash recovery tests passed!");
