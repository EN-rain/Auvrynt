import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ServerConfig } from "../../infrastructure/config.js";
import { loadConfig } from "../../infrastructure/config.js";
import {
  asepriteAnimationAudit,
  asepriteAuditSprite,
  asepriteCompareDocuments,
  asepriteReadPixels,
} from "./integrations/aseprite/aseprite-analysis-tools.js";
import { asepriteFileSafety } from "./integrations/aseprite/aseprite-safety-tools.js";
import { getAsepriteBridgeRuntimeStatus } from "./integrations/aseprite/aseprite-live-tools.js";
import { asepriteManageTilemap } from "./integrations/aseprite/aseprite-specialized-tools.js";
import { getAsepritePalettePreset, resolveAsepriteExecutable } from "./aseprite-tools.js";
import { toolIntegrationEnabled } from "./server/mcp-policy.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";

const workspace = await mkdtemp(join(tmpdir(), "auvrynt-aseprite-tools-"));
try {
  const source = join(workspace, "aseprite-source");
  const executable = process.platform === "win32"
    ? join(source, "build", "bin", "aseprite.exe")
    : join(source, "build", "bin", "aseprite");
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, "test");

  const config = {
    executables: { asepriteSource: source },
    integrations: { aseprite: true },
  } as unknown as ServerConfig;

  assert.equal(await resolveAsepriteExecutable(config), executable);
  assert.deepEqual(getAsepritePalettePreset("gameboy"), ["#0F380F", "#306230", "#8BAC0F", "#9BBC0F"]);
  assert.equal(toolIntegrationEnabled(config, "aseprite_detect"), true);
  assert.equal(toolIntegrationEnabled(config, "aseprite_read_pixels"), true);
  assert.equal(
    toolIntegrationEnabled({ ...config, integrations: { ...config.integrations, aseprite: false } }, "aseprite_detect"),
    false,
  );

  const registrationSources = [
    await readFile("src/server/tools/aseprite-tools-registration.ts", "utf8"),
    await readFile("src/server/tools/aseprite-advanced-tools-registration.ts", "utf8"),
  ].join("\n");
  const expectedTools = [
    "aseprite_detect",
    "aseprite_capture_current",
    "aseprite_inspect_file",
    "aseprite_create_sprite",
    "aseprite_set_pixels",
    "aseprite_draw_shapes",
    "aseprite_manage_layers",
    "aseprite_manage_frames",
    "aseprite_manage_tags",
    "aseprite_set_palette",
    "aseprite_export_sprite_sheet",
    "aseprite_convert_file",
    "aseprite_read_pixels",
    "aseprite_audit_sprite",
    "aseprite_compare_documents",
    "aseprite_animation_audit",
    "aseprite_file_safety",
    "aseprite_import_sprite_sheet",
    "aseprite_edit_region",
    "aseprite_draw_stroke",
    "aseprite_compose_layers",
    "aseprite_manage_mask",
    "aseprite_manage_color",
    "aseprite_manage_document",
    "aseprite_manage_cels",
    "aseprite_manage_animation",
    "aseprite_run_safe_command",
    "aseprite_draw_advanced",
    "aseprite_manage_tilemap",
    "aseprite_live_editor",
    "aseprite_capture_canvas",
    "aseprite_manage_export_preset",
    "aseprite_batch_process",
    "aseprite_maintenance",
    "aseprite_recovery",
    "aseprite_extensions",
  ];
  for (const toolName of expectedTools) {
    assert.match(registrationSources, new RegExp(`registerAppTool\\(server, \\"${toolName}\\"`));
  }
  assert.equal(expectedTools.length, 36);
  assert.match(registrationSources, /apply_palette_preset/);
  assert.match(registrationSources, /tween_cel_position/);
  const liveRegistration = await readFile("src/server/tools/aseprite-advanced-tools-registration.ts", "utf8");
  assert.match(liveRegistration, /"run_live_command"/);
  assert.match(liveRegistration, /"get_image_data"/);
  assert.match(liveRegistration, /"create_character_template"/);
  assert.match(liveRegistration, /"select_by_color"/);
  assert.match(liveRegistration, /"copy_between_sprites"/);
  assert.match(liveRegistration, /"validate_animation"/);
  assert.match(liveRegistration, /"create_tileset_template"/);
  assert.match(liveRegistration, /"apply_dither"/);
  for (const modulePath of [
    "extensions/auvrynt_bridge/live_commands.lua",
    "extensions/auvrynt_bridge/live_common.lua",
    "extensions/auvrynt_bridge/live_drawing.lua",
    "extensions/auvrynt_bridge/live_structure.lua",
    "extensions/auvrynt_bridge/live_palette_template.lua",
    "extensions/auvrynt_bridge/live_selection.lua",
    "extensions/auvrynt_bridge/live_animation.lua",
    "extensions/auvrynt_bridge/live_analysis.lua",
    "extensions/auvrynt_bridge/live_document.lua",
    "extensions/auvrynt_bridge/live_effects.lua",
  ]) assert.equal(existsSync(modulePath), true, `Missing live bridge module: ${modulePath}`);
  const bridgeSource = await readFile("extensions/auvrynt_bridge/auvrynt_bridge.lua", "utf8");
  assert.match(bridgeSource, /Timer\{interval=POLL_INTERVAL,ontick=poll_requests\}/);
  assert.doesNotMatch(bridgeSource, /timer\.onTick\s*=/);
  assert.match(bridgeSource, /kind == "table" or kind == "userdata"/);
  assert.match(bridgeSource, /not is_json_object\(request\)/);
  const dashboardSource = await readFile("src/server/dashboard.ts", "utf8");
  assert.match(dashboardSource, /getAsepriteBridgeRuntimeStatus/);
  assert.doesNotMatch(dashboardSource, /const asepriteConnected = Boolean\(discovered && processDetected\(discovered, "aseprite"\)\)/);

  const bridgeRoot = await mkdtemp(join(tmpdir(), "auvrynt-aseprite-bridge-status-"));
  const originalAsepriteUserDataDir = process.env.ASEPRITE_USER_DATA_DIR;
  try {
    process.env.ASEPRITE_USER_DATA_DIR = bridgeRoot;
    const missingBridge = await getAsepriteBridgeRuntimeStatus({ force: true, timeoutMs: 25 });
    assert.equal(missingBridge.installed, false);
    assert.equal(missingBridge.connected, false);

    const extensionDirectory = join(bridgeRoot, "extensions", "auvrynt-bridge");
    await mkdir(extensionDirectory, { recursive: true });
    await writeFile(join(extensionDirectory, "auvrynt_bridge.lua"), "-- test bridge");
    const missingAuth = await getAsepriteBridgeRuntimeStatus({ force: true, timeoutMs: 25 });
    assert.equal(missingAuth.installed, true);
    assert.equal(missingAuth.connected, false);
    assert.match(missingAuth.error ?? "", /authentication file is missing/i);

    const queueRoot = join(bridgeRoot, "auvrynt-bridge");
    await mkdir(join(queueRoot, "requests"), { recursive: true });
    await mkdir(join(queueRoot, "responses"), { recursive: true });
    await writeFile(join(queueRoot, "auth.json"), JSON.stringify({ token: "a".repeat(64), createdAt: new Date().toISOString() }));
    const inactiveBridge = await getAsepriteBridgeRuntimeStatus({ force: true, timeoutMs: 25 });
    assert.equal(inactiveBridge.installed, true);
    assert.equal(inactiveBridge.connected, false);
    assert.match(inactiveBridge.error ?? "", /did not respond/i);
  } finally {
    if (originalAsepriteUserDataDir === undefined) delete process.env.ASEPRITE_USER_DATA_DIR;
    else process.env.ASEPRITE_USER_DATA_DIR = originalAsepriteUserDataDir;
    await rm(bridgeRoot, { recursive: true, force: true });
  }

  const safetyRoot = await mkdtemp(join(tmpdir(), "auvrynt-aseprite-safety-"));
  try {
    const safetyConfig = loadConfig({
      AUVRYNT_ALLOWED_ROOTS: safetyRoot,
      AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
      PORT: "1",
    });
    const registry = new WorkspaceRegistry(safetyConfig);
    const opened = await registry.openWorkspace(safetyRoot);
    await writeFile(join(safetyRoot, "sprite.aseprite"), "version-one", "utf8");
    const status = textJson(await asepriteFileSafety(safetyConfig, registry, {
      workspaceId: opened.workspace.id,
      filePath: "sprite.aseprite",
      action: "status",
    }));
    assert.match(status.version, /^[0-9a-f]{64}$/);
    const checkpoint = textJson(await asepriteFileSafety(safetyConfig, registry, {
      workspaceId: opened.workspace.id,
      filePath: "sprite.aseprite",
      action: "checkpoint",
      expectedVersion: status.version,
      label: "test",
    }));
    assert.ok(checkpoint.checkpointId);
    await writeFile(join(safetyRoot, "sprite.aseprite"), "version-two", "utf8");
    const conflict = await asepriteFileSafety(safetyConfig, registry, {
      workspaceId: opened.workspace.id,
      filePath: "sprite.aseprite",
      action: "assert_version",
      expectedVersion: status.version,
    });
    assert.equal(conflict.isError, true);
    const rollback = textJson(await asepriteFileSafety(safetyConfig, registry, {
      workspaceId: opened.workspace.id,
      filePath: "sprite.aseprite",
      action: "rollback",
      checkpointId: checkpoint.checkpointId,
    }));
    assert.equal(rollback.restored, checkpoint.checkpointId);
    assert.equal(await readFile(join(safetyRoot, "sprite.aseprite"), "utf8"), "version-one");
  } finally {
    await rm(safetyRoot, { recursive: true, force: true });
  }

  await runLocalReadOnlyAsepriteSmoke();
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function runLocalReadOnlyAsepriteSmoke(): Promise<void> {
  const sourceRoot = resolve("../aseprite");
  const realExecutable = process.platform === "win32"
    ? join(sourceRoot, "build", "bin", "aseprite.exe")
    : join(sourceRoot, "build", "bin", "aseprite");
  const fixture = join(sourceRoot, "tests", "scripts", "sprites", "abcd.aseprite");
  if (!existsSync(realExecutable) || !existsSync(fixture)) return;

  const configDir = await mkdtemp(join(tmpdir(), "auvrynt-aseprite-real-config-"));
  try {
    const base = loadConfig({
      AUVRYNT_CONFIG_DIR: configDir,
      AUVRYNT_ALLOWED_ROOTS: sourceRoot,
      AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
      PORT: "1",
    });
    const config = {
      ...base,
      executables: { ...base.executables, aseprite: realExecutable },
      integrations: { ...base.integrations, aseprite: true },
    };
    const registry = new WorkspaceRegistry(config);
    const opened = await registry.openWorkspace(sourceRoot);
    const workspaceId = opened.workspace.id;
    const filePath = "tests/scripts/sprites/abcd.aseprite";

    const readPixels = await asepriteReadPixels(config, registry, {
      workspaceId,
      filePath,
      frame: 1,
      region: { x: 0, y: 0, width: 2, height: 2 },
      format: "rows",
    });
    assert.equal(readPixels.isError, undefined, responseText(readPixels));
    assert.equal(textJson(readPixels).rows.length, 2);

    const audit = await asepriteAuditSprite(config, registry, { workspaceId, filePath });
    assert.equal(audit.isError, undefined, responseText(audit));
    assert.ok(Array.isArray(textJson(audit).frames));

    const compare = await asepriteCompareDocuments(config, registry, {
      workspaceId,
      referencePath: filePath,
      candidatePath: filePath,
      comparePixels: true,
    });
    assert.equal(compare.isError, undefined, responseText(compare));
    assert.equal(textJson(compare).exact_match, true);

    const animation = await asepriteAnimationAudit(config, registry, { workspaceId, filePath });
    assert.equal(animation.isError, undefined, responseText(animation));
    assert.ok(Array.isArray(textJson(animation).frames));

    const tilemapPath = "tests/sprites/2x2tilemap2x2tile.aseprite";
    if (existsSync(join(sourceRoot, tilemapPath))) {
      const tilemap = await asepriteManageTilemap(config, registry, {
        workspaceId,
        filePath: tilemapPath,
        action: "inspect",
      });
      assert.equal(tilemap.isError, undefined, responseText(tilemap));
      const tilemapData = textJson(tilemap);
      assert.ok(Array.isArray(tilemapData.tilesets));
      assert.ok(Array.isArray(tilemapData.tilemap_layers));
    }
  } finally {
    await rm(join(sourceRoot, "auvrynt-logs"), { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
}

function responseText(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content.map((item) => item.type === "text" ? item.text ?? "" : item.type).join("\n");
}

function textJson(response: { content: Array<{ type: string; text?: string }> }): any {
  const text = response.content.find((item) => item.type === "text")?.text;
  assert.ok(text, "Expected a text tool result.");
  return JSON.parse(text);
}

console.log("Aseprite integration unit tests passed!");
