import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryOAuthClientsStore, SingleUserOAuthProvider } from "./oauth-provider.js";

function client(redirectUri: string) {
  return {
    redirect_uris: [redirectUri],
    client_name: "Test client",
    token_endpoint_auth_method: "none" as const,
    grant_types: ["authorization_code", "refresh_token"] as const,
    response_types: ["code"] as const,
  };
}

const store = new InMemoryOAuthClientsStore(["example.com"]);

assert.throws(
  () => store.registerClient(client("http://example.com/callback") as any),
  /redirect_uri is not allowed/i,
);
assert.doesNotThrow(
  () => store.registerClient(client("https://example.com/callback") as any),
);
assert.doesNotThrow(
  () => store.registerClient(client("http://127.0.0.1:9911/callback") as any),
);
assert.doesNotThrow(
  () => store.registerClient(client("http://localhost:9911/callback") as any),
);
assert.throws(
  () => store.registerClient(client("javascript:alert(1)") as any),
  /redirect_uri is not allowed/i,
);

let protectedClientId = "";
const capacityStore = new InMemoryOAuthClientsStore(
  ["example.com"],
  [],
  undefined,
  (clientId) => clientId === protectedClientId,
);
const capacityClientIds: string[] = [];
for (let index = 0; index < 1024; index++) {
  capacityClientIds.push(
    capacityStore.registerClient(client(`https://example.com/callback/${index}`) as any).client_id,
  );
}
protectedClientId = capacityClientIds[0];
const replacementClient = capacityStore.registerClient(client("https://example.com/callback/replacement") as any);
assert.ok(capacityStore.getClient(protectedClientId));
assert.equal(capacityStore.getClient(capacityClientIds[1]), undefined);
assert.ok(capacityStore.getClient(replacementClient.client_id));
assert.equal(capacityStore.allClients().length, 1024);

const stateDir = await mkdtemp(join(tmpdir(), "auvrynt-oauth-"));
try {
  const stateFile = join(stateDir, "oauth-state.json");
  const resource = new URL("https://stable.example.com/mcp");
  const config = {
    ownerToken: "test-owner-token",
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 3600,
    scopes: ["auvrynt:read", "auvrynt:web"],
    allowedRedirectHosts: ["localhost"],
  };
  const first = new SingleUserOAuthProvider(config, resource, stateFile);
  const registered = (first.clientsStore as InMemoryOAuthClientsStore).registerClient(
    client("http://localhost:43119/callback") as any,
  );
  let redirect = "";
  await first.authorize(registered, {
    redirectUri: "http://localhost:43119/callback",
    codeChallenge: "test-challenge",
    scopes: ["auvrynt:read"],
    state: "test-state",
  }, {
    req: { method: "POST", body: { owner_token: config.ownerToken } },
    redirect: (_status: number, location: string) => {
      redirect = location;
    },
  } as any);
  const code = new URL(redirect).searchParams.get("code");
  assert.ok(code);
  const tokens = await first.exchangeAuthorizationCode(registered, code);

  const restarted = new SingleUserOAuthProvider(config, resource, stateFile);
  const restoredClient = await restarted.clientsStore.getClient(registered.client_id);
  assert.ok(restoredClient);
  const authInfo = await restarted.verifyAccessToken(tokens.access_token);
  assert.equal(authInfo.clientId, registered.client_id);
  assert.deepEqual(authInfo.scopes, ["auvrynt:read"]);

  assert.equal(restarted.grantScopesToExistingTokens(["auvrynt:web", "not-configured"]), 2);
  const expandedAuthInfo = await restarted.verifyAccessToken(tokens.access_token);
  assert.deepEqual(expandedAuthInfo.scopes, ["auvrynt:read", "auvrynt:web"]);
  assert.ok(tokens.refresh_token);
  const refreshed = await restarted.exchangeRefreshToken(restoredClient, tokens.refresh_token);
  assert.match(refreshed.scope ?? "", /auvrynt:web/);

  // Header-only clients (Clusy): Owner token works as Bearer without /authorize.
  const ownerBearer = await restarted.verifyAccessToken(config.ownerToken);
  assert.equal(ownerBearer.clientId, "auvrynt-owner-bearer");
  assert.deepEqual(ownerBearer.scopes, ["auvrynt:read", "auvrynt:web"]);
  await assert.rejects(() => restarted.verifyAccessToken("wrong-owner-token"));
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
