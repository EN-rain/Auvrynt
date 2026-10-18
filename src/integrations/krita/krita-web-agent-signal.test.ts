import assert from "node:assert/strict";
import {
  KRITA_WEB_AGENT_ACTIONS,
  KRITA_WEB_AGENT_CONFIRMATION_TOOLS,
  KRITA_WEB_AGENT_SAFE_SMOKE_TOOLS,
  buildKritaWebAgentSignal,
} from "./krita-web-agent-signal.js";

const signal = buildKritaWebAgentSignal("krita-signal-test");
const actionNames = signal.actions.map((action) => action.tool);

assert.equal(signal.protocol, "auvrynt.krita.web-agent/v1");
assert.equal(signal.request, "try-all");
assert.equal(signal.mode, "no-plugin-desktop");
assert.equal(signal.workspaceId, "krita-signal-test");
assert.deepEqual(signal.safety, {
  pluginRequired: false,
  pluginUsed: false,
  bridgeRequired: false,
  arbitraryCodeExecution: false,
  automaticMutation: false,
});

assert.equal(new Set(actionNames).size, actionNames.length, "signal actions must be unique");
assert.equal(actionNames.length, 97, "the canonical no-plugin Krita signal inventory must include every registered action");
assert.ok(actionNames.includes("krita_web_agent_signal"));
assert.ok(actionNames.includes("krita_status"));
assert.ok(actionNames.includes("krita_auto_calibrate_canvas"));
assert.ok(actionNames.includes("krita_canvas_click"));
assert.ok(actionNames.includes("krita_stroke"));
assert.ok(actionNames.includes("krita_save"));
assert.ok(actionNames.includes("krita_probe_shortcut"));
assert.ok(actionNames.includes("krita_duplicate_layer"));
assert.ok(actionNames.includes("krita_prepare_shortcuts"));
assert.ok(actionNames.includes("krita_get_window"));
assert.ok(actionNames.includes("krita_readiness_report"));
assert.ok(actionNames.includes("krita_execute_transaction"));
assert.ok(actionNames.includes("krita_reset_canvas_rotation"));

assert.deepEqual(signal.safeSmoke.tools, KRITA_WEB_AGENT_SAFE_SMOKE_TOOLS);
assert.deepEqual(signal.explicitConfirmation.tools, KRITA_WEB_AGENT_CONFIRMATION_TOOLS);
const safeSmokeTools = new Set<string>(signal.safeSmoke.tools);
const explicitConfirmationTools = new Set<string>(signal.explicitConfirmation.tools);
assert.ok(signal.safeSmoke.tools.every((tool) => actionNames.includes(tool)));
assert.ok(signal.explicitConfirmation.tools.every((tool) => actionNames.includes(tool)));
assert.ok(signal.safeSmoke.tools.every((tool) => !explicitConfirmationTools.has(tool)));
assert.equal(
  new Set(["krita_web_agent_signal", ...signal.safeSmoke.tools, ...signal.explicitConfirmation.tools]).size,
  actionNames.length,
  "safe-smoke and explicit-confirmation partitions must reconcile with the canonical action inventory",
);
assert.ok(
  signal.agentInstructions.some((instruction) => /visible.*krita\.exe|krita\.exe.*visible/i.test(instruction)),
  "signal must tell the agent to stay inside the visible Krita process window",
);
assert.ok(signal.agentInstructions.some((instruction) => /covered|occluded/i.test(instruction)));
assert.ok(signal.agentInstructions.some((instruction) => /foreground.*input|background input/i.test(instruction)));

for (const action of signal.actions) {
  assert.ok(action.preconditions.length > 0, `${action.tool} must state its preconditions`);
  if (safeSmokeTools.has(action.tool)) {
    assert.equal(action.requiresExplicitConfirmation, false, `${action.tool} must be safe-smoke eligible`);
    if (action.tool === "krita_auto_calibrate_canvas") {
      assert.equal(action.sideEffect, "local-state");
    } else {
      assert.equal(action.sideEffect, "none", `${action.tool} must not mutate Krita during safe smoke`);
    }
  }
  if (explicitConfirmationTools.has(action.tool)) {
    assert.equal(action.requiresExplicitConfirmation, true, `${action.tool} must require confirmation`);
  }
}

assert.equal(
  signal.actions.find((action) => action.tool === "krita_get_canvas")?.preconditions.includes("valid_calibration"),
  true,
);
assert.equal(
  signal.actions.find((action) => action.tool === "krita_get_canvas")?.preconditions.includes("verified_calibration"),
  true,
);
assert.equal(
  signal.actions.find((action) => action.tool === "krita_canvas_click")?.preconditions.includes("verified_calibration"),
  true,
);
assert.equal(
  signal.actions.find((action) => action.tool === "krita_command")?.preconditions.includes("validated_shortcut"),
  true,
);

assert.throws(() => buildKritaWebAgentSignal(""), /workspaceId/i);
assert.throws(() => buildKritaWebAgentSignal("bad\nworkspace"), /workspaceId/i);
assert.throws(() => buildKritaWebAgentSignal("x".repeat(257)), /workspaceId/i);

console.log("Krita web-agent signal tests passed!");
