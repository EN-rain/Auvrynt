import assert from "node:assert/strict";
import {
  normalizeMcpToolCallBody,
  requiredScopesForToolCall,
  requiredScopesForToolName,
} from "./mcp-policy.js";

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

assert.throws(
  () => requiredScopesForToolName("unclassified_test_tool"),
  /unclassified|unknown|capability policy/i,
);

assert.deepEqual(requiredScopesForToolName("read_file"), ["auvrynt:read"]);
assert.deepEqual(requiredScopesForToolName("open_workspace"), ["auvrynt:read"]);
assert.deepEqual(
  sorted(requiredScopesForToolCall("open_workspace", { mode: "checkout" })),
  sorted(["auvrynt:read"]),
);
assert.deepEqual(
  sorted(requiredScopesForToolCall("open_workspace", { mode: "worktree" })),
  sorted(["auvrynt:read", "auvrynt:write", "auvrynt:process"]),
);

assert.deepEqual(requiredScopesForToolName("serena_find_symbol"), ["auvrynt:serena"]);
assert.deepEqual(requiredScopesForToolName("desktop_list_displays"), ["auvrynt:desktop"]);
assert.deepEqual(requiredScopesForToolName("desktop_capture"), ["auvrynt:desktop"]);
assert.deepEqual(
  sorted(requiredScopesForToolName("desktop_stream_start")),
  sorted(["auvrynt:desktop", "auvrynt:process"]),
);
assert.deepEqual(
  sorted(requiredScopesForToolName("desktop_mouse_click")),
  sorted(["auvrynt:desktop", "auvrynt:process", "auvrynt:write"]),
);
for (const name of [
  "serena_replace_symbol_body",
  "serena_insert_before_symbol",
  "serena_insert_after_symbol",
  "serena_rename_symbol",
  "serena_safe_delete_symbol",
]) {
  assert.deepEqual(
    sorted(requiredScopesForToolName(name)),
    sorted(["auvrynt:serena", "auvrynt:write"]),
    `${name} must require Serena + write`,
  );
}
for (const name of ["serena_start_session", "serena_stop_session", "serena_restart_session"]) {
  assert.deepEqual(
    sorted(requiredScopesForToolName(name)),
    sorted(["auvrynt:serena", "auvrynt:process"]),
    `${name} must require Serena + process`,
  );
}

assert.deepEqual(requiredScopesForToolName("agent_reach_guide"), ["auvrynt:read"]);
assert.deepEqual(
  sorted(requiredScopesForToolName("agent_reach_status")),
  sorted(["auvrynt:read", "auvrynt:process"]),
);
assert.deepEqual(
  sorted(requiredScopesForToolName("agent_reach_doctor")),
  sorted(["auvrynt:read", "auvrynt:process"]),
);

assert.deepEqual(requiredScopesForToolName("krita_web_agent_signal"), ["auvrynt:read"]);
assert.deepEqual(
  sorted(requiredScopesForToolName("krita_status")),
  sorted(["auvrynt:krita", "auvrynt:read", "auvrynt:process"]),
);
assert.deepEqual(
  sorted(requiredScopesForToolName("krita_auto_calibrate_canvas")),
  sorted(["auvrynt:krita", "auvrynt:read", "auvrynt:process"]),
  "automatic calibration captures a live window and updates local calibration metadata without mutating Krita",
);
assert.deepEqual(
  sorted(requiredScopesForToolName("auvrynt.krita_status")),
  sorted(["auvrynt:krita", "auvrynt:read", "auvrynt:process"]),
  "reconnected hosts may retain the Auvrynt-qualified Krita tool identifier",
);
assert.deepEqual(
  normalizeMcpToolCallBody({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "auvrynt.krita_status", arguments: { workspaceId: "ws-test" } },
  }),
  {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "krita_status", arguments: { workspaceId: "ws-test" } },
  },
  "the transport should route stale qualified tool IDs to their canonical MCP tools",
);
assert.deepEqual(requiredScopesForToolName("krita_get_state"), ["auvrynt:read"]);
assert.deepEqual(
  sorted(requiredScopesForToolName("krita_command")),
  sorted(["auvrynt:krita", "auvrynt:process", "auvrynt:write"]),
);
assert.deepEqual(
  sorted(requiredScopesForToolName("krita_probe_shortcut")),
  sorted(["auvrynt:krita", "auvrynt:process", "auvrynt:write"]),
  "shortcut probes send bounded raw input and require explicit Krita/process/write scopes",
);
assert.deepEqual(
  sorted(requiredScopesForToolName("krita_canvas_click")),
  sorted(["auvrynt:krita", "auvrynt:process", "auvrynt:write"]),
);

assert.deepEqual(
  sorted(requiredScopesForToolCall("agent_reach_read", { url: "https://example.com/feed.xml", platform: "rss" })),
  sorted(["auvrynt:read"]),
);
assert.deepEqual(
  sorted(requiredScopesForToolCall("agent_reach_read", { url: "https://youtube.com/watch?v=abc", platform: "youtube" })),
  sorted(["auvrynt:read", "auvrynt:process"]),
);
assert.deepEqual(
  sorted(requiredScopesForToolCall("agent_reach_read", { url: "https://github.com/openai/openai-node", platform: "auto" })),
  sorted(["auvrynt:read"]),
  "GitHub reads can use the HTTP fallback without process scope",
);
assert.deepEqual(
  sorted(requiredScopesForToolCall("agent_reach_read", { url: "https://example.com/article", platform: "auto" })),
  sorted(["auvrynt:read"]),
);

assert.deepEqual(
  sorted(requiredScopesForToolCall("agent_reach_search", { platform: "v2ex", query: "typescript" })),
  sorted(["auvrynt:read"]),
);
assert.deepEqual(
  sorted(requiredScopesForToolCall("agent_reach_search", { platform: "web", query: "typescript" })),
  sorted(["auvrynt:read"]),
  "web search can use the HTTP fallback without process scope",
);
for (const platform of ["exa", "github", "youtube", "reddit", "twitter", "xiaohongshu", "facebook", "instagram"]) {
  assert.deepEqual(
    sorted(requiredScopesForToolCall("agent_reach_search", { platform, query: "typescript" })),
    sorted(["auvrynt:read", "auvrynt:process"]),
    `agent_reach_search ${platform} must require process scope`,
  );
}

console.log("MCP capability policy security tests passed!");
