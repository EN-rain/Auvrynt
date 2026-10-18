import assert from "node:assert/strict";
import { buildDesktopIndicatorScript } from "./desktop-indicator.js";

const script = buildDesktopIndicatorScript();

assert.match(script, /NotifyIcon/);
assert.match(script, /Visible\s*=\s*\$true/);
assert.match(script, /Application\]::Run\(\$context\)/);
assert.doesNotMatch(script, /New-Object System\.Windows\.Forms\.Form/);
assert.doesNotMatch(script, /AUVRYNT DESKTOP CONTROL ACTIVE/);
assert.doesNotMatch(script, /Application::Run\(\$form\)/);

console.log("desktop indicator tray-only tests passed");
