import assert from "node:assert/strict";
import { WorkerLanePool } from "./worker-lanes.js";

const pool = new WorkerLanePool(4);
const first = pool.reserveMany(["a", "b", "c", "d"]);
assert.deepEqual(first.map((lease) => lease.workerId), ["W1", "W2", "W3", "W4"]);
assert.equal(pool.snapshot().available, 0);
assert.equal(pool.snapshot().elastic, true);

const fifth = pool.reserve("e");
assert.equal(fifth.workerId, "W5");
assert.equal(pool.snapshot().capacity, 5);
assert.equal(pool.snapshot().active, 5);

assert.equal(pool.releaseByTask("b"), true);
const replacement = pool.reserve("f");
assert.equal(replacement.workerId, "W2");
const rebound = pool.rebind(replacement.leaseId, "f-thread");
assert.equal(rebound.taskKey, "f-thread");

pool.release(rebound.leaseId);
const restored = pool.restore("W2", "restored-thread");
assert.equal(restored.workerId, "W2");
assert.equal(pool.snapshot().active, 5);

const recoveryPool = new WorkerLanePool(0);
const highRestored = recoveryPool.restore("W128", "persisted-thread");
assert.equal(highRestored.workerId, "W128");
const nextAfterRestore = recoveryPool.reserve("new-thread");
assert.equal(nextAfterRestore.workerId, "W129");
assert.equal(recoveryPool.snapshot().capacity, 2);

const elasticBatch = new WorkerLanePool(0).reserveMany(
  Array.from({ length: 100 }, (_, index) => `task-${index + 1}`),
);
assert.equal(elasticBatch.length, 100);
assert.equal(elasticBatch.at(-1)?.workerId, "W100");

console.log("Worker lane pool tests passed!");
