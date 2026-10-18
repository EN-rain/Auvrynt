import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDashboardCommandSupported,
  buildWindowsFolderPickerScript,
  parseAuvryntDashboardCommand,
  runAuvryntDashboardCommand,
} from "./dashboard-native-actions.js";

const windowsFolderPickerScript = buildWindowsFolderPickerScript();
assert.match(windowsFolderPickerScript, /D57C7288-D4AD-4768-BE02-9D969532D960/);
assert.doesNotMatch(windowsFolderPickerScript, /42f85136-db7e-439e-9acc-46061d997987/i);
assert.match(windowsFolderPickerScript, /FolderBrowserDialog/);
assert.match(windowsFolderPickerScript, /Test-Path -LiteralPath \$initial -PathType Container/);
assert.match(windowsFolderPickerScript, /Windows folder pickers are unavailable/);

assert.deepEqual(parseAuvryntDashboardCommand("auvrynt status"), {
  args: ["status"],
  env: {},
});
assert.deepEqual(
  parseAuvryntDashboardCommand('AUVRYNT_PUBLIC_BASE_URL="https://example.com" auvrynt config get'),
  {
    args: ["config", "get"],
    env: { AUVRYNT_PUBLIC_BASE_URL: "https://example.com" },
  },
);
assert.deepEqual(
  parseAuvryntDashboardCommand('AUVRYNT_ALLOWED_ROOTS="C:\\Projects\\Moonless" auvrynt status'),
  {
    args: ["status"],
    env: { AUVRYNT_ALLOWED_ROOTS: "C:\\Projects\\Moonless" },
  },
);
assert.throws(() => parseAuvryntDashboardCommand("git status"), /Only Auvrynt CLI commands/);
assert.throws(() => parseAuvryntDashboardCommand("HOME=x auvrynt status"), /Only AUVRYNT_/);
assert.throws(
  () => parseAuvryntDashboardCommand("AUVRYNT_OAUTH_OWNER_TOKEN=secret auvrynt status"),
  /Sensitive token/,
);
assert.throws(() => parseAuvryntDashboardCommand('auvrynt config set "broken'), /unclosed quote/);
assert.throws(() => assertDashboardCommandSupported([]), /specific non-interactive/);
assert.throws(() => assertDashboardCommandSupported(["serve"]), /already-running dashboard server/);
assert.throws(() => assertDashboardCommandSupported(["change"]), /workspace picker/);
assert.throws(() => assertDashboardCommandSupported(["token"]), /hidden from the dashboard/);
assert.throws(() => assertDashboardCommandSupported(["config", "get"]), /may contain local secrets/);
assert.throws(
  () => assertDashboardCommandSupported(["config", "set", "ngrokAuthtoken", "secret"]),
  /Sensitive configuration/,
);
assert.doesNotThrow(() => assertDashboardCommandSupported(["status"]));

const root = await mkdtemp(join(tmpdir(), "auvrynt-dashboard-command-"));
try {
  const entrypoint = join(root, "fake-auvrynt.mjs");
  await writeFile(entrypoint, [
    "console.log(JSON.stringify({",
    "  args: process.argv.slice(2),",
    "  baseUrl: process.env.AUVRYNT_PUBLIC_BASE_URL,",
    "}));",
  ].join("\n"), "utf8");

  const result = await runAuvryntDashboardCommand(
    'AUVRYNT_PUBLIC_BASE_URL="https://example.com" auvrynt status',
    root,
    entrypoint,
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.command, 'AUVRYNT_PUBLIC_BASE_URL="https://example.com" auvrynt status');
  assert.deepEqual(JSON.parse(result.output), {
    args: ["status"],
    baseUrl: "https://example.com",
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Dashboard native action and command runner tests passed!");
