import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import { inlineImageOrNotice } from "../../tool-result-budget.js";
import { KritaTools } from "../../integrations/krita/krita-tools.js";
import { buildKritaWebAgentSignal } from "../../integrations/krita/krita-web-agent-signal.js";
import { KRITA_SHORTCUT_COMMANDS } from "../../integrations/krita/krita-shortcuts.js";
import { KRITA_TRACKED_STATE_FIELDS } from "../../integrations/krita/krita-state.js";
import { KRITA_UI_REGION_NAMES } from "../../integrations/krita/krita-ui-targets.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

const shortcutCommandSchema = z.enum([...KRITA_SHORTCUT_COMMANDS]);
const shortcutProbeIdSchema = z.string().min(1).max(128);
const trackedStateFieldSchema = z.enum([...KRITA_TRACKED_STATE_FIELDS]);
const normalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
const pathPointSchema = normalizedPointSchema.extend({
  durationMs: z.number().int().min(0).max(10_000).optional(),
});
const normalizedRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});
const pixelRegionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const uiRegionSchema = z.enum([...KRITA_UI_REGION_NAMES]);
const uiTargetInputSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  region: uiRegionSchema,
  windowRegion: pixelRegionSchema,
  confidence: z.number().min(0.8).max(1),
  source: z.enum(["visual-confirmation", "user-confirmed"]).optional(),
});
const focusPolicySchema = z.enum(["foreground", "foreground-restore"]).optional().describe("Input must foreground Krita; foreground-restore returns focus to the previously active window when possible.");
const transactionStepSchema = z.enum(["check_window", "check_dialogs", "ensure_calibration_if_needed", "foreground_restore", "execute", "capture_result", "verify"]);
const transactionOperationSchema = z.enum(["capture", "save", "undo", "redo", "create_layer", "delete_layer", "duplicate_layer"]);
const expectedStatePatchSchema = z.object({
  documentName: z.string().min(1).max(2048).optional(),
  documentPath: z.string().min(1).max(2048).optional(),
  activeTool: z.string().min(1).max(2048).optional(),
  brushPreset: z.string().min(1).max(2048).optional(),
  brushSize: z.number().gt(0).max(10_000).optional(),
  foregroundColor: z.string().min(6).max(9).optional(),
  activeLayerName: z.string().min(1).max(2048).optional(),
  zoom: z.number().gt(0).max(100_000).optional(),
  rotation: z.number().finite().optional(),
  mirrored: z.boolean().optional(),
  eraserMode: z.boolean().optional(),
  modified: z.boolean().optional(),
});
const batchOperationSchema = z.union([
  z.object({
    type: z.literal("action"),
    actionId: z.string().min(1).max(128),
  }),
  z.object({
    type: z.literal("click"),
    point: normalizedPointSchema,
    button: z.enum(["left", "right", "middle"]).optional(),
    clickCount: z.number().int().min(1).max(3).optional(),
  }),
  z.object({
    type: z.literal("stroke"),
    start: normalizedPointSchema,
    end: normalizedPointSchema,
    durationMs: z.number().int().min(0).max(10_000).optional(),
    button: z.enum(["left", "right", "middle"]).optional(),
  }),
  z.object({
    type: z.literal("path"),
    points: z.array(pathPointSchema).min(2).max(512),
    button: z.enum(["left", "right", "middle"]).optional(),
  }),
  z.object({
    type: z.literal("fill"),
    point: normalizedPointSchema,
  }),
  z.object({
    type: z.literal("select"),
    shape: z.enum(["rectangle", "ellipse"]),
    start: normalizedPointSchema,
    end: normalizedPointSchema,
  }),
]);

export function registerKritaTools(server: McpServer, config: ServerConfig): void {
  const tools = new KritaTools(undefined, { shortcutStateDir: config.stateDir, checkpointStateDir: config.stateDir });
  const read = (
    name: string,
    title: string,
    description: string,
    inputSchema: Record<string, z.ZodType>,
    handler: (input: any) => unknown | Promise<unknown>,
  ) => {
    registerAppTool(server, name, {
      title,
      description,
      inputSchema,
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: READ_ONLY_ANNOTATIONS,
    }, (input) => jsonAction(() => handler(input)));
  };
  const write = (
    name: string,
    title: string,
    description: string,
    inputSchema: Record<string, z.ZodType>,
    handler: (input: any) => unknown | Promise<unknown>,
  ) => {
    registerAppTool(server, name, {
      title,
      description,
      inputSchema,
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: MUTATING_ANNOTATIONS,
    }, (input) => jsonAction(() => handler(input)));
  };

  read(
    "krita_web_agent_signal",
    "Krita web-agent signal",
    "Return the no-plugin Krita action inventory and bounded try-all signal. Safe smoke steps do not mutate Krita; automatic calibration may update only local geometry metadata. Shortcut execution, canvas input, document save, and application state changes require explicit confirmation. This tool never installs, imports, registers, or probes a Krita plugin or bridge.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => buildKritaWebAgentSignal(workspaceId),
  );

  read(
    "krita_status",
    "Krita status",
    "Inspect the live Krita window and return no-plugin desktop mode, calibration, shortcut validation, and expected-state metadata.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.status(workspaceId),
  );

  read(
    "krita_readiness_report",
    "Krita readiness report",
    "Return a bounded machine-readable no-plugin Krita readiness matrix for observation, drawing, brush, layers, selection, view, file, and recovery workflows.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.readinessReport(workspaceId),
  );

  registerAppTool(server, "krita_get_window", {
    title: "Get Krita window",
    description: "Capture only the visible, non-minimized Krita top-level window and return target/occlusion/foreground-preservation metadata. Covered windows remain target-only; no desktop fallback is used.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      maxWidth: z.number().int().min(320).max(3840).optional(),
      quality: z.number().int().min(20).max(95).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, maxWidth, quality }) => {
    try {
      const window = await tools.getWindow(workspaceId);
      const image = await tools.getWindowCapture(workspaceId, { maxWidth, quality });
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({
            window,
            capture: {
              target: image.target,
              bounds: image.bounds,
              sourceWidth: image.sourceWidth,
              sourceHeight: image.sourceHeight,
              width: image.width,
              height: image.height,
              captureBackend: image.captureBackend,
              occlusionSafe: image.occlusionSafe,
              foregroundWindowHandleBefore: image.foregroundWindowHandleBefore,
              foregroundWindowHandleAfter: image.foregroundWindowHandleAfter,
            },
          }, null, 2) },
          ...inlineImageOrNotice(image.buffer, "Krita application window", image.mimeType),
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  read(
    "krita_list_verified_ui_targets",
    "List verified Krita UI targets",
    "Return high-confidence, window-relative Krita UI targets. When the current map is empty, a strict target-only Krita-window capture automatically discovers obvious controls; targets are invalidated when the window handle, dimensions, process, or display scale changes.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.listUiTargets(workspaceId),
  );

  write(
    "krita_refresh_ui_targets",
    "Refresh Krita UI targets",
    "Revalidate existing target ownership/geometry and, when no rectangles are supplied, discover obvious controls from a fresh target-only Krita window capture. Explicit high-confidence visual or user-confirmed rectangles remain supported; no fixed screen coordinates or desktop-wide targets are accepted.",
    { workspaceId: WORKSPACE_ID_SCHEMA, targets: z.array(uiTargetInputSchema).max(32).optional() },
    ({ workspaceId, targets }) => tools.refreshUiTargets(workspaceId, targets ?? []),
  );

  registerAppTool(server, "krita_get_ui_region", {
    title: "Get Krita UI region",
    description: "Capture a named region only through a current verified Krita UI target. Unknown or stale regions fail closed.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      region: uiRegionSchema,
      targetId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
      maxWidth: z.number().int().min(160).max(2400).optional(),
      quality: z.number().int().min(20).max(95).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, region, targetId, maxWidth, quality }) => {
    try {
      const image = await tools.getUiRegion(workspaceId, region, { targetId, maxWidth, quality });
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ region, target: image.target, bounds: image.bounds, captureBackend: image.captureBackend, occlusionSafe: image.occlusionSafe }, null, 2) },
          ...inlineImageOrNotice(image.buffer, `Krita ${region}`, image.mimeType),
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  read(
    "krita_get_state",
    "Get Krita expected state",
    "Return the local no-plugin Krita state model. Each field is labeled known, expected, visually_verified, or unknown; expected values are not authoritative application state.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.getState(workspaceId),
  );

  read(
    "krita_list_actions",
    "List Krita actions",
    "List deterministic no-plugin Krita actions with separate supported/ready metadata and explicit blocking preconditions for missing bindings, unvalidated shortcuts, calibration, or unavailable semantic state.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.listActions(workspaceId),
  );

  read(
    "krita_search_actions",
    "Search Krita actions",
    "Search the bounded no-plugin Krita action catalog by action ID, label, or capability reason; results distinguish supported actions from currently ready execution.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      query: z.string().max(128),
    },
    ({ workspaceId, query }) => tools.searchActions(query, workspaceId),
  );

  read(
    "krita_get_canvas_info",
    "Get Krita canvas info",
    "Return current calibration validity and expected-state metadata without claiming plugin-only semantic document state.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.getCanvasInfo(workspaceId),
  );

  write(
    "krita_auto_calibrate_canvas",
    "Automatically calibrate Krita canvas",
    "Capture only the visible Krita application window, detect a high-confidence canvas rectangle, verify it against live geometry, and mark the local calibration verified. This sends no canvas input and fails closed when the rectangle is ambiguous; use krita_calibrate_canvas only with a reviewed rectangle as a fallback.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.autoCalibrate(workspaceId),
  );

  registerAppTool(server, "krita_get_canvas", {
    title: "Get Krita canvas",
    description: "Capture only the calibrated Krita canvas (or a normalized crop) through bounded Desktop Use observation. Requires a valid current calibration.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      maxWidth: z.number().int().min(320).max(3840).optional(),
      quality: z.number().int().min(20).max(95).optional(),
      normalizedRegion: normalizedRegionSchema.optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, maxWidth, quality, normalizedRegion }) => {
    try {
      const image = await tools.getCanvas(workspaceId, { maxWidth, quality, normalizedRegion });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              mode: "no-plugin-desktop",
              target: image.target,
              displayId: image.displayId,
              timestamp: image.timestamp,
              sourceWidth: image.sourceWidth,
              sourceHeight: image.sourceHeight,
              width: image.width,
              height: image.height,
              bounds: image.bounds,
              captureBackend: image.captureBackend,
              occlusionSafe: image.occlusionSafe,
              foregroundWindowHandleBefore: image.foregroundWindowHandleBefore,
              foregroundWindowHandleAfter: image.foregroundWindowHandleAfter,
            }, null, 2),
          },
          ...inlineImageOrNotice(image.buffer, "Krita calibrated canvas", image.mimeType),
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  write(
    "krita_calibrate_canvas",
    "Calibrate Krita canvas",
    "Record the canvas rectangle relative to the current Krita window. Recalibration is required after window/display geometry changes.",
    { workspaceId: WORKSPACE_ID_SCHEMA, canvasWindowRegion: pixelRegionSchema },
    ({ workspaceId, canvasWindowRegion }) => tools.calibrate(workspaceId, canvasWindowRegion),
  );

  read(
    "krita_get_calibration",
    "Get Krita calibration",
    "Return the stored canvas calibration without revalidating current window geometry.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.getCalibration(workspaceId) ?? { calibrated: false },
  );

  read(
    "krita_check_calibration",
    "Check Krita calibration",
    "Compare stored calibration with the current Krita window/display geometry and report whether normalized input remains safe.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.checkCalibration(workspaceId),
  );

  write(
    "krita_clear_calibration",
    "Clear Krita calibration",
    "Forget the current canvas calibration so stale screen coordinates cannot be used.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.clearCalibration(workspaceId),
  );

  write(
    "krita_confirm_calibration",
    "Confirm Krita calibration",
    "Record that the current stored canvas rectangle was visually checked. This does not bypass geometry validation.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.verifyCalibration(workspaceId),
  );

  read(
    "krita_get_shortcuts",
    "Get Krita shortcuts",
    "Return configured shortcut bindings and show which commands are missing or still unvalidated.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.getShortcuts(workspaceId),
  );

  read(
    "krita_recommended_shortcuts",
    "Recommended Krita shortcuts",
    "Return Auvrynt's conservative shortcut recommendations. Recommendations never change Krita preferences; set and visually probe each binding before accepting it.",
    {},
    () => ({ schemaVersion: 1, recommendations: tools.getRecommendedShortcuts() }),
  );

  write(
    "krita_prepare_shortcuts",
    "Prepare Krita shortcuts",
    "Load persisted shortcut validation, compare the current Krita installation/keyboard fingerprint, and report ready, needs_probe, and missing_binding commands. This never sends keys automatically.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.prepareShortcuts(workspaceId),
  );

  write(
    "krita_set_shortcut",
    "Set Krita shortcut",
    "Set a per-workspace shortcut binding. New or changed bindings become unvalidated until checked in the live application.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      command: shortcutCommandSchema,
      keys: z.array(z.string().min(1).max(32)).min(1).max(8),
    },
    ({ workspaceId, command, keys }) => tools.setShortcut(workspaceId, command, keys),
  );

  write(
    "krita_reset_shortcut",
    "Reset Krita shortcut",
    "Restore a command to its built-in binding when one exists, or remove its override. The restored binding is unvalidated.",
    { workspaceId: WORKSPACE_ID_SCHEMA, command: shortcutCommandSchema },
    ({ workspaceId, command }) => tools.resetShortcut(workspaceId, command),
  );

  write(
    "krita_probe_shortcut",
    "Probe Krita shortcut",
    "Send exactly one configured shortcut to the focused Krita window after explicit reversible-probe confirmation. This never marks the binding validated; inspect the live Krita result and use its probeId with krita_confirm_shortcuts.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      command: shortcutCommandSchema,
      confirmReversible: z.literal(true),
      focusPolicy: focusPolicySchema,
    },
    ({ workspaceId, command, confirmReversible, focusPolicy }) => tools.probeShortcut(workspaceId, command, { confirmReversible, focusPolicy }),
  );

  write(
    "krita_confirm_shortcuts",
    "Confirm Krita shortcuts",
    "Mark shortcut bindings safe only after a live visual/manual probe. Prefer probeIds returned by krita_probe_shortcut; direct commands remain available for an externally performed probe.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      commands: z.array(shortcutCommandSchema).min(1).max(KRITA_SHORTCUT_COMMANDS.length).optional(),
      probeIds: z.array(shortcutProbeIdSchema).min(1).max(KRITA_SHORTCUT_COMMANDS.length).optional(),
    },
    ({ workspaceId, commands, probeIds }) => {
      if (!commands && !probeIds) throw new Error("krita_confirm_shortcuts requires commands or probeIds from a completed live probe.");
      return tools.validateShortcuts(workspaceId, commands ?? [], probeIds ?? []);
    },
  );

  write(
    "krita_unvalidate_shortcuts",
    "Unvalidate Krita shortcuts",
    "Mark specified shortcut bindings unsafe for autonomous use until they are checked again.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      commands: z.array(shortcutCommandSchema).min(1).max(KRITA_SHORTCUT_COMMANDS.length),
    },
    ({ workspaceId, commands }) => tools.unvalidateShortcuts(workspaceId, commands),
  );

  write(
    "krita_command",
    "Run Krita shortcut command",
    "Focus the live Krita window and execute a configured deterministic shortcut. Refuses commands whose binding is missing or unvalidated.",
    { workspaceId: WORKSPACE_ID_SCHEMA, command: shortcutCommandSchema, focusPolicy: focusPolicySchema },
    ({ workspaceId, command, focusPolicy }) => tools.command(workspaceId, command, { focusPolicy }),
  );

  write(
    "krita_trigger_action",
    "Trigger Krita action",
    "Execute one shortcut-backed action from the no-plugin catalog. Parameterized UI actions such as named brush/layer selection must use their dedicated tools and fail closed when exact verification is unavailable.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      actionId: z.string().min(1).max(128),
      focusPolicy: focusPolicySchema,
    },
    ({ workspaceId, actionId, focusPolicy }) => tools.triggerAction(workspaceId, actionId, { focusPolicy }),
  );

  write(
    "krita_create_layer",
    "Create Krita layer",
    "Create a new active layer through a configured and live-validated no-plugin shortcut. Layer naming is not claimed because named-layer state is unavailable without Krita-side semantic access.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.createLayer(workspaceId, { focusPolicy }),
  );

  write(
    "krita_select_layer",
    "Select Krita layer",
    "Select an exact visible named layer inside the verified Layers docker and require UI Automation to confirm the row became selected; ambiguous or offscreen matches fail closed.",
    { workspaceId: WORKSPACE_ID_SCHEMA, layerName: z.string().min(1).max(2048), focusPolicy: focusPolicySchema },
    ({ workspaceId, layerName, focusPolicy }) => tools.selectLayer(workspaceId, layerName, { focusPolicy }),
  );

  write(
    "krita_set_layer",
    "Set active Krita layer",
    "Set an exact visible active layer inside the verified Layers docker and require UI Automation to confirm the row became selected; ambiguous or offscreen matches fail closed.",
    { workspaceId: WORKSPACE_ID_SCHEMA, layerName: z.string().min(1).max(2048), focusPolicy: focusPolicySchema },
    ({ workspaceId, layerName, focusPolicy }) => tools.setLayer(workspaceId, layerName, { focusPolicy }),
  );

  write(
    "krita_delete_layer",
    "Delete Krita layer",
    "Delete the active layer through a configured and live-validated no-plugin shortcut.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.deleteLayer(workspaceId, { focusPolicy }),
  );

  write(
    "krita_duplicate_layer",
    "Duplicate Krita layer",
    "Duplicate the active layer through a configured and live-validated no-plugin shortcut.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.duplicateLayer(workspaceId, { focusPolicy }),
  );

  for (const [name, handler, title, description] of [
    ["krita_move_layer_up", (workspaceId: string, focusPolicy?: "foreground" | "foreground-restore") => tools.moveLayerUp(workspaceId, { focusPolicy }), "Move Krita layer up", "Move the active layer through a configured, validated Krita shortcut."],
    ["krita_move_layer_down", (workspaceId: string, focusPolicy?: "foreground" | "foreground-restore") => tools.moveLayerDown(workspaceId, { focusPolicy }), "Move Krita layer down", "Move the active layer through a configured, validated Krita shortcut."],
    ["krita_toggle_layer_visibility", (workspaceId: string, focusPolicy?: "foreground" | "foreground-restore") => tools.toggleLayerVisibility(workspaceId, { focusPolicy }), "Toggle Krita layer visibility", "Toggle active-layer visibility through a configured, validated Krita shortcut."],
    ["krita_toggle_layer_lock", (workspaceId: string, focusPolicy?: "foreground" | "foreground-restore") => tools.toggleLayerLock(workspaceId, { focusPolicy }), "Toggle Krita layer lock", "Toggle active-layer lock through a configured, validated Krita shortcut."],
    ["krita_select_previous_layer", (workspaceId: string, focusPolicy?: "foreground" | "foreground-restore") => tools.selectPreviousLayer(workspaceId, { focusPolicy }), "Select previous Krita layer", "Select the previous layer through a configured, validated Krita shortcut."],
    ["krita_select_next_layer", (workspaceId: string, focusPolicy?: "foreground" | "foreground-restore") => tools.selectNextLayer(workspaceId, { focusPolicy }), "Select next Krita layer", "Select the next layer through a configured, validated Krita shortcut."],
  ] as const) {
    write(
      name,
      title,
      description,
      { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
      ({ workspaceId, focusPolicy }) => handler(workspaceId, focusPolicy),
    );
  }

  write(
    "krita_rename_active_layer",
    "Rename active Krita layer",
    "Rename only through a verified active-layer UI target and bounded text entry; blind layer-row clicks are rejected.",
    { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().min(1).max(2048), focusPolicy: focusPolicySchema },
    ({ workspaceId, name, focusPolicy }) => tools.renameActiveLayer(workspaceId, name, { focusPolicy }),
  );

  write(
    "krita_pick_layer_at_point",
    "Pick Krita layer at point",
    "Use Krita's bounded Ctrl-click layer-pick interaction inside the verified canvas. Layer identity remains unknown until the Layers docker is visually verified.",
    { workspaceId: WORKSPACE_ID_SCHEMA, point: normalizedPointSchema, focusPolicy: focusPolicySchema },
    ({ workspaceId, point, focusPolicy }) => tools.pickLayerAtPoint(workspaceId, point, { focusPolicy }),
  );

  for (const [name, title] of [["krita_get_layers_panel", "Get Krita Layers panel"], ["krita_get_active_layer_visual", "Get active Krita layer visual"]] as const) {
    registerAppTool(server, name, {
      title,
      description: "Capture only the verified Krita Layers docker target; no whole-desktop or guessed-coordinate capture is used.",
      inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, targetId: z.string().min(1).max(128).optional(), maxWidth: z.number().int().min(160).max(2400).optional(), quality: z.number().int().min(20).max(95).optional() },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: READ_ONLY_ANNOTATIONS,
    }, async ({ workspaceId, targetId, maxWidth, quality }) => {
      try {
        const image = name === "krita_get_layers_panel"
          ? await tools.getLayersPanel(workspaceId, { targetId, maxWidth, quality })
          : await tools.getActiveLayerVisual(workspaceId, { targetId, maxWidth, quality });
        return { content: [
          { type: "text" as const, text: JSON.stringify({ target: image.target, bounds: image.bounds, captureBackend: image.captureBackend, occlusionSafe: image.occlusionSafe }, null, 2) },
          ...inlineImageOrNotice(image.buffer, title, image.mimeType),
        ] };
      } catch (error) { return errorResult(error); }
    });
  }

  write(
    "krita_set_brush",
    "Set Krita brush",
    "Set an exact visible brush preset inside the verified Brush Presets docker and require UI Automation to confirm the item became selected; icon-order and fuzzy matching are rejected.",
    { workspaceId: WORKSPACE_ID_SCHEMA, brushPreset: z.string().min(1).max(2048), focusPolicy: focusPolicySchema },
    ({ workspaceId, brushPreset, focusPolicy }) => tools.setBrush(workspaceId, brushPreset, { focusPolicy }),
  );

  read(
    "krita_list_approved_brushes",
    "List approved Krita brushes",
    "List the small, explicit Auvrynt-approved brush preset map. Preset identity still requires a visible name verification inside Krita.",
    {},
    () => tools.listApprovedBrushes(),
  );

  write(
    "krita_set_approved_brush",
    "Set approved Krita brush",
    "Select an approved brush only when a verified brush-presets target exists; icon-only or fuzzy guessing is rejected.",
    { workspaceId: WORKSPACE_ID_SCHEMA, id: z.string().min(1).max(128), focusPolicy: focusPolicySchema },
    ({ workspaceId, id, focusPolicy }) => tools.setApprovedBrush(workspaceId, id, { focusPolicy }),
  );

  write(
    "krita_locate_brush_size_control",
    "Locate Krita brush-size control",
    "Record an explicit high-confidence toolbar target after visual confirmation. The endpoint never derives a target from fixed screen coordinates.",
    { workspaceId: WORKSPACE_ID_SCHEMA, windowRegion: pixelRegionSchema.optional(), confidence: z.number().min(0.8).max(1).optional() },
    ({ workspaceId, windowRegion, confidence }) => tools.locateBrushSizeControl(workspaceId, windowRegion ? { windowRegion, confidence: confidence ?? 0.95 } : undefined),
  );

  read(
    "krita_get_brush_size",
    "Get Krita brush size",
    "Read the brush-size spinner through bounded Windows UI Automation inside a verified Krita target crop; return unknown rather than guessing when identity or text is stale.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.getBrushSize(workspaceId),
  );

  write(
    "krita_set_brush_size",
    "Set Krita brush size",
    "Set brush size. The no-plugin path fails closed unless a visually verified toolbar target is added; it does not guess screen coordinates.",
    { workspaceId: WORKSPACE_ID_SCHEMA, brushSize: z.number().gt(0).max(10_000), focusPolicy: focusPolicySchema },
    ({ workspaceId, brushSize, focusPolicy }) => tools.setBrushSize(workspaceId, brushSize, { focusPolicy }),
  );

  read(
    "krita_get_foreground_color",
    "Get Krita foreground color",
    "Return the visually verified foreground color, or unknown when the swatch has not been verified.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.getForegroundColor(workspaceId),
  );

  write(
    "krita_set_color",
    "Set Krita foreground color",
    "Set foreground color. The no-plugin path fails closed unless a visually verified color-control target is available; it does not guess screen coordinates.",
    { workspaceId: WORKSPACE_ID_SCHEMA, color: z.string().regex(/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/), focusPolicy: focusPolicySchema },
    ({ workspaceId, color, focusPolicy }) => tools.setForegroundColor(workspaceId, color, { focusPolicy }),
  );

  write(
    "krita_set_foreground_color",
    "Set Krita foreground color",
    "Set the exact foreground color through the verified color-control target and bounded text input, then return observed verification metadata.",
    { workspaceId: WORKSPACE_ID_SCHEMA, color: z.string().regex(/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/), focusPolicy: focusPolicySchema },
    ({ workspaceId, color, focusPolicy }) => tools.setForegroundColor(workspaceId, color, { focusPolicy }),
  );

  read(
    "krita_sample_color_at_point",
    "Sample Krita canvas color",
    "Sample one pixel from the calibrated Krita canvas only. The result is explicitly labeled as a visible canvas pixel, never as a desktop-wide color inference.",
    { workspaceId: WORKSPACE_ID_SCHEMA, point: normalizedPointSchema },
    ({ workspaceId, point }) => tools.sampleColorAtPoint(workspaceId, point),
  );

  write(
    "krita_swap_foreground_background",
    "Swap Krita foreground/background",
    "Execute the validated Krita swap shortcut and invalidate color state until the swatch is visually rechecked.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.swapForegroundBackground(workspaceId, { focusPolicy }),
  );

  write(
    "krita_reset_foreground_background",
    "Reset Krita foreground/background",
    "Execute the validated Krita reset shortcut and invalidate color state until the swatch is visually rechecked.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.resetForegroundBackground(workspaceId, { focusPolicy }),
  );

  write(
    "krita_export",
    "Export Krita document",
    "Trigger a configured and live-validated export shortcut. The no-plugin path does not guess an export dialog destination or claim success without a verified UI result.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.exportDocument(workspaceId, { focusPolicy }),
  );

  for (const [name, actionId, title] of [
    ["krita_zoom_in", "zoom_in", "Zoom Krita in"],
    ["krita_zoom_out", "zoom_out", "Zoom Krita out"],
    ["krita_fit_canvas", "fit_canvas", "Fit Krita canvas"],
  ] as const) {
    write(
      name,
      title,
      "Execute the configured and live-validated no-plugin Krita zoom command. It never guesses UI coordinates.",
      { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
      ({ workspaceId, focusPolicy }) => tools.triggerAction(workspaceId, actionId, { focusPolicy }),
    );
  }

  write(
    "krita_reset_canvas_rotation",
    "Reset Krita canvas rotation",
    "Execute the configured and live-validated reset-rotation shortcut without guessing UI coordinates.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.resetCanvasRotation(workspaceId, { focusPolicy }),
  );

  write(
    "krita_fill",
    "Fill Krita canvas region",
    "Activate a configured and live-validated fill-tool shortcut, then click one normalized point inside the verified canvas.",
    { workspaceId: WORKSPACE_ID_SCHEMA, point: normalizedPointSchema, focusPolicy: focusPolicySchema },
    ({ workspaceId, point, focusPolicy }) => tools.fill(workspaceId, point, { focusPolicy }),
  );

  write(
    "krita_select",
    "Select Krita canvas region",
    "Activate a configured and live-validated rectangular or elliptical selection shortcut, then drag between normalized canvas points.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      shape: z.enum(["rectangle", "ellipse"]),
      start: normalizedPointSchema,
      end: normalizedPointSchema,
      focusPolicy: focusPolicySchema,
    },
    ({ workspaceId, shape, start, end, focusPolicy }) => tools.select(workspaceId, shape, start, end, { focusPolicy }),
  );

  write(
    "krita_transform_selection",
    "Transform Krita selection",
    "Transform a selection. The no-plugin path fails closed because selection geometry and transform parameters are not authoritative without Krita-side semantic access.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.triggerAction(workspaceId, "transform_selection", { focusPolicy }),
  );

  for (const [name, action, title] of [
    ["krita_deselect", "deselect", "Deselect Krita selection"],
    ["krita_select_all", "select_all", "Select all in Krita"],
    ["krita_invert_selection", "invert_selection", "Invert Krita selection"],
  ] as const) {
    write(
      name,
      title,
      "Execute the configured and live-validated Krita selection shortcut.",
      { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
      ({ workspaceId, focusPolicy }) => action === "deselect"
        ? tools.deselect(workspaceId, { focusPolicy })
        : action === "select_all"
          ? tools.selectAll(workspaceId, { focusPolicy })
          : tools.invertSelection(workspaceId, { focusPolicy }),
    );
  }

  write(
    "krita_transform_begin",
    "Begin Krita transform",
    "Activate the validated transform tool; numeric transform fields remain unavailable without verified UI targets.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.transformBegin(workspaceId, { focusPolicy }),
  );
  write(
    "krita_transform_nudge",
    "Nudge Krita transform",
    "Nudge an active transform with at most 50 bounded arrow-key steps; result remains explicitly unverified until captured.",
    { workspaceId: WORKSPACE_ID_SCHEMA, direction: z.enum(["left", "right", "up", "down"]), steps: z.number().int().min(1).max(50), focusPolicy: focusPolicySchema },
    ({ workspaceId, direction, steps, focusPolicy }) => tools.transformNudge(workspaceId, direction, steps, { focusPolicy }),
  );
  write(
    "krita_transform_commit",
    "Commit Krita transform",
    "Commit the active transform with Enter and report an explicit unverified state until visual confirmation.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.transformCommit(workspaceId, { focusPolicy }),
  );
  write(
    "krita_transform_cancel",
    "Cancel Krita transform",
    "Cancel the active transform with Escape inside the verified Krita window.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.transformCancel(workspaceId, { focusPolicy }),
  );

  read(
    "krita_get_view_state",
    "Get Krita view state",
    "Read zoom from the verified Krita status-bar target through bounded UI Automation; rotation and mirror remain unknown unless independently observed.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.getViewState(workspaceId),
  );

  write(
    "krita_execute_transaction",
    "Execute Krita safety transaction",
    "Run a bounded allowlisted Krita workflow with window/dialog/calibration checks, optional foreground restoration, capture, and explicit confidence/recovery reporting. Arbitrary code and arbitrary tool names are rejected.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      goal: z.string().min(1).max(256),
      steps: z.array(transactionStepSchema).min(1).max(7),
      operation: transactionOperationSchema.optional(),
    },
    ({ workspaceId, goal, steps, operation }) => tools.executeTransaction(workspaceId, { goal, steps, operation }),
  );

  write(
    "krita_batch",
    "Batch Krita operations",
    "Run up to 16 explicit no-plugin action, click, stroke, fill, or selection operations in order. Nested batches are rejected and partial completion is reported by failure.",
    { workspaceId: WORKSPACE_ID_SCHEMA, operations: z.array(batchOperationSchema).min(1).max(16), focusPolicy: focusPolicySchema },
    ({ workspaceId, operations, focusPolicy }) => tools.batch(workspaceId, operations, { focusPolicy }),
  );

  write(
    "krita_undo",
    "Undo Krita",
    "Execute the validated Krita undo shortcut without GUI searching.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.undo(workspaceId, { focusPolicy }),
  );

  write(
    "krita_redo",
    "Redo Krita",
    "Execute the validated Krita redo shortcut without GUI searching.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.redo(workspaceId, { focusPolicy }),
  );

  write(
    "krita_save",
    "Save Krita document",
    "Execute the validated Krita save shortcut and report whether a Krita-owned save dialog needs recovery; never claim success from the key event alone.",
    { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
    ({ workspaceId, focusPolicy }) => tools.save(workspaceId, { focusPolicy }),
  );

  write(
    "krita_save_as",
    "Save Krita document as",
    "Request Save As for an absolute destination and return explicit dialog/recovery state. The endpoint never blindly navigates a file dialog or claims the path was written.",
    { workspaceId: WORKSPACE_ID_SCHEMA, path: z.string().min(1).max(2048), overwritePolicy: z.enum(["allow", "deny"]).optional(), focusPolicy: focusPolicySchema },
    ({ workspaceId, path, overwritePolicy, focusPolicy }) => tools.saveAs(workspaceId, path, overwritePolicy ?? "deny", { focusPolicy }),
  );

  write(
    "krita_export_to",
    "Export Krita document",
    "Request export to an absolute destination and return explicit dialog/recovery state. File overwrite and format controls require owned, visually verified dialogs.",
    { workspaceId: WORKSPACE_ID_SCHEMA, path: z.string().min(1).max(2048), format: z.string().min(1).max(16), overwritePolicy: z.enum(["allow", "deny"]).optional(), focusPolicy: focusPolicySchema },
    ({ workspaceId, path, format, overwritePolicy, focusPolicy }) => tools.exportTo(workspaceId, path, format, overwritePolicy ?? "deny", { focusPolicy }),
  );

  write(
    "krita_checkpoint",
    "Create Krita checkpoint",
    "Capture the calibrated Krita canvas as a private checkpoint preview. Unsaved documents require an explicit documentPath and approveUnsavedLocation=true; no blind save is claimed.",
    { workspaceId: WORKSPACE_ID_SCHEMA, documentPath: z.string().min(1).max(2048).optional(), approveUnsavedLocation: z.literal(true).optional() },
    ({ workspaceId, documentPath, approveUnsavedLocation }) => tools.checkpoint(workspaceId, { documentPath, approveUnsavedLocation }),
  );

  read(
    "krita_list_checkpoints",
    "List Krita checkpoints",
    "List private Krita canvas checkpoint metadata for this workspace.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.listCheckpoints(workspaceId),
  );

  registerAppTool(server, "krita_capture_checkpoint_image", {
    title: "Capture Krita checkpoint image",
    description: "Return a stored target-only Krita checkpoint preview.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, checkpointId: z.string().min(1).max(128) },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, checkpointId }) => {
    try {
      const buffer = await tools.captureCheckpointImage(workspaceId, checkpointId);
      return { content: [...inlineImageOrNotice(buffer, "Krita checkpoint", "image/png")] };
    } catch (error) { return errorResult(error); }
  });

  read(
    "krita_compare_canvas",
    "Compare Krita canvas",
    "Compare the current calibrated canvas with a stored checkpoint using bounded pixel difference metrics.",
    { workspaceId: WORKSPACE_ID_SCHEMA, checkpointId: z.string().min(1).max(128) },
    ({ workspaceId, checkpointId }) => tools.compareCanvas(workspaceId, checkpointId),
  );

  write(
    "krita_checkpoint_restore",
    "Restore Krita checkpoint",
    "Validate a checkpoint reference and report recovery requirements. Replacing the live document remains fail-closed until a verified file-dialog workflow is available.",
    { workspaceId: WORKSPACE_ID_SCHEMA, checkpointId: z.string().min(1).max(128), approveOverwrite: z.literal(true).optional() },
    ({ workspaceId, checkpointId, approveOverwrite }) => tools.restoreCheckpoint(workspaceId, checkpointId, { approveOverwrite }),
  );

  read(
    "krita_get_dialog_state",
    "Get Krita dialog state",
    "Detect only visible Krita-owned popups and classify common Open, Save As, Export, overwrite, unsaved-change, and color dialogs. Unknown ownership fails closed.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.getDialogState(workspaceId),
  );

  registerAppTool(server, "krita_capture_dialog", {
    title: "Capture Krita dialog",
    description: "Capture a visible Krita-owned dialog only; foreign or uncertain popups are never captured.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    try {
      const image = await tools.captureDialog(workspaceId);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ target: image.target, bounds: image.bounds, captureBackend: image.captureBackend, occlusionSafe: image.occlusionSafe }, null, 2) },
          ...inlineImageOrNotice(image.buffer, "Krita dialog", image.mimeType),
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  for (const [name, decision, title] of [
    ["krita_dialog_confirm", "confirm", "Confirm Krita dialog"],
    ["krita_dialog_cancel", "cancel", "Cancel Krita dialog"],
  ] as const) {
    write(
      name,
      title,
      "Send one bounded Enter/Escape decision to a verified Krita-owned dialog. The result remains explicitly unverified until the caller inspects the follow-up state.",
      { workspaceId: WORKSPACE_ID_SCHEMA, focusPolicy: focusPolicySchema },
      ({ workspaceId, focusPolicy }) => tools.dialogDecision(workspaceId, decision, { focusPolicy }),
    );
  }

  for (const [name, field, title] of [
    ["krita_dialog_set_filename", "filename", "Set Krita dialog filename"],
    ["krita_dialog_set_path", "path", "Set Krita dialog path"],
  ] as const) {
    write(
      name,
      title,
      "Set a dialog text field only after a verified field target exists; blind tab-order navigation is rejected.",
      { workspaceId: WORKSPACE_ID_SCHEMA, value: z.string().min(1).max(2048), focusPolicy: focusPolicySchema },
      ({ workspaceId, value, focusPolicy }) => tools.setDialogText(workspaceId, field, value, { focusPolicy }),
    );
  }

  write(
    "krita_set_expected_state",
    "Set Krita expected state",
    "Record state established or assumed by the agent. Values are labeled expected and are not returned as authoritative application state.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      state: expectedStatePatchSchema,
      source: z.string().min(1).max(256).optional(),
    },
    ({ workspaceId, state, source }) => tools.setExpectedState(workspaceId, state, source),
  );

  write(
    "krita_mark_state_unknown",
    "Mark Krita state unknown",
    "Invalidate selected expected-state fields after an uncertain GUI action or external user change.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      fields: z.array(trackedStateFieldSchema).min(1).max(KRITA_TRACKED_STATE_FIELDS.length),
      source: z.string().min(1).max(256).optional(),
    },
    ({ workspaceId, fields, source }) => tools.markStateUnknown(workspaceId, fields, source),
  );

  write(
    "krita_confirm_state",
    "Confirm Krita state",
    "Mark selected recorded values visually verified after checking a calibrated Krita UI crop.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      fields: z.array(trackedStateFieldSchema).min(1).max(KRITA_TRACKED_STATE_FIELDS.length),
      source: z.string().min(1).max(256).optional(),
    },
    ({ workspaceId, fields, source }) => tools.verifyState(workspaceId, fields, source),
  );

  write(
    "krita_reset_expected_state",
    "Reset Krita expected state",
    "Reset all tracked application fields to unknown without changing the live Krita document.",
    { workspaceId: WORKSPACE_ID_SCHEMA },
    ({ workspaceId }) => tools.resetState(workspaceId),
  );

  write(
    "krita_canvas_click",
    "Click Krita canvas",
    "Click a normalized point inside the currently calibrated canvas using bounded desktop input.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      point: normalizedPointSchema,
      button: z.enum(["left", "right", "middle"]).optional(),
      clickCount: z.number().int().min(1).max(3).optional(),
      focusPolicy: focusPolicySchema,
    },
    ({ workspaceId, point, button, clickCount, focusPolicy }) => tools.canvasClick(workspaceId, point, { button, clickCount, focusPolicy }),
  );

  write(
    "krita_stroke",
    "Draw Krita straight stroke",
    "Draw one bounded straight mouse/stylus-style stroke between two normalized canvas coordinates.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      start: normalizedPointSchema,
      end: normalizedPointSchema,
      durationMs: z.number().int().min(0).max(10_000).optional(),
      button: z.enum(["left", "right", "middle"]).optional(),
      focusPolicy: focusPolicySchema,
    },
    ({ workspaceId, start, end, durationMs, button, focusPolicy }) => tools.stroke(workspaceId, start, end, { durationMs, button, focusPolicy }),
  );

  write(
    "krita_path_stroke",
    "Draw Krita path stroke",
    "Draw a bounded multi-point path through normalized canvas coordinates. Every segment is checked against the current calibration; this tool does not use plugins or arbitrary Krita code.",
    {
      workspaceId: WORKSPACE_ID_SCHEMA,
      points: z.array(pathPointSchema).min(2).max(512),
      button: z.enum(["left", "right", "middle"]).optional(),
      focusPolicy: focusPolicySchema,
    },
    ({ workspaceId, points, button, focusPolicy }) => tools.pathStroke(workspaceId, points, button, { focusPolicy }),
  );

  write(
    "krita_pan",
    "Pan Krita canvas",
    "Pan the calibrated Krita canvas with a bounded middle-button path. Requires explicit calibration and confirmation.",
    { workspaceId: WORKSPACE_ID_SCHEMA, points: z.array(pathPointSchema).min(2).max(128), focusPolicy: focusPolicySchema },
    ({ workspaceId, points, focusPolicy }) => tools.pan(workspaceId, points, { focusPolicy }),
  );
}

function jsonAction(action: () => unknown | Promise<unknown>) {
  return Promise.resolve()
    .then(action)
    .then((value) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }))
    .catch(errorResult);
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true as const,
  };
}
