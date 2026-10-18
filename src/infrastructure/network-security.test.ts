import assert from "node:assert/strict";
import {
  assertSafeWebUrl,
  validateWebUrl,
  type DnsResolver,
} from "./network-security.js";

assert.equal(validateWebUrl("https://example.com/path"), "https://example.com/path");
assert.throws(() => validateWebUrl("file:///etc/passwd"), /unsafe scheme/i);
assert.throws(() => validateWebUrl("https://user:pass@example.com"), /embedded credentials/i);
assert.throws(() => validateWebUrl("http://169.254.169.254/latest/meta-data/"), /Blocked SSRF/i);
assert.throws(() => validateWebUrl("http://10.0.0.1/admin"), /Blocked SSRF/i);
assert.throws(() => validateWebUrl("http://[fc00::1]/"), /Blocked SSRF/i);

await assert.rejects(() => assertSafeWebUrl("http://127.0.0.1:3000/"), /loopback/i);
assert.equal(
  await assertSafeWebUrl("http://127.0.0.1:3000/", true),
  "http://127.0.0.1:3000/",
);

const privateResolver: DnsResolver = async () => [{ address: "10.0.0.7", family: 4 }];
await assert.rejects(
  () => assertSafeWebUrl("https://example.com/resource", false, privateResolver),
  /resolved to non-public address/i,
);

const mixedResolver: DnsResolver = async () => [
  { address: "93.184.216.34", family: 4 },
  { address: "169.254.169.254", family: 4 },
];
await assert.rejects(
  () => assertSafeWebUrl("https://example.com/resource", false, mixedResolver),
  /resolved to non-public address/i,
);

const publicResolver: DnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];
assert.equal(
  await assertSafeWebUrl("https://example.com/resource", false, publicResolver),
  "https://example.com/resource",
);

console.log("Network security tests passed!");
