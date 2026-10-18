import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../../infrastructure/config.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";
import { browserSessionAllowsLoopbackForUrl } from "./browser-session.js";
import { assertSafeWebUrl, validateWebUrl } from "./web-tools.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-web-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);

  // 1. Valid local dev URLs
  assert.equal(validateWebUrl("http://localhost:3000"), "http://localhost:3000/");
  assert.equal(validateWebUrl("http://127.0.0.1:8080/app"), "http://127.0.0.1:8080/app");
  assert.equal(validateWebUrl("https://example.com"), "https://example.com/");

  // 2. Blocked unsafe schemes
  assert.throws(() => validateWebUrl("file:///C:/etc/passwd"), /Blocked unsafe scheme/i);
  assert.throws(() => validateWebUrl("javascript:alert(1)"), /Blocked unsafe scheme/i);
  assert.throws(() => validateWebUrl("data:text/html,hi"), /Blocked unsafe scheme/i);

  // 3. SSRF Protection (Cloud metadata & internal IP blocking)
  assert.throws(() => validateWebUrl("http://169.254.169.254/latest/meta-data/"), /Blocked SSRF/i);
  assert.throws(() => validateWebUrl("http://10.0.0.1/admin"), /Blocked SSRF/i);
  assert.throws(() => validateWebUrl("http://192.168.1.1/router"), /Blocked SSRF/i);
  assert.throws(() => validateWebUrl("http://100.64.0.1/"), /Blocked SSRF/i);
  assert.throws(() => validateWebUrl("http://[fc00::1]/"), /Blocked SSRF/i);
  assert.throws(() => validateWebUrl("https://user:pass@example.com/"), /embedded credentials/i);

  // 4. Request-level validation distinguishes intentional local dev pages from remote SSRF.
  await assert.rejects(() => assertSafeWebUrl("http://127.0.0.1:3000/"), /loopback/i);
  assert.equal(
    await assertSafeWebUrl("http://127.0.0.1:3000/", true),
    "http://127.0.0.1:3000/",
  );
  await assert.rejects(() => assertSafeWebUrl("http://169.254.169.254/", true), /non-public/i);

  // 5. Persistent browser sessions do not inherit loopback access just because they start blank.
  assert.equal(browserSessionAllowsLoopbackForUrl(undefined), false);
  assert.equal(browserSessionAllowsLoopbackForUrl("about:blank"), false);
  assert.equal(browserSessionAllowsLoopbackForUrl("https://example.com/"), false);
  assert.equal(browserSessionAllowsLoopbackForUrl("http://127.0.0.1:3000/"), true);
  assert.equal(browserSessionAllowsLoopbackForUrl("http://localhost:5173/"), true);
} finally {
  await rm(root, { recursive: true, force: true });
}
