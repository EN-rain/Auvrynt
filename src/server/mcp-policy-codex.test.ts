import assert from "node:assert/strict";
import { requiredScopesForToolName, toolIntegrationEnabled } from "./mcp-policy.js";

assert.deepEqual(requiredScopesForToolName("codex_status"), ["auvrynt:read", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("codex_monitor_run"), ["auvrynt:read", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("codex_get_result"), ["auvrynt:read", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("codex_spawn_agent"), ["auvrynt:write", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("codex_send"), ["auvrynt:write", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("auvrynt.codex_interrupt"), ["auvrynt:write", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("arbiter_decide"), ["auvrynt:read"]);
assert.equal(toolIntegrationEnabled({
  arbiter: { enabled: true, apiKey: "private-key" },
  toolToggles: {},
} as any, "arbiter_decide"), true);
assert.equal(toolIntegrationEnabled({
  arbiter: { enabled: true },
  toolToggles: {},
} as any, "arbiter_decide"), false);
assert.equal(toolIntegrationEnabled({
  arbiter: { enabled: false, apiKey: "private-key" },
  toolToggles: {},
} as any, "arbiter_decide"), false);

console.log("Codex MCP capability policy tests passed!");
