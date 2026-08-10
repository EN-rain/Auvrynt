import assert from "node:assert/strict";
import { loadPlaywright, normalizePlaywrightModule } from "./playwright-runtime.js";

const launcher = async () => undefined;
const esmShape = { chromium: { launch: launcher } };
const commonJsShape = { default: esmShape };

assert.equal(normalizePlaywrightModule(esmShape), esmShape);
assert.equal(normalizePlaywrightModule(commonJsShape), esmShape);
assert.throws(
  () => normalizePlaywrightModule({ default: {} }),
  /Chromium launcher is unavailable/,
);

const installedPlaywright = await loadPlaywright();
assert.equal(typeof installedPlaywright.chromium.launch, "function");
