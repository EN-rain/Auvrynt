import assert from "node:assert/strict";
import {
  enqueueIntegration,
  clearIntegrationQueue,
  MAX_INTEGRATION_QUEUE_DEPTH,
} from "./integration-queue.js";

{
  const results: number[] = [];
  const p1 = enqueueIntegration("fifo", async () => { results.push(1); return 1; });
  const p2 = enqueueIntegration("fifo", async () => { results.push(2); return 2; });
  const p3 = enqueueIntegration("fifo", async () => { results.push(3); return 3; });

  assert.equal(await p1, 1);
  assert.equal(await p2, 2);
  assert.equal(await p3, 3);
  assert.deepEqual(results, [1, 2, 3]);
}

{
  const results: string[] = [];
  await assert.rejects(
    () => enqueueIntegration("exception-test", async () => { throw new Error("oops"); }),
    /oops/,
  );

  const value = await enqueueIntegration("exception-test", async () => {
    results.push("ran-after-error");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.deepEqual(results, ["ran-after-error"]);
}

clearIntegrationQueue("fifo");
clearIntegrationQueue("exception-test");

{
  const results: string[] = [];
  let startedBlocked!: () => void;
  const started = new Promise<void>((r) => { startedBlocked = r; });
  let release!: () => void;
  const blocked = enqueueIntegration("shutdown", async () => {
    startedBlocked();
    await new Promise<void>((r) => { release = r; });
    results.push("first");
    return 1;
  });
  const pending = enqueueIntegration("shutdown", async () => {
    results.push("second");
    return 2;
  });

  await started;
  release();
  await blocked;
  await pending;
  assert.deepEqual(results, ["first", "second"]);
  clearIntegrationQueue("shutdown");
}

{
  const count = MAX_INTEGRATION_QUEUE_DEPTH;
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(enqueueIntegration("many", async () => i));
  }
  const values = await Promise.all(promises);
  assert.equal(values.length, count);
  assert.equal(values[0], 0);
  assert.equal(values[count - 1], count - 1);
  clearIntegrationQueue("many");
}

{
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    const first = enqueueIntegration("test", async () => {
      resolve();
      await new Promise<void>((done) => { release = done; });
      return "first";
    });
    void first.then((value) => assert.equal(value, "first"));
  });

  await started;
  assert.throws(() => clearIntegrationQueue("test"), /active integration queue/);
  release();
  await new Promise((resolve) => setImmediate(resolve));

  const second = await enqueueIntegration("test", async () => "second");
  assert.equal(second, "second");
  assert.doesNotThrow(() => clearIntegrationQueue("test"));
}

{
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const active = enqueueIntegration("bounded", async () => {
    markStarted();
    await new Promise<void>((resolve) => { release = resolve; });
    return "active";
  });
  await started;

  const pending = Array.from({ length: MAX_INTEGRATION_QUEUE_DEPTH - 1 }, (_, index) =>
    enqueueIntegration("bounded", async () => index));
  assert.throws(
    () => enqueueIntegration("bounded", async () => "overflow"),
    /queue is full/,
  );

  release();
  assert.equal(await active, "active");
  assert.equal((await Promise.all(pending)).length, MAX_INTEGRATION_QUEUE_DEPTH - 1);
  clearIntegrationQueue("bounded");
}

console.log("Integration queue tests passed!");
