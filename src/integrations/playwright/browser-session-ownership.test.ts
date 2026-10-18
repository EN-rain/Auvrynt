import assert from "node:assert/strict";
import { OwnedBrowserSessionRegistry } from "./browser-session-ownership.js";

interface FakeSession {
  id: string;
  ownerClientId: string;
  workspaceId: string;
  value: string;
}

const registry = new OwnedBrowserSessionRegistry<FakeSession>();
const sessionA: FakeSession = { id: "session-a", ownerClientId: "client-a", workspaceId: "ws-a", value: "A" };
const sessionB: FakeSession = { id: "session-b", ownerClientId: "client-b", workspaceId: "ws-b", value: "B" };
registry.add(sessionA);
registry.add(sessionB);

assert.equal(registry.getOwned("session-a", "client-a"), sessionA);
assert.throws(() => registry.getOwned("session-a", "client-b"), /Unknown browser session/i);
assert.throws(() => registry.getOwned("session-b", "client-a"), /Unknown browser session/i);
assert.deepEqual(registry.listOwned("client-a").map((session) => session.id), ["session-a"]);
assert.deepEqual(registry.listOwned("client-b").map((session) => session.id), ["session-b"]);
assert.deepEqual(registry.listOwned("client-a", "ws-b"), []);
assert.equal(registry.hasOwned("session-b", "client-a"), false);
assert.equal(registry.deleteOwned("session-b", "client-a"), undefined);
assert.equal(registry.hasOwned("session-b", "client-b"), true);
assert.equal(registry.deleteOwned("session-b", "client-b"), sessionB);
assert.equal(registry.hasOwned("session-b", "client-b"), false);

console.log("Browser session ownership tests passed!");
