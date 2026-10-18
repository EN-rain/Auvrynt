import type { KritaShortcutCommand } from "./krita-shortcuts.js";
import type { KritaShortcutProfile } from "./krita-shortcuts.js";
import type { KritaUiRegionName } from "./krita-ui-targets.js";

export type KritaActionExecution = "shortcut" | "canvas" | "ui-target" | "unsupported-no-plugin";
export interface KritaActionReadinessContext {
  shortcutProfile?: KritaShortcutProfile;
  calibrationValid?: boolean;
  uiTargetIds?: readonly string[];
  uiTargetRegions?: readonly KritaUiRegionName[];
}

export interface KritaActionDefinition {
  id: string;
  label: string;
  execution: KritaActionExecution;
  available: boolean;
  supported: boolean;
  ready: boolean;
  blockingPreconditions: string[];
  shortcutCommand?: KritaShortcutCommand;
  requiredShortcutCommands?: KritaShortcutCommand[];
  requiredUiTargetId?: string;
  requiredUiTargetRegion?: KritaUiRegionName;
  /** A semantic verifier that must be available in addition to geometry. */
  requiredUiVerifier?: string;
  requiresCalibration: boolean;
  reason?: string;
}

const ACTIONS: readonly KritaActionDefinition[] = [
  shortcut("new_document", "New document", "new_document"),
  shortcut("open_document", "Open document", "open_document"),
  shortcut("save", "Save document", "save"),
  shortcut("undo", "Undo", "undo"),
  shortcut("redo", "Redo", "redo"),
  shortcut("brush_tool", "Freehand brush tool", "brush_tool"),
  shortcut("create_layer", "Create paint layer", "new_layer"),
  targetedUi("select_layer", "Select layer by name", "layers-panel", "layers_docker", "An exact visible layer row and selected-state verification are required."),
  targetedUi("set_layer", "Set active layer", "layers-panel", "layers_docker", "An exact visible layer row and selected-state verification are required."),
  shortcut("delete_layer", "Delete active layer", "delete_layer"),
  shortcut("duplicate_layer", "Duplicate active layer", "duplicate_layer"),
  targetedUi("set_brush", "Set brush preset", "brush-presets", "brush_presets_docker", "A verified Brush Presets target plus exact visible-name and selected-state verification are required."),
  targetedUi("set_brush_size", "Set brush size", "brush-size", "toolbar", "A verified toolbar target and post-entry visual value check are required."),
  targetedUi("set_color", "Set foreground color", "foreground-color", "foreground_color_control", "A verified color-control target and post-entry visual swatch check are required."),
  shortcut("transform_tool", "Transform tool", "transform_tool"),
  shortcut("fill_tool", "Fill tool", "fill_tool"),
  shortcut("select_rect", "Rectangular selection tool", "select_rect"),
  shortcut("select_ellipse", "Elliptical selection tool", "select_ellipse"),
  shortcut("export", "Export document", "export"),
  shortcut("zoom_in", "Zoom in", "zoom_in"),
  shortcut("zoom_out", "Zoom out", "zoom_out"),
  shortcut("fit_canvas", "Fit canvas", "fit_canvas"),
  targetedUi("rename_layer", "Rename active layer", "active-layer-name", "layers_docker", "A verified active-layer text target and post-entry visual check are required.", "rename_layer"),
  shortcut("move_layer_up", "Move active layer up", "move_layer_up"),
  shortcut("move_layer_down", "Move active layer down", "move_layer_down"),
  shortcut("toggle_layer_visibility", "Toggle active layer visibility", "toggle_layer_visibility"),
  shortcut("toggle_layer_lock", "Toggle active layer lock", "toggle_layer_lock"),
  shortcut("select_previous_layer", "Select previous layer", "select_previous_layer"),
  shortcut("select_next_layer", "Select next layer", "select_next_layer"),
  canvasAction("pick_layer_at_point", "Pick layer at point", "Picking a layer requires a verified calibrated canvas point and visual Layers-docker follow-up."),
  shortcut("select_all", "Select all", "select_all"),
  shortcut("invert_selection", "Invert selection", "invert_selection"),
  shortcut("deselect", "Deselect", "deselect"),
  shortcut("reset_canvas_rotation", "Reset canvas rotation", "reset_canvas_rotation"),
  composite(
    "fill",
    "Fill region",
    ["fill_tool"],
    "Fill requires a validated fill-tool binding and a verified calibrated canvas point.",
  ),
  composite(
    "select",
    "Select region",
    ["select_rect", "select_ellipse"],
    "Selection requires a validated tool binding and verified calibrated geometry.",
  ),
  unsupported("transform_selection", "Transform selection", "Selection transform parameters are not queryable through the no-plugin path."),
  availableBatch(),
];

export function listKritaActions(context?: KritaActionReadinessContext): KritaActionDefinition[] {
  return ACTIONS.map((action) => resolveReadiness(action, context));
}

export function getKritaAction(id: string, context?: KritaActionReadinessContext): KritaActionDefinition | undefined {
  const action = ACTIONS.find((candidate) => candidate.id === id);
  return action ? resolveReadiness(action, context) : undefined;
}

export function searchKritaActions(query: string, context?: KritaActionReadinessContext): KritaActionDefinition[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return listKritaActions(context);
  return ACTIONS
    .filter((action) => [action.id, action.label, action.reason ?? ""].some((value) => value.toLowerCase().includes(normalized)))
    .map((action) => resolveReadiness(action, context));
}

function shortcut(id: string, label: string, shortcutCommand: KritaShortcutCommand): KritaActionDefinition {
  return {
    id,
    label,
    execution: "shortcut",
    available: true,
    supported: true,
    ready: false,
    blockingPreconditions: ["validated_shortcut"],
    shortcutCommand,
    requiresCalibration: false,
  };
}

function unsupported(id: string, label: string, reason: string): KritaActionDefinition {
  return {
    id,
    label,
    execution: "unsupported-no-plugin",
    available: false,
    supported: false,
    ready: false,
    blockingPreconditions: ["unsupported_no_plugin"],
    requiresCalibration: false,
    reason,
  };
}

function targetedUi(
  id: string,
  label: string,
  targetId: string,
  targetRegion: KritaUiRegionName,
  reason: string,
  requiredShortcutCommand?: KritaShortcutCommand,
  requiredUiVerifier?: string,
): KritaActionDefinition {
  return {
    id,
    label,
    execution: "ui-target",
    available: true,
    supported: true,
    ready: false,
    blockingPreconditions: [`verified_${targetId}_target`],
    requiresCalibration: false,
    requiredUiTargetId: targetId,
    requiredUiTargetRegion: targetRegion,
    requiredShortcutCommands: requiredShortcutCommand ? [requiredShortcutCommand] : undefined,
    requiredUiVerifier,
    reason,
  };
}

function canvasAction(id: string, label: string, reason: string): KritaActionDefinition {
  return {
    id,
    label,
    execution: "canvas",
    available: true,
    supported: true,
    ready: false,
    blockingPreconditions: ["verified_calibration"],
    requiresCalibration: true,
    reason,
  };
}

function composite(
  id: string,
  label: string,
  requiredShortcutCommands: KritaShortcutCommand[],
  reason: string,
): KritaActionDefinition {
  return {
    id,
    label,
    execution: "canvas",
    available: true,
    supported: true,
    ready: false,
    blockingPreconditions: [
      `validated_${id === "fill" ? "fill_tool" : "selection"}_shortcut`,
      "verified_calibration",
    ],
    requiredShortcutCommands,
    requiresCalibration: true,
    reason,
  };
}

function availableBatch(): KritaActionDefinition {
  return {
    id: "batch",
    label: "Batch drawing operations",
    execution: "canvas",
    available: true,
    supported: true,
    ready: false,
    blockingPreconditions: ["verified_calibration"],
    requiresCalibration: true,
    reason: "Each operation is still bounded and executed sequentially; nested batches are rejected.",
  };
}

function resolveReadiness(
  action: KritaActionDefinition,
  context?: KritaActionReadinessContext,
): KritaActionDefinition {
  const cloned = cloneAction(action);
  if (!action.supported) return cloned;
  const blocking: string[] = [];
  const requiredShortcuts = action.requiredShortcutCommands
    ?? (action.shortcutCommand ? [action.shortcutCommand] : []);
  if (requiredShortcuts.length > 0) {
    if (!context?.shortcutProfile) {
      blocking.push(...action.blockingPreconditions.filter((value) => value.includes("shortcut")));
    } else {
      for (const command of requiredShortcuts) {
        const binding = context.shortcutProfile.bindings[command];
        if (!binding) blocking.push(`configured_${command}_shortcut`);
        else if (!binding.validated) blocking.push(`validated_${command}_shortcut`);
      }
    }
  }
  if (action.requiresCalibration && context?.calibrationValid !== true) blocking.push("verified_calibration");
  if (action.requiredUiTargetId || action.requiredUiTargetRegion) {
    const idReady = action.requiredUiTargetId ? Boolean(context?.uiTargetIds?.includes(action.requiredUiTargetId)) : false;
    // A structural region (for example the full toolbar or Layers docker) is
    // never enough to unlock a control-specific action. Only the canonical,
    // independently verified target id may satisfy this gate.
    if (!idReady && !action.requiredUiVerifier) {
      blocking.push(action.requiredUiTargetId
        ? `verified_${action.requiredUiTargetId}_target`
        : `verified_${action.requiredUiTargetRegion}_target`);
    }
  }
  if (action.requiredUiVerifier) blocking.push(action.requiredUiVerifier);
  cloned.blockingPreconditions = [...new Set(blocking)];
  cloned.ready = cloned.blockingPreconditions.length === 0;
  return cloned;
}

function normalizeQuery(query: string): string {
  if (typeof query !== "string") throw new Error("Krita action search query must be a string.");
  const normalized = query.trim().toLowerCase();
  if (normalized.length > 128 || /[\r\n\0]/.test(normalized)) {
    throw new Error("Krita action search query is invalid.");
  }
  return normalized;
}

function cloneAction(action: KritaActionDefinition): KritaActionDefinition {
  return {
    ...action,
    blockingPreconditions: [...action.blockingPreconditions],
    requiredShortcutCommands: action.requiredShortcutCommands ? [...action.requiredShortcutCommands] : undefined,
  };
}
