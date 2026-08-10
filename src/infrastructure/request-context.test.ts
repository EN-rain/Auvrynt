import assert from "node:assert/strict";
import { runWithContext, getRequestContext, requireRequestContext } from "./request-context.js";

assert.equal(getRequestContext(), undefined);

const ctx = { sessionId: "sess1", ownerClientId: "client1", authScopes: ["auvrynt:read"] as readonly string[] };

runWithContext(ctx, () => {
  const current = getRequestContext();
  assert.equal(current?.sessionId, "sess1");
  assert.equal(current?.ownerClientId, "client1");
  assert.deepEqual(current?.authScopes, ["auvrynt:read"]);
});

assert.equal(getRequestContext(), undefined);

const result = await runWithContext(ctx, async () => {
  await new Promise((r) => setTimeout(r, 5));
  return getRequestContext()?.sessionId;
});
assert.equal(result, "sess1");

const ctxA = { sessionId: "sessA", ownerClientId: "clientA", authScopes: [] as readonly string[] };
const ctxB = { sessionId: "sessB", ownerClientId: "clientB", authScopes: [] as readonly string[] };

const [resA, resB] = await Promise.all([
  runWithContext(ctxA, async () => {
    await new Promise((r) => setTimeout(r, 10));
    return getRequestContext()?.sessionId;
  }),
  runWithContext(ctxB, async () => {
    await new Promise((r) => setTimeout(r, 5));
    return getRequestContext()?.sessionId;
  }),
]);
assert.equal(resA, "sessA");
assert.equal(resB, "sessB");

const outerCtx = { sessionId: "outer", ownerClientId: "outerClient", authScopes: [] as readonly string[] };
const innerCtx = { sessionId: "inner", ownerClientId: "innerClient", authScopes: [] as readonly string[] };

runWithContext(outerCtx, () => {
  assert.equal(getRequestContext()?.sessionId, "outer");

  runWithContext(innerCtx, () => {
    assert.equal(getRequestContext()?.sessionId, "inner");
  });

  assert.equal(getRequestContext()?.sessionId, "outer");
});

assert.equal(getRequestContext(), undefined);

assert.throws(() => requireRequestContext(), /No request context/);

runWithContext(ctx, () => {
  const current = requireRequestContext();
  assert.equal(current.sessionId, "sess1");
  assert.equal(current.ownerClientId, "client1");
});

console.log("Request context tests passed!");
