import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchCloudflareTunnelToken,
  normalizeCloudflareAccountId,
  normalizeCloudflareTunnelId,
} from "./cloudflare-api-token.js";

const account = "a".repeat(32);
const tunnel = "12345678-1234-1234-1234-123456789abc";
const apiToken = "test-api-token-is-private";
const cloudflaredToken = "test-cloudflared-token-stored-privately";

test("Cloudflare tunnel IDs and account IDs are validated before requesting tokens", async () => {
  assert.equal(normalizeCloudflareAccountId(` ${account.toUpperCase()} `), account);
  assert.equal(normalizeCloudflareTunnelId(` ${tunnel.toUpperCase()} `), tunnel);
  assert.throws(() => normalizeCloudflareAccountId("../secrets"));
  assert.throws(() => normalizeCloudflareTunnelId("not-a-uuid"));
  await assert.rejects(fetchCloudflareTunnelToken(account, tunnel, "a\nb", async () => {
    throw new Error("should never be called");
  }), /API token/);
});

test("Cloudflare tunnel API returns only the connector token", async () => {
  let requests = 0;
  const result = await fetchCloudflareTunnelToken(account, tunnel, apiToken, async (url, init) => {
    requests++;
    assert.equal(String(url), `https://api.cloudflare.com/client/v4/accounts/${account}/cfd_tunnel/${tunnel}/token`);
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${apiToken}`);
    assert.equal(init?.redirect, "error");
    return Response.json({ success: true, result: cloudflaredToken });
  });
  assert.equal(requests, 1);
  assert.equal(result, cloudflaredToken);
});

test("Cloudflare API failures never expose the supplied secret", async () => {
  await assert.rejects(
    fetchCloudflareTunnelToken(account, tunnel, apiToken, async () =>
      new Response(JSON.stringify({ errors: [{ message: apiToken }] }), { status: 403 })),
    (error: unknown) => error instanceof Error && error.message.includes("HTTP 403") && !error.message.includes(apiToken),
  );
  await assert.rejects(
    fetchCloudflareTunnelToken(account, tunnel, apiToken, async () => { throw new Error(apiToken); }),
    (error: unknown) => error instanceof Error && !error.message.includes(apiToken),
  );
  await assert.rejects(
    fetchCloudflareTunnelToken(account, tunnel, apiToken, async () => Response.json({ success: false, result: apiToken })),
    /did not return a usable tunnel token/,
  );
});
