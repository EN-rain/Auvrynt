import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FacebookOAuthError, FacebookOAuthManager, type FacebookOAuthConfig } from "./integrations/facebook/facebook-oauth.js";
import { JobsStore } from "./store.js";

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-facebook-oauth-"));
const config: FacebookOAuthConfig = {
  enabled: true,
  appId: "test-app-id",
  appSecret: "test-app-secret",
  graphVersion: "v22.0",
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } } as Response;
}

const requests: Array<{ url: string; init?: RequestInit }> = [];
const manager = new FacebookOAuthManager({
  fetch: async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/oauth/access_token")) return jsonResponse({ access_token: "long-lived-test-token", expires_in: 3600 });
    if (url.endsWith("/me?fields=id%2Cname")) return jsonResponse({ id: "account-42", name: "Test Person" });
    return jsonResponse({ error: "unexpected request" }, 404);
  },
});

let store = new JobsStore(stateDir);
try {
  const authorizationUrl = manager.begin(config, "http://127.0.0.1:49321/dashboard/jobs/integrations/facebook/callback");
  const parsed = new URL(authorizationUrl);
  assert.equal(parsed.origin, "https://www.facebook.com");
  assert.equal(parsed.pathname, "/dialog/oauth");
  assert.equal(parsed.searchParams.get("client_id"), "test-app-id");
  assert.equal(parsed.searchParams.get("scope"), "public_profile");
  const state = parsed.searchParams.get("state");
  assert.ok(state);

  const connected = await manager.complete(config, store, {
    state,
    code: "one-time-code",
    redirectUri: "http://127.0.0.1:49321/dashboard/jobs/integrations/facebook/callback",
  });
  assert.equal(connected.accountId, "account-42");
  assert.equal(connected.accountName, "Test Person");
  assert.equal(store.listIntegrations().find((item) => item.provider === "facebook")?.status, "connected");
  assert.equal(store.listIntegrations().find((item) => item.provider === "facebook")?.accountLabel, "Test Person");
  assert.equal(store.getFacebookAccessToken(), "long-lived-test-token");
  assert.equal(requests.length, 2);
  assert.equal(String(requests[0].init?.body), "client_id=test-app-id&client_secret=test-app-secret&redirect_uri=http%3A%2F%2F127.0.0.1%3A49321%2Fdashboard%2Fjobs%2Fintegrations%2Ffacebook%2Fcallback&code=one-time-code");
  assert.match(String(requests[1].init?.headers && new Headers(requests[1].init?.headers).get("authorization")), /^Bearer /);
  assert.doesNotMatch(JSON.stringify(store.listIntegrations()), /long-lived-test-token/);

  store.close();
  store = new JobsStore(stateDir);
  assert.equal(store.getFacebookAccessToken(), "long-lived-test-token");
  assert.equal(store.listIntegrations().find((item) => item.provider === "facebook")?.accountLabel, "Test Person");

  await assert.rejects(
    manager.complete(config, store, { state, code: "replay", redirectUri: "http://127.0.0.1:49321/dashboard/jobs/integrations/facebook/callback" }),
    (error: unknown) => error instanceof FacebookOAuthError && error.code === "INVALID_CALLBACK",
  );
  assert.equal(store.disconnectFacebook()?.status, "disabled");
  assert.equal(store.getFacebookAccessToken(), undefined);
  console.log("facebook oauth tests passed");
} finally {
  store.close();
  rmSync(stateDir, { recursive: true, force: true });
}
