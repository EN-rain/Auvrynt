import assert from "node:assert/strict";
import {
  closeBrowserWithDeadline,
  shouldEmbedScreenshot,
} from "./browser-stability.js";

{
  let closed = false;
  const result = await closeBrowserWithDeadline({
    close: async () => { closed = true; },
  }, 25);
  assert.equal(closed, true);
  assert.deepEqual(result, { closed: true, forceKilled: false });
}

{
  let killedWith = "";
  const result = await closeBrowserWithDeadline({
    close: async () => await new Promise<void>(() => undefined),
    process: () => ({
      kill: (signal?: string) => {
        killedWith = signal ?? "";
        return true;
      },
    }),
  }, 5);
  assert.equal(killedWith, "SIGKILL");
  assert.deepEqual(result, { closed: false, forceKilled: true });
}

assert.equal(shouldEmbedScreenshot(100, 0, 200, 400), true);
assert.equal(shouldEmbedScreenshot(201, 0, 200, 400), false);
assert.equal(shouldEmbedScreenshot(200, 250, 200, 400), false);

console.log("Browser stability tests passed!");
