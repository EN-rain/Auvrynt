import assert from "node:assert/strict";
import {
  cloudflareProfileCertPath,
  normalizeCloudflareProfileName,
  selectCloudflareProfile,
  upsertCloudflareProfile,
} from "./cloudflare-profiles.js";

const env = { AUVRYNT_CONFIG_DIR: "C:\\Users\\test\\.auvrynt" };
assert.equal(normalizeCloudflareProfileName(" Account-A "), "account-a");
assert.equal(
  cloudflareProfileCertPath("account-a", env),
  "C:\\Users\\test\\.auvrynt\\cloudflare\\account-a\\cert.pem",
);
assert.throws(() => normalizeCloudflareProfileName("../other"), /profile names/);

const first = upsertCloudflareProfile({}, "account-a", "C:\\Users\\test\\.auvrynt\\cloudflare\\account-a\\cert.pem");
assert.equal(first.cloudflareActiveProfile, "account-a");
const second = upsertCloudflareProfile(first, "account-b", "C:\\Users\\test\\.auvrynt\\cloudflare\\account-b\\cert.pem");
assert.deepEqual(second.cloudflareProfiles?.map((profile) => profile.name), ["account-a", "account-b"]);
assert.equal(selectCloudflareProfile(second, "account-b").cloudflareActiveProfile, "account-b");
assert.throws(
  () => upsertCloudflareProfile(second, "account-c", "C:\\Users\\test\\.auvrynt\\cloudflare\\account-c\\cert.pem"),
  /at most two/,
);
assert.throws(() => selectCloudflareProfile(second, "missing"), /not configured/);
console.log("Cloudflare profile tests passed!");
