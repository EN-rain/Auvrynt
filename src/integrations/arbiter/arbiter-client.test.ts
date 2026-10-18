import assert from "node:assert/strict";
import { ArbiterClient, ArbiterClientError } from "./arbiter-client.js";

const originalFetch = globalThis.fetch;

try {
  let request: { url: string; headers: Headers; body: string } | undefined;
  globalThis.fetch = async (input, init) => {
    request = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    };
    return new Response(JSON.stringify({
      model: "laya-typed-decisions",
      answers: {
        action: {
          type: "choice",
          choice: "review",
          probabilities: { allow: 0.1, review: 0.8, deny: 0.1 },
          confidence: 0.8,
        },
      },
      latency_ms: 12.5,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const client = new ArbiterClient({
    endpoint: "https://arbiter.example.test/",
    apiKey: "arbiter-secret",
    model: "laya-typed-decisions",
    timeoutMs: 2_000,
  });
  const result = await client.decide({
    state: "A destructive command was requested.",
    questions: {
      action: {
        type: "choice",
        instructions: "What should happen?",
        criteria: { allow: "safe", review: "human review", deny: "unsafe" },
      },
    },
  });

  assert.equal(request?.url, "https://arbiter.example.test/v1/systemone");
  assert.equal(request?.headers.get("authorization"), "Bearer arbiter-secret");
  assert.equal(request?.headers.get("content-type"), "application/json");
  assert.equal(JSON.parse(request?.body ?? "{}").model, "laya-typed-decisions");
  assert.equal(result.answers.action.choice, "review");
} finally {
  globalThis.fetch = originalFetch;
}

try {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "not useful to callers" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(
    () => new ArbiterClient({
      endpoint: "https://arbiter.example.test",
      apiKey: "secret-that-must-not-appear",
      model: "laya-typed-decisions",
      timeoutMs: 2_000,
    }).ready(),
    (error: unknown) => {
      assert.ok(error instanceof ArbiterClientError);
      assert.equal(error.kind, "unauthorized");
      assert.doesNotMatch(error.message, /secret-that-must-not-appear|not useful to callers/);
      return true;
    },
  );
} finally {
  globalThis.fetch = originalFetch;
}

for (const { status, kind } of [
  { status: 422, kind: "invalid_request" },
  { status: 503, kind: "unavailable" },
] as const) {
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "internal detail" }), {
      status,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      () => new ArbiterClient({
        endpoint: "https://arbiter.example.test",
        apiKey: "never-echo-key",
        model: "laya-typed-decisions",
        timeoutMs: 2_000,
      }).ready(),
      (error: unknown) => {
        assert.ok(error instanceof ArbiterClientError);
        assert.equal(error.kind, kind);
        assert.equal(error.status, status);
        assert.doesNotMatch(error.message, /never-echo-key|internal detail/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

try {
  globalThis.fetch = async () => new Response(JSON.stringify({ answers: [] }), { status: 200 });
  await assert.rejects(
    () => new ArbiterClient({
      endpoint: "https://arbiter.example.test",
      apiKey: "key",
      model: "laya-typed-decisions",
      timeoutMs: 2_000,
    }).decide({ state: "state", questions: { question: { type: "noul", instructions: "Check." } } }),
    (error: unknown) => error instanceof ArbiterClientError && error.kind === "invalid_response",
  );
} finally {
  globalThis.fetch = originalFetch;
}

for (const { rejection, kind } of [
  { rejection: new DOMException("request timed out", "TimeoutError"), kind: "timeout" },
  { rejection: new TypeError("network down"), kind: "unavailable" },
] as const) {
  try {
    globalThis.fetch = async () => { throw rejection; };
    await assert.rejects(
      () => new ArbiterClient({
        endpoint: "https://arbiter.example.test",
        apiKey: "key",
        model: "laya-typed-decisions",
        timeoutMs: 2_000,
      }).ready(),
      (error: unknown) => error instanceof ArbiterClientError && error.kind === kind,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("Arbiter client tests passed!");
