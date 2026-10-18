import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../infrastructure/config.js";
import { createServer, requiredScopesForToolCall, requiredScopesForToolName, toolIntegrationEnabled } from "../server.js";
import { hardenHttpServer } from "../infrastructure/http-server-hardening.js";
import { isLoopbackRequest } from "../infrastructure/logger.js";

const stateDir = await mkdtemp(join(tmpdir(), "auvrynt-server-guardrails-"));
const config = loadConfig({
  AUVRYNT_CONFIG_DIR: stateDir,
  AUVRYNT_ALLOWED_ROOTS: process.cwd(),
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  AUVRYNT_GODOT_GDSCRIPT_ENABLED: "0",
  AUVRYNT_GODOT_CSHARP_ENABLED: "1",
  AUVRYNT_BLENDER_ENABLED: "0",
  AUVRYNT_SERENA_ENABLED: "0",
  AUVRYNT_PLAYWRIGHT_ENABLED: "0",
  AUVRYNT_STATE_DIR: stateDir,
  PORT: "1",
});

assert.deepEqual(requiredScopesForToolName("read_file"), ["auvrynt:read"]);
assert.deepEqual(requiredScopesForToolName("write_file"), ["auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("open_workspace"), ["auvrynt:read"]);
assert.deepEqual(requiredScopesForToolCall("open_workspace", { mode: "checkout" }), ["auvrynt:read"]);
assert.deepEqual(requiredScopesForToolCall("open_workspace", { mode: "worktree" }), ["auvrynt:read", "auvrynt:write", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("close_workspace"), ["auvrynt:write", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("start_process"), ["auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("start_dev_server"), ["auvrynt:web", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("capture_page_screenshot"), ["auvrynt:web", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("test_responsive_page"), ["auvrynt:web", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("capture_window"), ["auvrynt:process", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("split_sprite_sheet"), ["auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("dotnet_build"), ["auvrynt:software", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolCall("dotnet_format", { verifyOnly: true }), ["auvrynt:software", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolCall("dotnet_format", { verifyOnly: false }), ["auvrynt:software", "auvrynt:process", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolCall("compare_images", {}), ["auvrynt:read"]);
assert.deepEqual(requiredScopesForToolCall("compare_images", { diffOutputPath: "diff.png" }), ["auvrynt:read", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("aseprite_capture_current"), ["auvrynt:aseprite", "auvrynt:process", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("aseprite_capture_canvas"), ["auvrynt:aseprite", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolCall("aseprite_recovery", { action: "list" }), ["auvrynt:aseprite"]);
assert.deepEqual(requiredScopesForToolCall("aseprite_recovery", { action: "archive" }), ["auvrynt:aseprite", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolCall("aseprite_recovery", { action: "open_recovery_ui" }), ["auvrynt:aseprite", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("blender_get_scene_info"), ["auvrynt:blender"]);
assert.deepEqual(requiredScopesForToolName("blender_execute_python"), ["auvrynt:blender", "auvrynt:blender-python"]);
assert.deepEqual(requiredScopesForToolName("aseprite_set_pixels"), ["auvrynt:aseprite"]);
assert.deepEqual(requiredScopesForToolName("godot_get_scene_tree"), ["auvrynt:godot"]);
assert.deepEqual(requiredScopesForToolName("serena_find_symbol"), ["auvrynt:serena"]);

const spoofedRemote = {
  ip: "127.0.0.1",
  socket: { remoteAddress: "203.0.113.7" },
  header: (name: string) => {
    if (name.toLowerCase() === "x-forwarded-for") return "127.0.0.1";
    if (name.toLowerCase() === "forwarded") return "for=127.0.0.1";
    return undefined;
  },
} as any;
assert.equal(isLoopbackRequest(spoofedRemote), false, "forwarded metadata must not make a remote socket local");

assert.equal(toolIntegrationEnabled(config, "blender_get_scene_info"), false);
assert.equal(toolIntegrationEnabled(config, "inspect_page"), false);
assert.equal(toolIntegrationEnabled(config, "godot_gdscript_environment"), false);
assert.equal(toolIntegrationEnabled(config, "godot_dotnet_environment"), true);
  assert.equal(toolIntegrationEnabled(config, "serena_find_symbol"), false);
assert.equal(toolIntegrationEnabled(config, "desktop_capture"), false);
assert.equal(toolIntegrationEnabled(config, "krita_web_agent_signal"), false);
assert.equal(toolIntegrationEnabled(config, "codex_status"), false);
  assert.equal(toolIntegrationEnabled(config, "read_file"), true);

const running = createServer(config);
try {
  const oauthScopesBeforeUpdate = [...running.config.oauth.scopes];
  const update = await running.updateIntegrations({
    godotGdscript: false,
    godotCsharp: false,
    blender: true,
    aseprite: true,
    serena: false,
    solOrchestrator: true,
    playwright: true, roblox: false, desktop: true, krita: true, openPencil: false,
  });
  assert.equal(update.updated, true);
  assert.equal(update.closedSessions, 0);
  assert.deepEqual(running.config.oauth.scopes, oauthScopesBeforeUpdate);
  assert.equal(running.config.integrations.blender, true);
  assert.equal(running.config.integrations.playwright, true);
  assert.equal(toolIntegrationEnabled(running.config, "blender_get_scene_info"), true);
  assert.equal(toolIntegrationEnabled(running.config, "inspect_page"), true);
  assert.equal(toolIntegrationEnabled(running.config, "desktop_capture"), true);
  assert.equal(toolIntegrationEnabled(running.config, "krita_web_agent_signal"), true);
  assert.equal(toolIntegrationEnabled(running.config, "codex_status"), true);

  running.updateSessionLimit(3);
  assert.equal(running.config.maxSessions, 3);
  assert.equal(running.config.maxSessionsPerClient, 3);
  running.updateSessionLimit(99999);
  assert.equal(running.config.maxSessions, 256);
  assert.equal(running.config.maxSessionsPerClient, 3);
  const rootUpdate = await running.updateWorkspaceRoots([stateDir]);
  assert.equal(rootUpdate.updated, true);
  assert.deepEqual(running.config.allowedRoots, [stateDir]);
  await running.updateWorkspaceRoots([process.cwd()]);

  const httpServer = running.app.listen(0, "127.0.0.1");
  hardenHttpServer(httpServer);
  try {
    await new Promise<void>((resolveListen) => httpServer.once("listening", resolveListen));
    const { port } = httpServer.address() as AddressInfo;
    const forwardedLocalHealth = await fetch(`http://127.0.0.1:${port}/healthz`, {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    const forwardedLocalHealthBody = await forwardedLocalHealth.json() as Record<string, unknown>;
    assert.equal(forwardedLocalHealth.status, 200);
    assert.equal(forwardedLocalHealthBody.ok, true);
    assert.equal(forwardedLocalHealthBody.name, "auvrynt");
    assert.ok("pid" in forwardedLocalHealthBody);
    assert.equal(forwardedLocalHealth.headers.get("x-powered-by"), null);
    assert.equal(forwardedLocalHealth.headers.get("cache-control"), "no-store");

    const forwardedLocalReady = await fetch(`http://127.0.0.1:${port}/readyz`, {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    const forwardedLocalReadyBody = await forwardedLocalReady.json() as Record<string, unknown>;
    assert.equal(forwardedLocalReady.status, 200);
    assert.equal(forwardedLocalReadyBody.ready, true);
    assert.ok("memory" in forwardedLocalReadyBody);
    assert.ok("sessionsByState" in forwardedLocalReadyBody);

    const localReady = await fetch(`http://127.0.0.1:${port}/readyz`);
    const localReadyBody = await localReady.json() as Record<string, unknown>;
    assert.equal(localReady.status, 200);
    assert.equal(localReadyBody.ready, true);
    assert.ok("memory" in localReadyBody);
    assert.ok("sessionsByState" in localReadyBody);

    const localDashboard = await fetch(`http://127.0.0.1:${port}/dashboard`);
    const localDashboardHtml = await localDashboard.text();
    assert.equal(localDashboard.status, 200);
    assert.match(localDashboard.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(localDashboard.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(localDashboardHtml, /Auvrynt Dashboard/);
    assert.match(localDashboardHtml, /aria-label="Auvrynt controls"/);
    assert.match(localDashboardHtml, /Web agent presence/);
    assert.match(localDashboardHtml, /Agent changes/);
    assert.match(localDashboardHtml, /id="action-notice"/);
    assert.doesNotMatch(localDashboardHtml, /Git is not required/);
    assert.match(localDashboardHtml, /role="tab"[^>]+data-view="analytics"/);
    assert.match(localDashboardHtml, /role="tab"[^>]+data-view="connectivity"/);
    assert.match(localDashboardHtml, /role="tab"[^>]+data-view="logs"/);
    assert.match(localDashboardHtml, /role="tab"[^>]+data-view="commands"/);
    assert.match(localDashboardHtml, /id="activity-chart"/);
    assert.match(localDashboardHtml, /id="change-additions"/);
    assert.match(localDashboardHtml, /id="change-removals"/);
    assert.match(localDashboardHtml, /id="files-created"/);
    assert.match(localDashboardHtml, /id="files-deleted"/);
    assert.match(localDashboardHtml, /data-copy-url="public"/);
    assert.match(localDashboardHtml, /id="edit-workspace"/);
    assert.doesNotMatch(localDashboardHtml, /id="workspace-editor"/);
    assert.match(localDashboardHtml, /\/__auvrynt\/dashboard\/select-workspace/);
    assert.doesNotMatch(localDashboardHtml, /id="command-form"/);
    assert.doesNotMatch(localDashboardHtml, /id="command-output"/);
    assert.doesNotMatch(localDashboardHtml, /\/__auvrynt\/dashboard\/command/);
    assert.match(localDashboardHtml, /id="confirm-dialog"/);
    assert.match(localDashboardHtml, /id="session-limit-form"/);
    assert.match(localDashboardHtml, /\/__auvrynt\/dashboard\/session-limit/);
    assert.match(localDashboardHtml, /id="session-idle-timeout-form"/);
    assert.match(localDashboardHtml, /\/__auvrynt\/dashboard\/session-idle-timeout/);
    assert.match(localDashboardHtml, /Command reference/);
    assert.match(localDashboardHtml, /Recent events/);
    assert.match(localDashboardHtml, /auvrynt start godotcs/);
    assert.match(localDashboardHtml, /auvrynt restart hard/);
    assert.match(localDashboardHtml, /AUVRYNT_PUBLIC_BASE_URL/);
    assert.match(localDashboardHtml, /data-integration/);
    assert.match(localDashboardHtml, /id="restart"/);
    assert.match(localDashboardHtml, /id="stop"/);
    assert.match(localDashboardHtml, /firstVisibleAnchor/);
    assert.match(localDashboardHtml, /class="log-filter-row"/);
    assert.match(localDashboardHtml, /data-log-filter="tool"/);
    assert.doesNotMatch(localDashboardHtml, /id="pause-logs"/);
    assert.doesNotMatch(localDashboardHtml, /id="clear-logs"/);
    assert.doesNotMatch(localDashboardHtml, /The indicator changes only after an authenticated MCP session connects/);
    assert.doesNotMatch(localDashboardHtml, /owner-token-that-is-long-enough/);

    const localDashboardData = await fetch(`http://127.0.0.1:${port}/dashboard/data`);
    const localDashboardBody = await localDashboardData.json() as Record<string, unknown>;
    assert.equal(localDashboardData.status, 200);
    assert.equal(localDashboardBody.maxSessions, 256);
    assert.equal(localDashboardBody.agentState, "waiting");
    assert.equal(localDashboardBody.activeToolCalls, 0);
    assert.ok(localDashboardBody.workspaceChanges && typeof localDashboardBody.workspaceChanges === "object");
    assert.ok(Array.isArray(localDashboardBody.integrations));
    assert.ok(Array.isArray(localDashboardBody.logs));

    const forwardedHeaderLocalDashboard = await fetch(`http://127.0.0.1:${port}/dashboard`, {
      headers: {
        "x-forwarded-for": "203.0.113.10",
        forwarded: "for=203.0.113.10",
      },
    });
    assert.equal(forwardedHeaderLocalDashboard.status, 200, "forwarded headers must not override the actual loopback socket");
    const forwardedHeaderLocalDashboardData = await fetch(`http://127.0.0.1:${port}/dashboard/data`, {
      headers: {
        "x-forwarded-for": "203.0.113.10",
        forwarded: "for=203.0.113.10",
      },
    });
    assert.equal(forwardedHeaderLocalDashboardData.status, 200);

    for (let attempt = 0; attempt < 600; attempt++) {
      const registrationAttempt = await fetch(`http://127.0.0.1:${port}/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.20",
        },
        body: "{}",
      });
      assert.notEqual(registrationAttempt.status, 429);
    }
    const registrationLimited = await fetch(`http://127.0.0.1:${port}/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.20",
      },
      body: "{}",
    });
    assert.equal(registrationLimited.status, 429);
    assert.ok(Number(registrationLimited.headers.get("retry-after")) >= 1);

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(response.status, 401);
  } finally {
    httpServer.closeIdleConnections();
    await new Promise<void>((resolveClose, rejectClose) => {
      const forceClose = setTimeout(() => httpServer.closeAllConnections(), 1_000);
      httpServer.close((error) => {
        clearTimeout(forceClose);
        error ? rejectClose(error) : resolveClose();
      });
    });
  }
} finally {
  await running.close();
  await rm(stateDir, { recursive: true, force: true });
}
