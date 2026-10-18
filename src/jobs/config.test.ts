import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../infrastructure/config.js";

const configDir = mkdtempSync(join(tmpdir(), "auvrynt-jobs-config-"));
const baseEnv = {
  AUVRYNT_CONFIG_DIR: configDir,
  AUVRYNT_ALLOWED_ROOTS: process.cwd(),
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
};

const defaults = loadConfig(baseEnv);
assert.equal(defaults.jobs.enabled, true);
assert.equal(defaults.jobs.minimumMatchScore, 60);
assert.equal(defaults.jobs.riskAutoSkipScore, 80);
assert.equal(defaults.jobs.integrations.facebook.enabled, false);
assert.equal(defaults.jobs.integrations.facebook.appId, undefined);
assert.equal(defaults.jobs.integrations.facebook.appSecret, undefined);
assert.equal(defaults.jobs.integrations.facebook.graphVersion, "v22.0");

const configured = loadConfig({
  ...baseEnv,
  AUVRYNT_JOBS_ENABLED: "0",
  AUVRYNT_JOBS_MINIMUM_MATCH_SCORE: "72",
  AUVRYNT_JOBS_RISK_AUTO_SKIP_SCORE: "90",
  AUVRYNT_JOBS_FACEBOOK_ENABLED: "1",
  AUVRYNT_JOBS_FACEBOOK_APP_ID: "test-facebook-app",
  AUVRYNT_JOBS_FACEBOOK_APP_SECRET: "test-facebook-secret",
  AUVRYNT_JOBS_FACEBOOK_GRAPH_VERSION: "v23.0",
});
assert.equal(configured.jobs.enabled, false);
assert.equal(configured.jobs.minimumMatchScore, 72);
assert.equal(configured.jobs.riskAutoSkipScore, 90);
assert.equal(configured.jobs.integrations.facebook.enabled, true);
assert.equal(configured.jobs.integrations.facebook.appId, "test-facebook-app");
assert.equal(configured.jobs.integrations.facebook.appSecret, "test-facebook-secret");
assert.equal(configured.jobs.integrations.facebook.graphVersion, "v23.0");
assert.throws(() => loadConfig({ ...baseEnv, AUVRYNT_JOBS_MINIMUM_MATCH_SCORE: "101" }), /between 0 and 100/);
console.log("jobs config tests passed");
