import assert from "node:assert/strict";
import { retryControlRequest } from "./control-retry.js";

function response(status: number, retryAfter?: string) {
  let cancelled = false;
  return {
    status,
    headers: { get: (name: string) => name.toLowerCase() === "retry-after" ? retryAfter ?? null : null },
    body: { cancel: async () => { cancelled = true; } },
    wasCancelled: () => cancelled,
  };
}

{
  const responses = [response(502), response(409, "1"), response(200)];
  const delays: number[] = [];
  const result = await retryControlRequest(async () => responses.shift()!, {
    initialDelayMs: 100,
    maxDelayMs: 500,
    sleep: async (delay) => { delays.push(delay); },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(delays, [100, 500]);
}

{
  let attempts = 0;
  await assert.rejects(
    () => retryControlRequest(async () => {
      attempts++;
      throw new Error("temporary network failure");
    }, { maxAttempts: 3, sleep: async () => undefined }),
    /temporary network failure/,
  );
  assert.equal(attempts, 3);
}

{
  let attempts = 0;
  const result = await retryControlRequest(async () => {
    attempts++;
    return response(400);
  }, { sleep: async () => undefined });
  assert.equal(result.status, 400);
  assert.equal(attempts, 1);
}

console.log("Control retry tests passed!");
