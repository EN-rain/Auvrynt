import type { KritaShortcutProfile } from "./krita-shortcuts.js";
import type { KritaExpectedState } from "./krita-state.js";
import type { KritaUiTarget } from "./krita-ui-targets.js";

export type KritaReadinessStatus = "ready" | "blocked" | "needs_validation" | "missing" | "unknown";

export interface KritaReadinessInput {
  windowCapture: boolean;
  canvasCapture: boolean;
  autoCalibration: boolean;
  calibrationValid: boolean;
  shortcuts: KritaShortcutProfile;
  state: KritaExpectedState;
  targets: KritaUiTarget[];
  calibrationReason?: string;
  calibrationVerifiedAt?: string;
}

export function buildKritaReadinessReport(input: KritaReadinessInput): Record<string, unknown> {
  const bindingStatus = (command: keyof KritaShortcutProfile["bindings"]): KritaReadinessStatus => {
    const binding = input.shortcuts.bindings[command];
    if (!binding) return "missing";
    return binding.validated ? "ready" : "needs_validation";
  };
  const target = (id: string) => input.targets.some((candidate) => candidate.id === id && candidate.confidence >= 0.8);
  return {
    generatedAt: new Date().toISOString(),
    mode: "no-plugin-desktop",
    observation: {
      windowCapture: input.windowCapture ? "ready" : "blocked",
      canvasCapture: input.canvasCapture ? "ready" : input.calibrationValid ? "unknown" : "blocked",
      autoCalibration: input.autoCalibration ? "ready" : "blocked",
    },
    calibration: {
      valid: input.calibrationValid,
      reason: input.calibrationReason,
      verifiedAt: input.calibrationVerifiedAt,
    },
    drawing: {
      click: input.calibrationValid ? "ready" : "blocked",
      stroke: input.calibrationValid ? "ready" : "blocked",
      pathStroke: input.calibrationValid ? "ready" : "blocked",
      batch: input.calibrationValid ? "ready" : "blocked",
    },
    brush: {
      tool: bindingStatus("brush_tool"),
      // Geometry and safe input availability are deliberately independent of
      // the last observed value. A stale/unknown value must not hide a safe
      // control, while callers still receive the separate confidence field.
      size: target("brush-size") ? "ready" : "blocked",
      sizeStateConfidence: input.state.fields.brushSize.confidence,
      preset: target("brush-presets") ? "ready" : "blocked",
      presetStateConfidence: input.state.fields.brushPreset.confidence,
      presetBlocker: target("brush-presets") ? undefined : "verified_brush-presets_target",
      color: target("foreground-color") ? "ready" : "blocked",
      colorStateConfidence: input.state.fields.foregroundColor.confidence,
    },
    layers: {
      create: bindingStatus("new_layer"),
      delete: bindingStatus("delete_layer"),
      duplicate: bindingStatus("duplicate_layer"),
      pickAtPoint: input.calibrationValid ? "unknown" : "blocked",
      rename: target("active-layer-name") ? bindingStatus("rename_layer") : "blocked",
      renameStateConfidence: input.state.fields.activeLayerName.confidence,
      reorder: bindingStatus("move_layer_up") === "ready" && bindingStatus("move_layer_down") === "ready" ? "ready" : "blocked",
      visibility: bindingStatus("toggle_layer_visibility"),
      lock: bindingStatus("toggle_layer_lock"),
    },
    selection: {
      rectangle: bindingStatus("select_rect") === "ready" && input.calibrationValid ? "ready" : "blocked",
      ellipse: bindingStatus("select_ellipse") === "ready" && input.calibrationValid ? "ready" : "blocked",
      selectAll: bindingStatus("select_all"),
      invert: bindingStatus("invert_selection"),
      deselect: bindingStatus("deselect"),
    },
    view: {
      zoomIn: bindingStatus("zoom_in"),
      zoomOut: bindingStatus("zoom_out"),
      fitCanvas: bindingStatus("fit_canvas"),
      pan: input.calibrationValid ? "ready" : "blocked",
    },
    file: {
      save: bindingStatus("save"),
      saveAs: bindingStatus("save_as"),
      export: bindingStatus("export"),
    },
    recovery: {
      ownedDialogs: input.windowCapture ? "ready" : "unknown",
      checkpoints: "ready",
      visualComparison: input.canvasCapture ? "ready" : "blocked",
    },
  };
}
