import { captureDesktopFrame, type DesktopCaptureFrame } from "../desktop/desktop-capture.js";
import {
  desktopKeyPress,
  desktopKeyDown,
  desktopKeyUp,
  desktopMouseClick,
  desktopMouseClickAndKeyPress,
  desktopMouseDrag,
  desktopType,
} from "../desktop/desktop-input.js";
import type { DesktopFocusPolicy } from "../desktop/desktop-input.js";
import {
  calibrateKritaCanvas,
  checkKritaCalibration,
  clearKritaCalibration,
  getKritaCalibration,
  mapNormalizedCanvasPoint,
  markKritaCalibrationVerified,
  requireValidKritaCalibration,
  type KritaCanvasCalibration,
  type KritaCanvasRegion,
  type KritaNormalizedPoint,
} from "./krita-calibration.js";
import {
  getKritaShortcutProfile,
  confirmKritaShortcutProbes,
  configureKritaShortcutPersistence,
  getKritaRecommendedShortcuts,
  prepareKritaShortcuts,
  markKritaShortcutsUnvalidated,
  markKritaShortcutsValidated,
  recordKritaShortcutProbe,
  resetKritaShortcutBinding,
  resolveKritaShortcut,
  setKritaShortcutBinding,
  type KritaShortcutCommand,
  type KritaShortcutPreparation,
} from "./krita-shortcuts.js";
import { createKritaInstallationFingerprint, detectKritaInstallationFingerprint } from "./krita-shortcut-fingerprint.js";
import {
  getKritaExpectedState,
  markKritaStateUnknown,
  markKritaStateVisuallyVerified,
  resetKritaExpectedState,
  updateKritaExpectedState,
  type KritaStateValue,
  type KritaTrackedStateField,
} from "./krita-state.js";
import {
  getKritaAction,
  listKritaActions,
  searchKritaActions,
  type KritaActionDefinition,
} from "./krita-action-catalog.js";
import { getKritaWindowInfo, getKritaWindowStatus } from "./krita-window.js";
import type { KritaWindowInfo } from "./krita-window.js";
import { KRITA_PROCESS_NAME } from "./krita-window-target.js";
import { detectKritaCanvasRegion } from "./krita-canvas-detector.js";
import { decodePngRgba } from "./krita-png-decoder.js";
import { listDesktopDisplays } from "../desktop/desktop-displays.js";
import {
  getKritaApprovedBrush,
  listKritaApprovedBrushes,
  normalizeKritaBrushSize,
  normalizeKritaColor,
  requireVerifiedControlTarget,
} from "./krita-controls.js";
import {
  clearKritaUiTarget,
  discoverKritaUiTargets,
  getKritaUiTarget,
  listKritaUiTargets,
  recordKritaUiTarget,
  refreshKritaUiTargets,
  type KritaUiRegionName,
  type KritaUiTarget,
  type KritaUiTargetInput,
} from "./krita-ui-targets.js";
import { resolveKritaDialogState, sendKritaDialogDecision, type KritaDialogState } from "./krita-dialogs.js";
import {
  discoverKritaDialogSubtargets,
  getKritaDialogSubtarget,
  listKritaDialogSubtargets,
  refreshKritaDialogSubtargets,
  type KritaDialogSubtarget,
  type KritaDialogSubtargetId,
} from "./krita-dialog-targets.js";
import { buildKritaReadinessReport } from "./krita-readiness.js";
import {
  compareKritaCanvasPng,
  configureKritaCheckpointStore,
  createKritaCheckpoint,
  getKritaCheckpoint,
  getKritaCheckpointBuffer,
  listKritaCheckpoints,
  type KritaCanvasComparison,
  type KritaCheckpoint,
} from "./krita-checkpoints.js";
import { validateKritaTransactionRequest, type KritaTransactionRequest, type KritaTransactionResult } from "./krita-transactions.js";
import { createHash } from "node:crypto";
import { parseKritaBrushSizeText, parseKritaZoomText, readKritaUiTargetText } from "./krita-ui-text.js";
import { queryKritaUiTargetElements } from "./krita-ui-text.js";
import type { KritaUiAutomationElement } from "./krita-ui-text.js";

export interface KritaNormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KritaPathPoint extends KritaNormalizedPoint {
  durationMs?: number;
}

export interface KritaInputOptions {
  focusPolicy?: DesktopFocusPolicy;
  /** Internal target-focus hint; never accepted directly from the MCP boundary. */
  focusTargetId?: "active-layer-name";
}

export type KritaBatchOperation =
  | { type: "action"; actionId: string }
  | { type: "click"; point: KritaNormalizedPoint; button?: "left" | "right" | "middle"; clickCount?: number }
  | { type: "stroke"; start: KritaNormalizedPoint; end: KritaNormalizedPoint; durationMs?: number; button?: "left" | "right" | "middle" }
  | { type: "path"; points: KritaPathPoint[]; button?: "left" | "right" | "middle" }
  | { type: "fill"; point: KritaNormalizedPoint }
  | { type: "select"; shape: "rectangle" | "ellipse"; start: KritaNormalizedPoint; end: KritaNormalizedPoint };

export interface KritaActionDependencies {
  getWindowInfo: typeof getKritaWindowInfo;
  getStatusWindowInfo?: typeof getKritaWindowStatus;
  captureFrame: typeof captureDesktopFrame;
  calibrateCanvas?: typeof calibrateKritaCanvas;
  checkCanvasCalibration?: typeof checkKritaCalibration;
  requireCalibration?: typeof requireValidKritaCalibration;
  clearCanvasCalibration?: typeof clearKritaCalibration;
  verifyCanvasCalibration?: typeof markKritaCalibrationVerified;
  autoCalibrate?: (workspaceId: string) => Promise<unknown>;
  keyPress: typeof desktopKeyPress;
  keyDown?: typeof desktopKeyDown;
  keyUp?: typeof desktopKeyUp;
  mouseClick: typeof desktopMouseClick;
  mouseClickAndKeyPress?: typeof desktopMouseClickAndKeyPress;
  mouseDrag: typeof desktopMouseDrag;
  typeText?: (workspaceId: string, text: string, windowTitle?: string, windowHandle?: string, processName?: string, options?: { focusPolicy?: DesktopFocusPolicy }) => Promise<{ typedCharacters: number }>;
  getShortcutFingerprint?: (processName?: string) => Promise<string>;
  /** Optional bounded refresher used by tests or an embedding host. The
   * default path performs a fresh target-only Krita capture. */
  refreshUiTargets?: (workspaceId: string) => Promise<unknown>;
  readUiTargetText?: (workspaceId: string, target: KritaUiTarget, frame: DesktopCaptureFrame) => Promise<string | undefined>;
  queryUiTargetElements?: typeof queryKritaUiTargetElements;
  listDisplays?: typeof listDesktopDisplays;
}

const DEFAULT_DEPENDENCIES: KritaActionDependencies = {
  getWindowInfo: getKritaWindowInfo,
  getStatusWindowInfo: getKritaWindowStatus,
  captureFrame: captureDesktopFrame,
  calibrateCanvas: calibrateKritaCanvas,
  checkCanvasCalibration: checkKritaCalibration,
  requireCalibration: requireValidKritaCalibration,
  clearCanvasCalibration: clearKritaCalibration,
  verifyCanvasCalibration: markKritaCalibrationVerified,
  keyPress: desktopKeyPress,
  mouseClick: desktopMouseClick,
  mouseClickAndKeyPress: desktopMouseClickAndKeyPress,
  mouseDrag: desktopMouseDrag,
  typeText: desktopType,
  getShortcutFingerprint: detectKritaInstallationFingerprint,
  readUiTargetText: readKritaUiTargetText,
  queryUiTargetElements: queryKritaUiTargetElements,
  listDisplays: listDesktopDisplays,
};

export class KritaActions {
  constructor(
    private readonly deps: KritaActionDependencies = DEFAULT_DEPENDENCIES,
    options: { shortcutStateDir?: string; checkpointStateDir?: string } = {},
  ) {
    if (options.shortcutStateDir !== undefined) configureKritaShortcutPersistence(options.shortcutStateDir);
    if (options.checkpointStateDir !== undefined) configureKritaCheckpointStore(options.checkpointStateDir);
  }

  async status(workspaceId: string): Promise<Record<string, unknown>> {
    let window: unknown;
    try {
      window = await (this.deps.getStatusWindowInfo ?? this.deps.getWindowInfo)("Krita");
    } catch (error) {
      return {
        online: false,
        mode: "no-plugin-desktop",
        pluginRequired: false,
        pluginUsed: false,
        window: { available: false, reason: error instanceof Error ? error.message : String(error) },
        calibration: { valid: false, reason: "window-unavailable" },
        shortcuts: getKritaShortcutProfile(workspaceId),
        expectedState: getKritaExpectedState(workspaceId),
      };
    }
    let calibration: unknown;
    try {
      calibration = await (this.deps.checkCanvasCalibration ?? checkKritaCalibration)(workspaceId);
    } catch (error) {
      calibration = { valid: false, reason: error instanceof Error ? error.message : String(error) };
    }
    return {
      online: true,
      mode: "no-plugin-desktop",
      pluginRequired: false,
      pluginUsed: false,
      window,
      calibration,
      shortcuts: getKritaShortcutProfile(workspaceId),
      expectedState: getKritaExpectedState(workspaceId),
    };
  }

  /** Return the currently resolved Krita window without changing focus. */
  async getWindow(workspaceId: string): Promise<KritaWindowInfo> {
    void workspaceId;
    return this.deps.getWindowInfo("Krita");
  }

  /** Capture only the Krita top-level window; desktop pixels are never used. */
  async captureWindow(
    workspaceId: string,
    input: { maxWidth?: number; quality?: number } = {},
  ): Promise<DesktopCaptureFrame> {
    const window = await this.deps.getWindowInfo("Krita");
    return this.deps.captureFrame({
      target: "app-window",
      windowTitle: window.title,
      processName: window.processName || KRITA_PROCESS_NAME,
      windowHandle: window.windowHandle,
      maxWidth: input.maxWidth ?? 1600,
      quality: input.quality ?? 80,
      format: "png",
    });
  }

  async registerUiTarget(workspaceId: string, input: KritaUiTargetInput): Promise<KritaUiTarget> {
    const window = await this.deps.getWindowInfo("Krita");
    return recordKritaUiTarget(workspaceId, window, input);
  }

  async listUiTargets(workspaceId: string): Promise<KritaUiTarget[]> {
    const window = await this.deps.getWindowInfo("Krita");
    refreshKritaUiTargets(workspaceId, window);
    if (listKritaUiTargets(workspaceId).length === 0) {
      try { await this.discoverUiTargets(workspaceId); } catch { /* callers receive an empty, conservative list */ }
    }
    return listKritaUiTargets(workspaceId);
  }

  async refreshUiTargets(
    workspaceId: string,
    inputs: KritaUiTargetInput[] = [],
  ): Promise<{ active: KritaUiTarget[]; invalidated: Array<{ id: string; reason: string }>; added: KritaUiTarget[]; note?: string }> {
    if (inputs.length === 0) return this.discoverUiTargets(workspaceId);
    const window = await this.deps.getWindowInfo("Krita");
    const refreshed = refreshKritaUiTargets(workspaceId, window);
    const added: KritaUiTarget[] = [];
    for (const input of inputs) added.push(recordKritaUiTarget(workspaceId, window, input));
    return {
      active: listKritaUiTargets(workspaceId),
      invalidated: refreshed.invalidated,
      added,
      note: inputs.length === 0
        ? "No UI target rectangles were supplied. Automatic semantic control location remains fail-closed until a high-confidence visual or user-confirmed target is available."
      : undefined,
    };
  }

  /**
   * Discover only high-confidence targets from a strict Krita app-window
   * capture. The returned image is never exposed or persisted by this method;
   * only bounded window-relative target metadata is retained in memory.
   */
  async discoverUiTargets(workspaceId: string): Promise<{
    active: KritaUiTarget[];
    invalidated: Array<{ id: string; reason: string }>;
    added: KritaUiTarget[];
    method: "target-only-layout";
    confidence: number;
    canvasRegion?: KritaCanvasRegion;
    rejected: string[];
    capture: { width: number; height: number; captureBackend?: string; occlusionSafe?: boolean; foregroundPreserved: boolean };
  }> {
    const window = await this.deps.getWindowInfo("Krita");
    const frame = await this.deps.captureFrame({
      target: "app-window",
      windowTitle: window.title,
      processName: window.processName || KRITA_PROCESS_NAME,
      windowHandle: window.windowHandle,
      maxWidth: 3840,
      format: "png",
      quality: 90,
    });
    if (frame.mimeType !== "image/png" || frame.format !== "png") {
      throw new Error("Automatic Krita UI target discovery requires a PNG window capture.");
    }
    const image = decodePngRgba(frame.buffer);
    let verifiedCanvasWindowRegion: KritaCanvasRegion | undefined;
    if (this.deps.checkCanvasCalibration) {
      try {
        const calibration = await this.deps.checkCanvasCalibration(workspaceId);
        if (calibration.valid && calibration.calibration) {
          verifiedCanvasWindowRegion = calibration.calibration.canvasWindowRegion;
        }
      } catch {
        // Discovery remains fail-closed when the calibration read is unavailable.
      }
    }
    const discovery = discoverKritaUiTargets(window, image, verifiedCanvasWindowRegion);
    const refreshed = refreshKritaUiTargets(workspaceId, window);
    const added = discovery.targets.map((target) => recordKritaUiTarget(workspaceId, window, target));
    return {
      active: listKritaUiTargets(workspaceId),
      invalidated: refreshed.invalidated,
      added,
      method: discovery.method,
      confidence: discovery.confidence,
      canvasRegion: discovery.canvasRegion,
      rejected: discovery.rejected,
      capture: {
        width: frame.width,
        height: frame.height,
        captureBackend: frame.captureBackend,
        occlusionSafe: frame.occlusionSafe,
        foregroundPreserved: frame.foregroundWindowHandleBefore === frame.foregroundWindowHandleAfter,
      },
    };
  }

  async captureUiRegion(
    workspaceId: string,
    region: KritaUiRegionName,
    input: { targetId?: string; maxWidth?: number; quality?: number } = {},
  ): Promise<DesktopCaptureFrame> {
    const window = await this.deps.getWindowInfo("Krita");
    refreshKritaUiTargets(workspaceId, window);
    let targets = listKritaUiTargets(workspaceId).filter((target) => target.region === region);
    let target = input.targetId ? getKritaUiTarget(workspaceId, input.targetId) : targets[0];
    if (!target) {
      try { await this.discoverUiTargets(workspaceId); } catch { /* preserve the explicit missing-target error below */ }
      targets = listKritaUiTargets(workspaceId).filter((candidate) => candidate.region === region);
      target = input.targetId ? getKritaUiTarget(workspaceId, input.targetId) : targets[0];
    }
    if (!target || target.region !== region) {
      throw new Error(`No verified Krita UI target is available for region ${region}; provide a high-confidence target rectangle first.`);
    }
    const invalidated = refreshKritaUiTargets(workspaceId, window).invalidated.some((item) => item.id === target.id);
    if (invalidated) throw new Error(`Krita UI target ${target.id} became stale after window geometry changed.`);
    return this.deps.captureFrame({
      target: "app-window",
      windowTitle: window.title,
      processName: window.processName || KRITA_PROCESS_NAME,
      windowHandle: window.windowHandle,
      windowRegion: target.windowRegion,
      maxWidth: input.maxWidth ?? 1200,
      quality: input.quality ?? 85,
      format: "png",
    });
  }

  async getDialogState(workspaceId: string): Promise<KritaDialogState> {
    void workspaceId;
    const window = await this.deps.getWindowInfo("Krita");
    return resolveKritaDialogState(window);
  }

  async captureDialog(workspaceId: string): Promise<DesktopCaptureFrame> {
    const window = await this.deps.getWindowInfo("Krita");
    const state = resolveKritaDialogState(window);
    if (!state.present || !state.handle || !state.title) {
      throw new Error(state.confidence === "unknown"
        ? "Krita dialog ownership is unavailable; refusing to capture an uncertain popup."
        : "No visible Krita-owned dialog is open.");
    }
    void workspaceId;
    return this.deps.captureFrame({
      target: "app-window",
      windowTitle: state.title,
      processName: window.processName || KRITA_PROCESS_NAME,
      windowHandle: state.handle,
      maxWidth: 1200,
      quality: 90,
      format: "png",
    });
  }

  async dialogDecision(workspaceId: string, decision: "confirm" | "cancel", options: KritaInputOptions = {}) {
    return sendKritaDialogDecision({
      getWindowInfo: this.deps.getWindowInfo,
      captureFrame: this.deps.captureFrame,
      keyPress: this.deps.keyPress,
    }, workspaceId, decision, options.focusPolicy);
  }

  /** Discover semantic controls inside the currently owned Krita popup. */
  async listDialogSubtargets(workspaceId: string): Promise<KritaDialogSubtarget[]> {
    const window = await this.deps.getWindowInfo("Krita");
    const state = resolveKritaDialogState(window);
    refreshKritaDialogSubtargets(workspaceId, window, state);
    if (!state.present) return [];
    await this.discoverDialogSubtargets(workspaceId, window, state);
    return listKritaDialogSubtargets(workspaceId);
  }

  async setDialogText(
    workspaceId: string,
    field: "filename" | "path",
    value: string,
    options: KritaInputOptions = {},
  ): Promise<Record<string, unknown>> {
    if (typeof value !== "string" || !value.trim() || value.length > 2048 || /[\r\n\0]/.test(value)) {
      throw new Error("Krita dialog text is invalid.");
    }
    if (!this.deps.readUiTargetText) {
      throw new Error("Exact dialog text input requires the bounded UI text verifier; refusing unverified mutation.");
    }
    const window = await this.deps.getWindowInfo("Krita");
    const state = resolveKritaDialogState(window);
    if (!state.present || !state.handle || !state.title) {
      throw new Error(state.confidence === "unknown"
        ? "Krita dialog ownership is unavailable; refusing dialog input."
        : "No visible Krita-owned dialog is open.");
    }
    const discovered = await this.discoverDialogSubtargets(workspaceId, window, state);
    const targetId: KritaDialogSubtargetId = field === "filename" ? "dialog-filename" : "dialog-path";
    const target = discovered.find((candidate) => candidate.id === targetId) ?? getKritaDialogSubtarget(workspaceId, targetId);
    if (!target) {
      throw new Error(`Krita dialog ${field} field was not identified with a unique owned UI target; refusing blind dialog navigation.`);
    }
    const click = await this.clickDialogSubtarget(workspaceId, window, state, target, options);
    const select = await this.deps.keyPress(workspaceId, ["CTRL", "A"], state.title, state.handle, window.processName, { focusPolicy: options.focusPolicy });
    const type = this.deps.typeText
      ? await this.deps.typeText(workspaceId, value, state.title, state.handle, window.processName, { focusPolicy: options.focusPolicy })
      : (() => { throw new Error("Krita dialog text entry requires the bounded text-input path."); })();
    let observed: string | undefined;
    let confidence: "visually_verified" | "unknown" = "unknown";
    try {
      const verification = await this.captureOwnedDialog(workspaceId);
      if (this.deps.readUiTargetText) observed = (await this.deps.readUiTargetText(workspaceId, target, verification.frame))?.trim() || undefined;
    } catch {
      observed = undefined;
    }
    if (observed === value) confidence = "visually_verified";
    return {
      field,
      requested: value,
      observed,
      confidence,
      target,
      input: { click, select, type },
      recoveryRequired: confidence !== "visually_verified",
      note: confidence === "visually_verified"
        ? "The dialog field matched the requested text in a fresh owned-popup UI readback."
        : "The text was entered only into a verified owned popup; the final field value could not be claimed as authoritative.",
    };
  }

  async locateBrushSizeControl(workspaceId: string, input?: { windowRegion: KritaCanvasRegion; confidence: number }) {
    if (input) {
      return this.registerUiTarget(workspaceId, {
        id: "brush-size",
        region: "toolbar",
        windowRegion: input.windowRegion,
        confidence: input.confidence,
        source: "user-confirmed",
      });
    }
    const target = await this.ensureUiTarget(workspaceId, "brush-size");
    if (!target) throw new Error("Brush-size control was not located: provide a high-confidence visual target rectangle; fixed toolbar coordinates are not accepted.");
    return target;
  }

  async getBrushSize(workspaceId: string): Promise<Record<string, unknown>> {
    const target = await this.ensureUiTarget(workspaceId, "brush-size");
    const state = getKritaExpectedState(workspaceId).fields.brushSize;
    if (!target) {
      return { value: undefined, confidence: "unknown", reason: "missing_verified_target" };
    }
    if (this.deps.readUiTargetText) {
      try {
        const frame = await this.captureUiRegion(workspaceId, "toolbar", { targetId: target.id, maxWidth: 800, quality: 90 });
        const text = await this.deps.readUiTargetText(workspaceId, target, frame);
        const value = parseBrushSizeText(text);
        if (value !== undefined) {
          updateKritaExpectedState(workspaceId, { brushSize: value }, { confidence: "visually_verified", source: "toolbar-size-ui-automation" });
          return { value, confidence: "visually_verified", source: "toolbar-size-ui-automation", target };
        }
      } catch {
        // Fall through to an existing verified state, otherwise fail closed.
      }
    }
    if (state.confidence === "visually_verified" && typeof state.value === "number") {
      return { value: state.value, confidence: state.confidence, source: state.source, target };
    }
    return { value: undefined, confidence: "unknown", reason: "brush_size_text_unreadable", target };
  }

  async setBrushSize(workspaceId: string, brushSize: number, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    const normalized = normalizeKritaBrushSize(brushSize);
    const target = requireVerifiedControlTarget(await this.ensureUiTarget(workspaceId, "brush-size"), "brush-size");
    if (!this.deps.readUiTargetText) {
      throw new Error("Exact brush-size input requires the bounded UI text verifier; refusing unverified mutation.");
    }
    let before: number | undefined;
    if (this.deps.readUiTargetText) {
      try {
        const beforeFrame = await this.captureUiRegion(workspaceId, "toolbar", { targetId: target.id, maxWidth: 800, quality: 90 });
        before = parseBrushSizeText(await this.deps.readUiTargetText(workspaceId, target, beforeFrame));
      } catch {
        before = undefined;
      }
    }
    const window = await this.deps.getWindowInfo("Krita");
    const click = await this.clickUiTarget(workspaceId, window, target, options);
    const select = await this.deps.keyPress(workspaceId, ["CTRL", "A"], window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    const type = this.deps.typeText
      ? await this.deps.typeText(workspaceId, String(normalized), window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy })
      : (() => { throw new Error("Exact brush-size input is unavailable because the bounded text-input path is not configured."); })();
    const confirm = await this.deps.keyPress(workspaceId, ["ENTER"], window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    let observed: number | undefined;
    let confidence: "visually_verified" | "unknown" = "unknown";
    if (this.deps.readUiTargetText) {
      const frame = await this.captureUiRegion(workspaceId, "toolbar", { targetId: target.id, maxWidth: 800, quality: 90 });
      observed = parseBrushSizeText(await this.deps.readUiTargetText(workspaceId, target, frame));
      if (observed !== undefined && observed === normalized) {
        confidence = "visually_verified";
        updateKritaExpectedState(workspaceId, { brushSize: observed }, { confidence, source: "toolbar-size-capture" });
      } else {
        markKritaStateUnknown(workspaceId, ["brushSize"], "toolbar-size-verification-failed");
      }
    } else {
      markKritaStateUnknown(workspaceId, ["brushSize"], "toolbar-size-verifier-unavailable");
    }
    return {
      requested: normalized,
      before,
      observed,
      confidence,
      target,
      input: { click, select, type, confirm },
      recoveryRequired: confidence !== "visually_verified",
      note: confidence === "visually_verified"
        ? "The requested brush size matched the post-entry bounded UI readback."
        : "The requested brush size was not claimed as authoritative because post-entry bounded UI readback did not match.",
    };
  }

  async getForegroundColor(workspaceId: string): Promise<Record<string, unknown>> {
    const target = await this.ensureUiTarget(workspaceId, "foreground-color");
    if (target && this.deps.readUiTargetText) {
      try {
        const frame = await this.captureUiRegion(workspaceId, "foreground_color_control", { targetId: target.id, maxWidth: 600, quality: 90 });
        const text = await this.deps.readUiTargetText(workspaceId, target, frame);
        if (text) {
          const color = normalizeKritaColor(text);
          updateKritaExpectedState(workspaceId, { foregroundColor: color }, { confidence: "visually_verified", source: "foreground-color-ui-automation" });
          return { color, confidence: "visually_verified", source: "foreground-color-ui-automation", target };
        }
      } catch {
        // The compact swatch often has no accessible text; use only an older
        // verified state as a conservative fallback below.
      }
    }
    const state = getKritaExpectedState(workspaceId).fields.foregroundColor;
    if (state.confidence === "visually_verified" && typeof state.value === "string") {
      return { color: state.value, confidence: state.confidence, source: state.source, target };
    }
    return { color: undefined, confidence: "unknown", reason: target ? "foreground_color_not_visually_verified" : "missing_verified_target", target };
  }

  async setForegroundColor(workspaceId: string, color: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    const normalized = normalizeKritaColor(color);
    const target = requireVerifiedControlTarget(await this.ensureUiTarget(workspaceId, "foreground-color"), "foreground-color");
    if (!this.deps.readUiTargetText) {
      throw new Error("Exact foreground-color input requires the bounded UI text verifier; refusing unverified mutation.");
    }
    const window = await this.deps.getWindowInfo("Krita");
    const click = await this.clickUiTarget(workspaceId, window, target, options);
    const dialog = await this.captureOwnedDialog(workspaceId);
    if (dialog.state.kind !== "color") {
      throw new Error(`Foreground-color swatch opened an unexpected owned dialog (${dialog.state.kind ?? "unknown"}); refusing blind color entry.`);
    }
    const subtargets = await this.discoverDialogSubtargets(workspaceId, dialog.window, dialog.state);
    const hexTarget = subtargets.find((candidate) => candidate.id === "color-hex-field") ?? getKritaDialogSubtarget(workspaceId, "color-hex-field");
    const confirmTarget = subtargets.find((candidate) => candidate.id === "color-confirm-button" || candidate.id === "dialog-confirm")
      ?? getKritaDialogSubtarget(workspaceId, "color-confirm-button")
      ?? getKritaDialogSubtarget(workspaceId, "dialog-confirm");
    if (!hexTarget || !confirmTarget) {
      throw new Error("Krita color dialog lacks unique verified hex and confirm targets; refusing blind color entry.");
    }
    const fieldClick = await this.clickDialogSubtarget(workspaceId, dialog.window, dialog.state, hexTarget, options);
    const select = await this.deps.keyPress(workspaceId, ["CTRL", "A"], dialog.state.title, dialog.state.handle, dialog.window.processName, { focusPolicy: options.focusPolicy });
    const type = this.deps.typeText
      ? await this.deps.typeText(workspaceId, normalized, dialog.state.title, dialog.state.handle, dialog.window.processName, { focusPolicy: options.focusPolicy })
      : (() => { throw new Error("Exact foreground-color input is unavailable because the bounded text-input path is not configured."); })();
    let observedHex: string | undefined;
    try {
      const verification = await this.captureOwnedDialog(workspaceId);
      if (this.deps.readUiTargetText) observedHex = normalizeKritaColor((await this.deps.readUiTargetText(workspaceId, hexTarget, verification.frame)) ?? "");
    } catch {
      observedHex = undefined;
    }
    if (observedHex !== normalized) {
      markKritaStateUnknown(workspaceId, ["foregroundColor"], "color-dialog-hex-verification-failed");
      return {
        requestedColor: normalized,
        observedColor: observedHex,
        confidence: "unknown",
        target,
        dialog: dialog.state,
        input: { click, fieldClick, select, type },
        recoveryRequired: true,
        note: "The color field did not exactly match the requested value; the dialog was left open for explicit recovery.",
      };
    }
    const confirm = await this.clickDialogSubtarget(workspaceId, dialog.window, dialog.state, confirmTarget, options);
    let dialogClosed = false;
    try {
      const after = await this.deps.getWindowInfo("Krita");
      dialogClosed = !resolveKritaDialogState(after).present;
    } catch {
      dialogClosed = false;
    }
    if (dialogClosed) {
      updateKritaExpectedState(workspaceId, { foregroundColor: normalized }, { confidence: "visually_verified", source: "color-dialog-hex-confirmation" });
    } else {
      markKritaStateUnknown(workspaceId, ["foregroundColor"], "color-dialog-close-unverified");
    }
    return {
      requestedColor: normalized,
      observedColor: observedHex,
      confidence: dialogClosed ? "visually_verified" : "unknown",
      target,
      dialog: dialog.state,
      input: { click, fieldClick, select, type, confirm },
      dialogClosed,
      recoveryRequired: !dialogClosed,
      note: dialogClosed
        ? "The exact hex field matched and the verified owned color dialog closed after confirmation."
        : "The exact hex field matched, but dialog closure was not verified; color state remains unknown.",
    };
  }

  async sampleColorAtPoint(workspaceId: string, point: KritaNormalizedPoint): Promise<Record<string, unknown>> {
    const frame = await this.captureCanvas(workspaceId, { maxWidth: 1600, quality: 95 });
    if (frame.mimeType !== "image/png") throw new Error("Krita color sampling requires a PNG canvas capture.");
    const image = decodePngRgba(frame.buffer);
    const x = Math.min(image.width - 1, Math.max(0, Math.round(point.x * (image.width - 1))));
    const y = Math.min(image.height - 1, Math.max(0, Math.round(point.y * (image.height - 1))));
    const offset = (y * image.width + x) * 4;
    const color = `#${[image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]].map((channel) => channel!.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    return { point, color, confidence: "visually_verified", source: "calibrated-canvas-pixel", note: "This is the visible canvas pixel, not an inferred desktop or plugin state." };
  }

  async swapForegroundBackground(workspaceId: string, options: KritaInputOptions = {}) {
    const result = await this.command(workspaceId, "swap_foreground_background", options);
    markKritaStateUnknown(workspaceId, ["foregroundColor"], "shortcut:swap_foreground_background");
    return result;
  }

  async resetForegroundBackground(workspaceId: string, options: KritaInputOptions = {}) {
    const result = await this.command(workspaceId, "reset_foreground_background", options);
    markKritaStateUnknown(workspaceId, ["foregroundColor"], "shortcut:reset_foreground_background");
    return result;
  }

  listApprovedBrushes() {
    return listKritaApprovedBrushes();
  }

  async setBrush(workspaceId: string, brushPreset: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    const presetName = normalizeExactUiName(brushPreset, "brush preset");
    const target = requireVerifiedControlTarget(await this.ensureUiTarget(workspaceId, "brush-presets"), "brush-presets");
    const window = await this.deps.getWindowInfo("Krita");
    if (!this.deps.queryUiTargetElements) {
      return {
        requestedPreset: presetName,
        target,
        confidence: "unknown",
        selectionVerified: false,
        recoveryRequired: true,
        reason: "Preset identity requires bounded UI Automation with exact visible-name and selected-state verification; blind icon or fuzzy search is not permitted.",
      };
    }

    let elements: KritaUiAutomationElement[] | undefined;
    try {
      const frame = await this.captureUiRegion(workspaceId, "brush_presets_docker", { targetId: target.id, maxWidth: 1200, quality: 90 });
      elements = await this.deps.queryUiTargetElements(target, frame);
    } catch {
      elements = undefined;
    }
    const matches = exactVisibleUiMatches(elements, presetName, (element) => /ListItem|Button|Custom/i.test(element.controlType));
    if (matches.length !== 1) {
      return {
        requestedPreset: presetName,
        target,
        confidence: "unknown",
        selectionVerified: false,
        recoveryRequired: true,
        reason: matches.length === 0
          ? "No exact visible preset name was found in the verified Brush Presets target."
          : "Multiple exact visible preset names were found; refusing ambiguous selection.",
      };
    }

    const item = matches[0]!;
    const itemRect = absoluteElementToWindowRect(item, window);
    if (!itemRect || !rectInsideRect(itemRect, target.windowRegion)) {
      return {
        requestedPreset: presetName,
        target,
        confidence: "unknown",
        selectionVerified: false,
        recoveryRequired: true,
        reason: "Exact preset item geometry did not fit entirely inside the verified Brush Presets target.",
      };
    }
    const itemTarget = uiAutomationElementTarget("preset-name", "preset_name", itemRect, window);
    const click = await this.clickUiTarget(workspaceId, window, itemTarget, options);

    let observedPreset: string | undefined;
    let selectionVerified = false;
    try {
      const afterFrame = await this.captureUiRegion(workspaceId, "brush_presets_docker", { targetId: target.id, maxWidth: 1200, quality: 90 });
      const afterElements = await this.deps.queryUiTargetElements(target, afterFrame);
      const exact = exactVisibleUiMatches(afterElements, presetName, (element) => /ListItem|Button|Custom/i.test(element.controlType));
      selectionVerified = exact.length === 1 && exact[0]!.selected === true;
      if (selectionVerified) observedPreset = presetName;
    } catch {
      observedPreset = undefined;
      selectionVerified = false;
    }

    const confidence = selectionVerified ? "visually_verified" : "unknown";
    if (selectionVerified) {
      updateKritaExpectedState(workspaceId, { brushPreset: presetName }, { confidence: "visually_verified", source: "brush-presets-exact-selected-name" });
    } else {
      markKritaStateUnknown(workspaceId, ["brushPreset"], "brush-presets-selection-verification-failed");
    }
    return {
      requestedPreset: presetName,
      observedPreset,
      selectionVerified,
      confidence,
      target,
      itemTarget,
      input: { click },
      recoveryRequired: !selectionVerified,
      reason: selectionVerified
        ? undefined
        : "The exact preset name was clicked, but UI Automation did not confirm that the item became selected.",
    };
  }

  async setApprovedBrush(workspaceId: string, id: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    const brush = getKritaApprovedBrush(id);
    const result = await this.setBrush(workspaceId, brush.presetName, options);
    return {
      ...result,
      requested: brush,
      approvedBrushId: brush.id,
      requestedPreset: brush.presetName,
    };
  }

  async calibrate(workspaceId: string, canvasWindowRegion: KritaCanvasRegion): Promise<KritaCanvasCalibration> {
    return (this.deps.calibrateCanvas ?? calibrateKritaCanvas)(workspaceId, canvasWindowRegion, "Krita");
  }

  /**
   * Detect and verify a canvas from a full Krita-window capture. This never
   * reads the desktop behind Krita and never sends input to the application.
   */
  async autoCalibrate(workspaceId: string): Promise<Record<string, unknown>> {
    const window = await this.deps.getWindowInfo("Krita");
    const frame = await this.deps.captureFrame({
      target: "app-window",
      windowTitle: window.title,
      processName: window.processName || KRITA_PROCESS_NAME,
      windowHandle: window.windowHandle,
      maxWidth: 3840,
      format: "png",
    });
    if (frame.mimeType !== "image/png" || frame.format !== "png") {
      throw new Error("Automatic Krita canvas calibration requires a PNG window capture.");
    }
    const image = decodePngRgba(frame.buffer);
    if (image.width !== frame.width || image.height !== frame.height) {
      throw new Error("Automatic Krita canvas calibration received inconsistent capture dimensions.");
    }
    const detection = detectKritaCanvasRegion(image);
    if (!detection) {
      throw new Error("Automatic Krita canvas detection could not identify a high-confidence rectangle; provide a reviewed canvasWindowRegion manually.");
    }
    const region = scaleKritaRegionToWindow(detection.region, frame.width, frame.height, window.bounds);
    await (this.deps.calibrateCanvas ?? calibrateKritaCanvas)(workspaceId, region, window.title);
    const checkCanvas = this.deps.checkCanvasCalibration ?? checkKritaCalibration;
    const clearCanvas = this.deps.clearCanvasCalibration ?? clearKritaCalibration;
    const verifyCanvas = this.deps.verifyCanvasCalibration ?? markKritaCalibrationVerified;
    const preVerificationCheck = await checkCanvas(workspaceId);
    if (preVerificationCheck.reason !== "unverified") {
      clearCanvas(workspaceId);
      throw new Error(`Automatic Krita canvas calibration became invalid before visual confirmation (${preVerificationCheck.reason ?? "unknown"}).`);
    }
    const verified = verifyCanvas(workspaceId);
    const check = await checkCanvas(workspaceId);
    if (!isVerifiedCalibration(check)) {
      clearCanvas(workspaceId);
      throw new Error(`Automatic Krita canvas calibration could not be revalidated (${check.reason ?? "unknown"}).`);
    }
    return {
      mode: "no-plugin-desktop",
      automatic: true,
      calibration: verified,
      check,
      visualConfirmation: {
        performed: true,
        source: "krita-app-window",
        method: detection.method,
        confidence: detection.confidence,
        capture: { width: frame.width, height: frame.height },
        detectedRegion: detection.region,
      },
      note: "The rectangle was detected from the current Krita window capture, verified against live geometry, and marked locally verified. No canvas input was sent.",
    };
  }

  getCalibration(workspaceId: string): KritaCanvasCalibration | undefined {
    return getKritaCalibration(workspaceId);
  }

  async checkCalibration(workspaceId: string) {
    return (this.deps.checkCanvasCalibration ?? checkKritaCalibration)(workspaceId);
  }

  private async requireCurrentCalibration(workspaceId: string): Promise<KritaCanvasCalibration> {
    const checkCanvas = this.deps.checkCanvasCalibration ?? checkKritaCalibration;
    const current = await checkCanvas(workspaceId);
    if (isVerifiedCalibration(current) && current.calibration) return current.calibration;

    if (current.reason === "geometry-changed"
      || current.reason === "display-changed"
      || current.reason === "display-scale-changed") {
      const recalibrate = this.deps.autoCalibrate ?? ((id: string) => this.autoCalibrate(id));
      await recalibrate(workspaceId);
      const refreshed = await checkCanvas(workspaceId);
      if (isVerifiedCalibration(refreshed) && refreshed.calibration) return refreshed.calibration;
    }

    return (this.deps.requireCalibration ?? requireValidKritaCalibration)(workspaceId);
  }

  clearCalibration(workspaceId: string): { cleared: boolean } {
    return (this.deps.clearCanvasCalibration ?? clearKritaCalibration)(workspaceId);
  }

  verifyCalibration(workspaceId: string): KritaCanvasCalibration {
    return (this.deps.verifyCanvasCalibration ?? markKritaCalibrationVerified)(workspaceId);
  }

  getState(workspaceId: string) {
    return getKritaExpectedState(workspaceId);
  }

  setExpectedState(
    workspaceId: string,
    patch: Partial<Record<KritaTrackedStateField, KritaStateValue>>,
    source = "agent-action",
  ) {
    return updateKritaExpectedState(workspaceId, patch, { confidence: "expected", source });
  }

  markStateUnknown(workspaceId: string, fields: KritaTrackedStateField[], source = "state-uncertain") {
    return markKritaStateUnknown(workspaceId, fields, source);
  }

  verifyState(workspaceId: string, fields: KritaTrackedStateField[], source = "calibrated-ui-review") {
    return markKritaStateVisuallyVerified(workspaceId, fields, source);
  }

  resetState(workspaceId: string) {
    return resetKritaExpectedState(workspaceId);
  }

  getShortcuts(workspaceId: string) {
    return getKritaShortcutProfile(workspaceId);
  }

  getRecommendedShortcuts() {
    return getKritaRecommendedShortcuts();
  }

  async prepareShortcuts(workspaceId: string): Promise<KritaShortcutPreparation> {
    let processName = KRITA_PROCESS_NAME;
    try {
      const window = await this.deps.getWindowInfo("Krita");
      processName = window.processName || KRITA_PROCESS_NAME;
    } catch {
      // Offline preparation still reports needs_probe/missing_binding; it does
      // not pretend an unavailable installation is ready.
    }
    const fingerprint = await this.shortcutFingerprint(processName);
    return prepareKritaShortcuts(workspaceId, fingerprint);
  }

  setShortcut(workspaceId: string, command: KritaShortcutCommand, keys: string[]) {
    return setKritaShortcutBinding(workspaceId, command, keys);
  }

  resetShortcut(workspaceId: string, command: KritaShortcutCommand) {
    return resetKritaShortcutBinding(workspaceId, command);
  }

  validateShortcuts(workspaceId: string, commands: KritaShortcutCommand[], probeIds: string[] = []) {
    if (probeIds.length > 0) return confirmKritaShortcutProbes(workspaceId, probeIds);
    return markKritaShortcutsValidated(workspaceId, commands);
  }

  async probeShortcut(
    workspaceId: string,
    command: KritaShortcutCommand,
    options: { confirmReversible: boolean } & KritaInputOptions,
  ): Promise<{ probe: ReturnType<typeof recordKritaShortcutProbe>; result: Record<string, unknown> }> {
    if (options.confirmReversible !== true) {
      throw new Error("A bounded shortcut probe requires confirmReversible=true; inspect the resulting Krita UI before confirmation.");
    }
    const binding = resolveKritaShortcut(workspaceId, command, { requireValidated: false });
    const window = await this.deps.getWindowInfo("Krita");
    const fingerprint = await this.shortcutFingerprint(window.processName || KRITA_PROCESS_NAME);
    if (this.requiresLayerTargetFocus(command)) await this.refreshActiveLayerTarget(workspaceId);
    const result = this.requiresLayerTargetFocus(command) && this.deps.mouseClickAndKeyPress
      ? await this.clickTargetAndKeyPress(
        workspaceId,
        window,
        await this.ensureUiTarget(workspaceId, "active-layer-name"),
        binding.keys,
        options,
      )
      : this.requiresLayerTargetFocus(command)
        ? await (async () => {
          await this.focusActiveLayerTarget(workspaceId, options);
          return this.deps.keyPress(workspaceId, binding.keys, window.title, window.windowHandle, window.processName, {
            focusPolicy: options.focusPolicy,
          });
        })()
        : await this.deps.keyPress(workspaceId, binding.keys, window.title, window.windowHandle, window.processName, {
          focusPolicy: options.focusPolicy,
        });
    const probe = recordKritaShortcutProbe(workspaceId, command, binding.keys, window.title, window.windowHandle, fingerprint);
    return {
      probe,
      result,
    };
  }

  private async shortcutFingerprint(processName: string): Promise<string> {
    if (this.deps.getShortcutFingerprint) return this.deps.getShortcutFingerprint(processName);
    return createKritaInstallationFingerprint();
  }

  private async clickUiTarget(
    workspaceId: string,
    window: KritaWindowInfo,
    target: KritaUiTarget,
    options: KritaInputOptions,
  ) {
    return this.clickTargetInWindow(workspaceId, window.displayId, window.title, window.windowHandle, window.processName || KRITA_PROCESS_NAME, window.bounds, target, options);
  }

  private async clickDialogSubtarget(
    workspaceId: string,
    window: KritaWindowInfo,
    state: KritaDialogState,
    target: KritaDialogSubtarget,
    options: KritaInputOptions,
  ) {
    if (!state.handle || !state.title || !state.bounds) throw new Error("Krita dialog state became unavailable before target input.");
    return this.clickTargetInWindow(workspaceId, window.displayId, state.title, state.handle, target.processName, state.bounds, target, options);
  }

  private async clickTargetInWindow(
    workspaceId: string,
    displayId: string,
    title: string,
    windowHandle: string,
    processName: string,
    bounds: { x: number; y: number; width: number; height: number },
    target: KritaUiTarget,
    options: KritaInputOptions,
  ) {
    const displays = await (this.deps.listDisplays ?? listDesktopDisplays)();
    const display = displays.find((candidate) => candidate.id === displayId);
    if (!display) throw new Error(`Display ${displayId} for Krita UI target was not found.`);
    if (target.windowRegion.x < 0 || target.windowRegion.y < 0
      || target.windowRegion.x + target.windowRegion.width > bounds.width
      || target.windowRegion.y + target.windowRegion.height > bounds.height) {
      throw new Error("Verified Krita UI target no longer fits inside its owned window.");
    }
    const screenX = bounds.x + target.windowRegion.x + Math.floor(target.windowRegion.width / 2);
    const screenY = bounds.y + target.windowRegion.y + Math.floor(target.windowRegion.height / 2);
    const displayX = screenX - display.x;
    const displayY = screenY - display.y;
    if (displayX < 0 || displayY < 0 || displayX >= display.width || displayY >= display.height) {
      throw new Error("Verified Krita UI target center is outside the current display bounds.");
    }
    return this.deps.mouseClick(workspaceId, {
      displayId: display.id,
      x: displayX,
      y: displayY,
      windowTitle: title,
      windowHandle,
      processName,
      focusPolicy: options.focusPolicy,
    });
  }

  private async clickTargetAndKeyPress(
    workspaceId: string,
    window: KritaWindowInfo,
    target: KritaUiTarget | undefined,
    keys: string[],
    options: KritaInputOptions,
  ) {
    if (!target) throw new Error("The verified Krita UI target became unavailable before shortcut input.");
    if (!this.deps.mouseClickAndKeyPress) throw new Error("Atomic target shortcut input is unavailable.");
    const displays = await (this.deps.listDisplays ?? listDesktopDisplays)();
    const display = displays.find((candidate) => candidate.id === window.displayId);
    if (!display) throw new Error(`Display ${window.displayId} for Krita UI target was not found.`);
    if (target.windowRegion.x < 0 || target.windowRegion.y < 0
      || target.windowRegion.x + target.windowRegion.width > window.bounds.width
      || target.windowRegion.y + target.windowRegion.height > window.bounds.height) {
      throw new Error("Verified Krita UI target no longer fits inside its owned window.");
    }
    const screenX = window.bounds.x + target.windowRegion.x + Math.floor(target.windowRegion.width / 2);
    const screenY = window.bounds.y + target.windowRegion.y + Math.floor(target.windowRegion.height / 2);
    const displayX = screenX - display.x;
    const displayY = screenY - display.y;
    if (displayX < 0 || displayY < 0 || displayX >= display.width || displayY >= display.height) {
      throw new Error("Verified Krita UI target center is outside the current display bounds.");
    }
    return this.deps.mouseClickAndKeyPress(workspaceId, {
      displayId: display.id,
      x: displayX,
      y: displayY,
      windowTitle: window.title,
      windowHandle: window.windowHandle,
      processName: window.processName || KRITA_PROCESS_NAME,
      focusPolicy: options.focusPolicy,
    }, keys, window.title, window.windowHandle, window.processName || KRITA_PROCESS_NAME, {
      focusPolicy: options.focusPolicy,
    });
  }

  private async captureOwnedDialog(workspaceId: string): Promise<{ window: KritaWindowInfo; state: KritaDialogState; frame: DesktopCaptureFrame }> {
    void workspaceId;
    const window = await this.deps.getWindowInfo("Krita");
    const state = resolveKritaDialogState(window);
    if (!state.present || !state.handle || !state.title || !state.bounds) {
      throw new Error(state.confidence === "unknown"
        ? "Krita dialog ownership is unavailable; refusing popup inspection."
        : "No visible Krita-owned dialog is open.");
    }
    const frame = await this.deps.captureFrame({
      target: "app-window",
      windowTitle: state.title,
      processName: window.processName || KRITA_PROCESS_NAME,
      windowHandle: state.handle,
      maxWidth: 1200,
      quality: 90,
      format: "png",
    });
    return { window, state, frame };
  }

  private async discoverDialogSubtargets(
    workspaceId: string,
    window: KritaWindowInfo,
    state: KritaDialogState,
  ): Promise<KritaDialogSubtarget[]> {
    if (!state.present || !state.handle || !state.bounds || !state.kind || !state.ownerHandle) return [];
    refreshKritaDialogSubtargets(workspaceId, window, state);
    const popup = (window.ownedPopups ?? []).find((candidate) => candidate.handle === state.handle);
    if (!popup) return [];
    const frame = await this.deps.captureFrame({
      target: "app-window",
      windowTitle: state.title,
      processName: popup.processName || window.processName || KRITA_PROCESS_NAME,
      windowHandle: state.handle,
      maxWidth: 1200,
      quality: 90,
      format: "png",
    });
    const rootTarget: KritaUiTarget = {
      id: "dialog-root",
      region: "dialog",
      windowHandle: state.handle,
      processId: popup.processId,
      processName: popup.processName,
      windowDimensions: { width: state.bounds.width, height: state.bounds.height },
      displayScale: window.displayScale,
      windowRegion: { x: 0, y: 0, width: state.bounds.width, height: state.bounds.height },
      confidence: 0.99,
      verifiedAt: new Date().toISOString(),
      fingerprint: "dialog-root",
      source: "visual-confirmation",
    };
    const elements = await (this.deps.queryUiTargetElements ?? queryKritaUiTargetElements)(rootTarget, frame);
    if (!elements) return [];
    return discoverKritaDialogSubtargets(workspaceId, window, state, frame, elements);
  }

  private async ensureUiTarget(workspaceId: string, id: string): Promise<KritaUiTarget | undefined> {
    const existing = getKritaUiTarget(workspaceId, id);
    if (existing) return existing;
    try { await this.discoverUiTargets(workspaceId); } catch { /* retain fail-closed undefined state */ }
    return getKritaUiTarget(workspaceId, id);
  }

  /**
   * The active layer row is content-relative: selecting or reordering a layer
   * changes its y-coordinate without changing the Krita window geometry. Never
   * reuse that row blindly; clear it and rediscover it from the current
   * target-only window image before context-sensitive input.
   */
  private async refreshActiveLayerTarget(workspaceId: string): Promise<KritaUiTarget | undefined> {
    if (this.deps.refreshUiTargets) {
      await this.deps.refreshUiTargets(workspaceId);
    } else {
      clearKritaUiTarget(workspaceId, "active-layer-name");
      await this.discoverUiTargets(workspaceId);
    }
    return getKritaUiTarget(workspaceId, "active-layer-name");
  }

  /**
   * Layer-row shortcuts are context-sensitive in Krita. Focus only the
   * verified active-layer target before sending the key so canvas focus cannot
   * swallow navigation, visibility, lock, or reorder commands.
   */
  private async runLayerShortcut(
    workspaceId: string,
    command: Extract<KritaShortcutCommand, "move_layer_up" | "move_layer_down" | "toggle_layer_visibility" | "toggle_layer_lock" | "select_previous_layer" | "select_next_layer">,
    options: KritaInputOptions = {},
  ) {
    return this.command(workspaceId, command, { ...options, focusTargetId: "active-layer-name" });
  }

  private async focusActiveLayerTarget(workspaceId: string, options: KritaInputOptions): Promise<void> {
    const target = await this.ensureUiTarget(workspaceId, "active-layer-name");
    if (!target) throw new Error("Layer shortcut requires a verified active-layer-name UI target.");
    const window = await this.deps.getWindowInfo("Krita");
    await this.clickUiTarget(workspaceId, window, target, options);
  }

  private requiresLayerTargetFocus(command: KritaShortcutCommand): boolean {
    return command === "rename_layer"
      || command === "move_layer_up"
      || command === "move_layer_down"
      || command === "toggle_layer_visibility"
      || command === "toggle_layer_lock"
      || command === "select_previous_layer"
      || command === "select_next_layer";
  }

  unvalidateShortcuts(workspaceId: string, commands: KritaShortcutCommand[]) {
    return markKritaShortcutsUnvalidated(workspaceId, commands);
  }

  listActions(workspaceId?: string, calibrationValid?: boolean): KritaActionDefinition[] {
    const targets = workspaceId ? listKritaUiTargets(workspaceId) : [];
    return listKritaActions(workspaceId
      ? {
        shortcutProfile: getKritaShortcutProfile(workspaceId),
        calibrationValid,
        uiTargetIds: targets.map((target) => target.id),
        uiTargetRegions: targets.map((target) => target.region),
      }
      : undefined);
  }

  searchActions(query: string, workspaceId?: string, calibrationValid?: boolean): KritaActionDefinition[] {
    const targets = workspaceId ? listKritaUiTargets(workspaceId) : [];
    return searchKritaActions(query, workspaceId
      ? {
        shortcutProfile: getKritaShortcutProfile(workspaceId),
        calibrationValid,
        uiTargetIds: targets.map((target) => target.id),
        uiTargetRegions: targets.map((target) => target.region),
      }
      : undefined);
  }

  async triggerAction(workspaceId: string, actionId: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    const calibration = await (this.deps.checkCanvasCalibration ?? checkKritaCalibration)(workspaceId);
    const action = getKritaAction(actionId, {
      shortcutProfile: getKritaShortcutProfile(workspaceId),
      calibrationValid: isVerifiedCalibration(calibration),
    });
    if (!action) throw new Error(`Unknown Krita action "${actionId}".`);
    if (!action.supported) {
      throw new Error(`Krita action ${action.id} is unavailable in no-plugin desktop mode: ${action.reason ?? "no safe execution path"}`);
    }
    if (!action.shortcutCommand) {
      throw new Error(`Krita action ${action.id} requires its dedicated parameterized tool rather than krita_trigger_action.`);
    }
    if (!action.ready) {
      throw new Error(`Krita action ${action.id} is not ready: ${action.blockingPreconditions.join(", ")}.`);
    }
    const result = await this.command(workspaceId, action.shortcutCommand, options);
    return {
      action: action.id,
      execution: action.execution,
      shortcutCommand: action.shortcutCommand,
      result,
    };
  }

  async createLayer(workspaceId: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    return this.triggerAction(workspaceId, "create_layer", options);
  }

  async deleteLayer(workspaceId: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    return this.triggerAction(workspaceId, "delete_layer", options);
  }

  async duplicateLayer(workspaceId: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    return this.triggerAction(workspaceId, "duplicate_layer", options);
  }

  async selectLayer(workspaceId: string, layerName: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    return this.selectNamedLayer(workspaceId, layerName, "select_layer", options);
  }

  async setLayer(workspaceId: string, layerName: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    return this.selectNamedLayer(workspaceId, layerName, "set_layer", options);
  }

  private async selectNamedLayer(
    workspaceId: string,
    layerName: string,
    operation: "select_layer" | "set_layer",
    options: KritaInputOptions,
  ): Promise<Record<string, unknown>> {
    const requestedLayer = normalizeExactUiName(layerName, "layer name");
    const target = requireVerifiedControlTarget(await this.ensureUiTarget(workspaceId, "layers-panel"), "layers-panel");
    const window = await this.deps.getWindowInfo("Krita");
    if (!this.deps.queryUiTargetElements) {
      return {
        operation,
        requestedLayer,
        observedLayer: undefined,
        selectionVerified: false,
        confidence: "unknown",
        target,
        recoveryRequired: true,
        reason: "Named-layer selection requires bounded UI Automation with an exact visible row and selected-state verification.",
      };
    }

    let elements: KritaUiAutomationElement[] | undefined;
    try {
      const frame = await this.captureUiRegion(workspaceId, "layers_docker", { targetId: target.id, maxWidth: 1200, quality: 90 });
      elements = await this.deps.queryUiTargetElements(target, frame);
    } catch {
      elements = undefined;
    }
    const matches = exactVisibleUiMatches(elements, requestedLayer, (element) => (
      /TreeItem|ListItem/i.test(element.controlType) || /KisNode|layer|node/i.test(element.className)
    ));
    if (matches.length !== 1) {
      markKritaStateUnknown(workspaceId, ["activeLayerName"], "named-layer-match-unavailable");
      return {
        operation,
        requestedLayer,
        observedLayer: undefined,
        selectionVerified: false,
        confidence: "unknown",
        target,
        recoveryRequired: true,
        reason: matches.length === 0
          ? "No exact visible layer name was found in the verified Layers docker."
          : "Multiple exact visible layer names were found; refusing ambiguous selection.",
      };
    }

    const item = matches[0]!;
    const itemRect = absoluteElementToWindowRect(item, window);
    if (!itemRect || !rectInsideRect(itemRect, target.windowRegion)) {
      markKritaStateUnknown(workspaceId, ["activeLayerName"], "named-layer-geometry-invalid");
      return {
        operation,
        requestedLayer,
        observedLayer: undefined,
        selectionVerified: false,
        confidence: "unknown",
        target,
        recoveryRequired: true,
        reason: "Exact layer row geometry did not fit entirely inside the verified Layers docker.",
      };
    }

    const itemTarget = uiAutomationElementTarget("layer-name", "layers_docker", itemRect, window);
    const click = await this.clickUiTarget(workspaceId, window, itemTarget, options);
    let selectionVerified = false;
    let verificationSource: "uia-selection-item" | "active-layer-highlight" | undefined;
    try {
      const afterFrame = await this.captureUiRegion(workspaceId, "layers_docker", { targetId: target.id, maxWidth: 1200, quality: 90 });
      const afterElements = await this.deps.queryUiTargetElements(target, afterFrame);
      const exact = exactVisibleUiMatches(afterElements, requestedLayer, (element) => (
        /TreeItem|ListItem/i.test(element.controlType) || /KisNode|layer|node/i.test(element.className)
      ));
      if (exact.length === 1 && exact[0]!.selected === true) {
        selectionVerified = true;
        verificationSource = "uia-selection-item";
      }
    } catch {
      selectionVerified = false;
    }
    if (!selectionVerified) {
      try {
        // Krita's Qt layer rows do not consistently expose UIA
        // SelectionItemPattern. Re-discover the visually highlighted active
        // row, then require one exact named TreeItem to overlap that bounded
        // highlight. This proves selection without trusting a missing UIA
        // selected flag or searching outside the Layers docker.
        const activeTarget = await this.refreshActiveLayerTarget(workspaceId);
        if (activeTarget) {
          const activeFrame = await this.captureUiRegion(workspaceId, "layers_docker", { targetId: activeTarget.id, maxWidth: 800, quality: 90 });
          const activeElements = await (this.deps.queryUiTargetElements ?? queryKritaUiTargetElements)(activeTarget, activeFrame);
          const activeMatches = exactVisibleUiMatches(activeElements, requestedLayer, (element) => (
            /TreeItem|ListItem/i.test(element.controlType) || /KisNode|layer|node/i.test(element.className)
          ));
          const activeItemRect = activeMatches.length === 1
            ? absoluteElementToWindowRect(activeMatches[0]!, window)
            : undefined;
          if (activeItemRect && rectanglesOverlap(activeItemRect, activeTarget.windowRegion)) {
            selectionVerified = true;
            verificationSource = "active-layer-highlight";
          }
        }
      } catch {
        selectionVerified = false;
      }
    }

    const observedLayer = selectionVerified ? requestedLayer : undefined;
    const confidence = selectionVerified ? "visually_verified" : "unknown";
    if (selectionVerified) {
      updateKritaExpectedState(workspaceId, { activeLayerName: requestedLayer }, { confidence: "visually_verified", source: `layers-panel-${verificationSource ?? "verified"}` });
    } else {
      markKritaStateUnknown(workspaceId, ["activeLayerName"], "named-layer-selection-verification-failed");
    }
    return {
      operation,
      requestedLayer,
      observedLayer,
      selectionVerified,
      verificationSource,
      confidence,
      target,
      itemTarget,
      input: { click },
      recoveryRequired: !selectionVerified,
      reason: selectionVerified
        ? undefined
        : "The exact layer row was clicked, but neither UIA SelectionItem state nor the refreshed active-layer highlight confirmed selection.",
    };
  }

  async renameActiveLayer(workspaceId: string, name: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    if (typeof name !== "string" || !name.trim() || name.length > 2048 || /[\r\n\0]/.test(name)) throw new Error("Krita layer name is invalid.");
    if (!this.deps.readUiTargetText) throw new Error("Layer rename requires the bounded UI text verifier; refusing unverified mutation.");
    const target = requireVerifiedControlTarget(await this.refreshActiveLayerTarget(workspaceId), "layers-panel");
    const renameBinding = resolveKritaShortcut(workspaceId, "rename_layer");
    const window = await this.deps.getWindowInfo("Krita");
    const click = await this.clickUiTarget(workspaceId, window, target, options);
    const rename = await this.deps.keyPress(workspaceId, renameBinding.keys, window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    const select = await this.deps.keyPress(workspaceId, ["CTRL", "A"], window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    const type = this.deps.typeText
      ? await this.deps.typeText(workspaceId, name.trim(), window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy })
      : (() => { throw new Error("Layer rename requires the bounded text-input path."); })();
    const confirm = await this.deps.keyPress(workspaceId, ["ENTER"], window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    let observedName: string | undefined;
    let confidence: "visually_verified" | "unknown" = "unknown";
    if (this.deps.readUiTargetText) {
      try {
        const frame = await this.captureUiRegion(workspaceId, "layers_docker", { targetId: target.id, maxWidth: 800, quality: 90 });
        observedName = (await this.deps.readUiTargetText(workspaceId, target, frame))?.trim() || undefined;
      } catch {
        observedName = undefined;
      }
    }
    if (observedName === name.trim()) {
      confidence = "visually_verified";
      updateKritaExpectedState(workspaceId, { activeLayerName: observedName }, { confidence, source: "layers-panel-ui-automation" });
      markKritaStateUnknown(workspaceId, ["modified"], "layer-rename-modification-unverified");
    } else {
      markKritaStateUnknown(workspaceId, ["activeLayerName", "modified"], "layer-rename-verification-failed");
    }
    return {
      requestedName: name.trim(),
      observedName,
      confidence,
      recoveryRequired: confidence !== "visually_verified",
      input: { click, rename, select, type, confirm },
      note: confidence === "visually_verified"
        ? "The active layer name matched the post-rename bounded UI readback."
        : "The layer rename was not claimed as authoritative because the bounded active-layer readback did not match.",
    };
  }

  async moveLayerUp(workspaceId: string, options: KritaInputOptions = {}) { return this.runLayerShortcut(workspaceId, "move_layer_up", options); }
  async moveLayerDown(workspaceId: string, options: KritaInputOptions = {}) { return this.runLayerShortcut(workspaceId, "move_layer_down", options); }
  async toggleLayerVisibility(workspaceId: string, options: KritaInputOptions = {}) { return this.runLayerShortcut(workspaceId, "toggle_layer_visibility", options); }
  async toggleLayerLock(workspaceId: string, options: KritaInputOptions = {}) { return this.runLayerShortcut(workspaceId, "toggle_layer_lock", options); }
  async selectPreviousLayer(workspaceId: string, options: KritaInputOptions = {}) { return this.runLayerShortcut(workspaceId, "select_previous_layer", options); }
  async selectNextLayer(workspaceId: string, options: KritaInputOptions = {}) { return this.runLayerShortcut(workspaceId, "select_next_layer", options); }

  async pickLayerAtPoint(workspaceId: string, point: KritaNormalizedPoint, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    const calibration = await this.requireCurrentCalibration(workspaceId);
    const window = await this.deps.getWindowInfo("Krita");
    const keyDown = this.deps.keyDown ?? desktopKeyDown;
    const keyUp = this.deps.keyUp ?? desktopKeyUp;
    await keyDown(workspaceId, "CTRL", window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    try {
      const click = await this.canvasClick(workspaceId, point, { focusPolicy: options.focusPolicy });
      markKritaStateUnknown(workspaceId, ["activeLayerName"], "layer-pick-unverified");
      return { point, selected: true, activeLayerName: undefined, confidence: "unknown", calibration: calibration.windowHandle, click, recoveryRequired: true };
    } finally {
      await keyUp(workspaceId, "CTRL", window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    }
  }

  async getLayersPanel(workspaceId: string, input: { targetId?: string; maxWidth?: number; quality?: number } = {}) {
    return this.captureUiRegion(workspaceId, "layers_docker", {
      ...input,
      targetId: input.targetId ?? "layers-panel",
    });
  }

  async getActiveLayerVisual(workspaceId: string, input: { targetId?: string; maxWidth?: number; quality?: number } = {}) {
    return this.captureUiRegion(workspaceId, "layers_docker", {
      ...input,
      targetId: input.targetId ?? "active-layer-name",
    });
  }

  async selectAll(workspaceId: string, options: KritaInputOptions = {}) { return this.command(workspaceId, "select_all", options); }
  async invertSelection(workspaceId: string, options: KritaInputOptions = {}) { return this.command(workspaceId, "invert_selection", options); }
  async deselect(workspaceId: string, options: KritaInputOptions = {}) { return this.command(workspaceId, "deselect", options); }

  async transformBegin(workspaceId: string, options: KritaInputOptions = {}) { return this.command(workspaceId, "transform_tool", options); }
  async transformCommit(workspaceId: string, options: KritaInputOptions = {}) {
    const window = await this.deps.getWindowInfo("Krita");
    const result = await this.deps.keyPress(workspaceId, ["ENTER"], window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    markKritaStateUnknown(workspaceId, ["modified", "zoom"], "transform-commit-unverified");
    return { operation: "transform-commit", result, confidence: "unknown", recoveryRequired: true };
  }
  async transformCancel(workspaceId: string, options: KritaInputOptions = {}) {
    const window = await this.deps.getWindowInfo("Krita");
    const result = await this.deps.keyPress(workspaceId, ["ESC"], window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy });
    return { operation: "transform-cancel", result };
  }
  async transformNudge(workspaceId: string, direction: "left" | "right" | "up" | "down", steps: number, options: KritaInputOptions = {}) {
    if (!Number.isInteger(steps) || steps < 1 || steps > 50) throw new Error("Transform nudge steps must be an integer from 1 to 50.");
    const window = await this.deps.getWindowInfo("Krita");
    const results: Array<Record<string, unknown>> = [];
    for (let index = 0; index < steps; index += 1) {
      results.push(await this.deps.keyPress(workspaceId, [direction.toUpperCase()], window.title, window.windowHandle, window.processName, { focusPolicy: options.focusPolicy }));
    }
    markKritaStateUnknown(workspaceId, ["modified"], "transform-nudge-unverified");
    return { operation: "transform-nudge", direction, steps, results, confidence: "unknown", recoveryRequired: true };
  }

  async getViewState(workspaceId: string): Promise<Record<string, unknown>> {
    const statusTarget = await this.ensureUiTarget(workspaceId, "status-bar");
    if (statusTarget && this.deps.readUiTargetText) {
      try {
        const frame = await this.captureUiRegion(workspaceId, "status_bar", { targetId: statusTarget.id, maxWidth: 800, quality: 90 });
        const statusText = await this.deps.readUiTargetText(workspaceId, statusTarget, frame);
        const zoom = parseKritaZoomText(statusText);
        if (zoom !== undefined) {
          updateKritaExpectedState(workspaceId, { zoom }, { confidence: "visually_verified", source: "status-bar-ui-automation" });
        } else {
          markKritaStateUnknown(workspaceId, ["zoom"], "status-bar-zoom-unreadable");
        }
      } catch {
        markKritaStateUnknown(workspaceId, ["zoom"], "status-bar-zoom-readback-failed");
      }
    }
    const state = getKritaExpectedState(workspaceId);
    return {
      zoom: state.fields.zoom.confidence === "visually_verified" ? state.fields.zoom.value : undefined,
      rotation: state.fields.rotation.confidence === "visually_verified" ? state.fields.rotation.value : undefined,
      mirrored: state.fields.mirrored.confidence === "visually_verified" ? state.fields.mirrored.value : undefined,
      confidence: {
        zoom: state.fields.zoom.confidence,
        rotation: state.fields.rotation.confidence,
        mirrored: state.fields.mirrored.confidence,
      },
      source: statusTarget ? "status-bar-ui-automation-or-expected-state" : "expected-state-only",
    };
  }

  async readinessReport(workspaceId: string): Promise<Record<string, unknown>> {
    let windowCapture = false;
    let calibrationValid = false;
    let calibrationReason: string | undefined;
    let calibrationVerifiedAt: string | undefined;
    let targets: KritaUiTarget[] = [];
    try {
      const window = await this.deps.getWindowInfo("Krita");
      windowCapture = true;
      targets = refreshKritaUiTargets(workspaceId, window).active;
      if (targets.length === 0) {
        try {
          await this.discoverUiTargets(workspaceId);
          targets = listKritaUiTargets(workspaceId);
        } catch {
          // Readiness remains conservative when the target-only capture cannot
          // provide unambiguous UI geometry.
        }
      }
    } catch {
      // The report is intentionally bounded and machine-readable while offline.
    }
    try {
      // Read calibration exactly once and derive every readiness decision from
      // that authoritative snapshot. A transient second read could otherwise
      // report drawing as ready while the calibration had just gone stale.
      const calibration = await (this.deps.checkCanvasCalibration ?? checkKritaCalibration)(workspaceId);
      calibrationValid = calibration.valid === true && calibration.calibration?.verifiedAt !== undefined;
      calibrationReason = calibration.reason;
      calibrationVerifiedAt = calibration.calibration?.verifiedAt;
    } catch {
      calibrationValid = false;
      calibrationReason = "unavailable";
    }
    return buildKritaReadinessReport({
      windowCapture,
      canvasCapture: calibrationValid,
      autoCalibration: windowCapture,
      calibrationValid,
      shortcuts: getKritaShortcutProfile(workspaceId),
      state: getKritaExpectedState(workspaceId),
      targets,
      calibrationReason,
      calibrationVerifiedAt,
    });
  }

  async checkpoint(
    workspaceId: string,
    options: { documentPath?: string; approveUnsavedLocation?: boolean } = {},
  ): Promise<KritaCheckpoint> {
    const frame = await this.captureCanvas(workspaceId, { maxWidth: 1600, quality: 90 });
    return createKritaCheckpoint(workspaceId, frame, options);
  }

  listCheckpoints(workspaceId: string) {
    return listKritaCheckpoints(workspaceId);
  }

  async captureCheckpointImage(workspaceId: string, checkpointId: string): Promise<Buffer> {
    return getKritaCheckpointBuffer(workspaceId, checkpointId);
  }

  async compareCanvas(workspaceId: string, checkpointId: string): Promise<KritaCanvasComparison> {
    const current = await this.captureCanvas(workspaceId, { maxWidth: 1600, quality: 90 });
    return compareKritaCanvasPng(getKritaCheckpointBuffer(workspaceId, checkpointId), current.buffer);
  }

  async restoreCheckpoint(workspaceId: string, checkpointId: string, options: { approveOverwrite?: boolean } = {}): Promise<Record<string, unknown>> {
    const checkpoint = getKritaCheckpoint(workspaceId, checkpointId);
    void options;
    return {
      checkpoint,
      restored: false,
      recoveryRequired: true,
      reason: "No-plugin desktop mode cannot replace a live document from a PNG preview. Use a verified Save As/file-dialog workflow before restoring a checkpoint.",
    };
  }

  async saveDocument(workspaceId: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    const before = await this.getDialogState(workspaceId);
    if (before.present) return { recoveryState: "save_dialog_open", dialog: before, saved: false };
    const result = await this.command(workspaceId, "save", options);
    let after: KritaDialogState = { present: false, confidence: "unknown", capturedAt: new Date().toISOString() };
    try { after = await this.getDialogState(workspaceId); } catch { /* preserve an explicit unknown state */ }
    return {
      saved: false,
      recoveryState: after.present ? "save_dialog_open" : "save_requested_unverified",
      result,
      dialog: after,
      note: "Ctrl+S was sent only to the verified Krita window; success requires a follow-up visual/document-state check.",
    };
  }

  async saveAs(
    workspaceId: string,
    path: string,
    overwritePolicy: "allow" | "deny" = "deny",
    options: KritaInputOptions = {},
  ): Promise<Record<string, unknown>> {
    const safePath = normalizeKritaFilePath(path);
    const before = await this.getDialogState(workspaceId);
    if (before.present) return { recoveryState: "dialog_already_open", dialog: before, saved: false, requestedPath: safePath };
    const result = await this.command(workspaceId, "save_as", options);
    let dialog: KritaDialogState = { present: false, confidence: "unknown", capturedAt: new Date().toISOString() };
    try { dialog = await this.getDialogState(workspaceId); } catch { /* explicit unknown */ }
    return { requestedPath: safePath, overwritePolicy, result, dialog, saved: false, recoveryState: dialog.present ? "save_as_dialog_open" : "save_as_requested_unverified", recoveryRequired: true };
  }

  async exportTo(
    workspaceId: string,
    path: string,
    format: string,
    overwritePolicy: "allow" | "deny" = "deny",
    options: KritaInputOptions = {},
  ): Promise<Record<string, unknown>> {
    const safePath = normalizeKritaFilePath(path);
    const normalizedFormat = format.trim().toLowerCase();
    if (!/^[a-z0-9]{1,16}$/.test(normalizedFormat)) throw new Error("Krita export format must be 1-16 alphanumeric characters.");
    const before = await this.getDialogState(workspaceId);
    if (before.present) return { recoveryState: "dialog_already_open", dialog: before, exported: false, requestedPath: safePath, format: normalizedFormat };
    const result = await this.command(workspaceId, "export", options);
    let dialog: KritaDialogState = { present: false, confidence: "unknown", capturedAt: new Date().toISOString() };
    try { dialog = await this.getDialogState(workspaceId); } catch { /* explicit unknown */ }
    return { requestedPath: safePath, format: normalizedFormat, overwritePolicy, result, dialog, exported: false, recoveryState: dialog.present ? "export_dialog_open" : "export_requested_unverified", recoveryRequired: true };
  }

  async executeTransaction(workspaceId: string, request: KritaTransactionRequest): Promise<KritaTransactionResult> {
    const transaction = validateKritaTransactionRequest(request);
    const completedSteps: KritaTransactionResult["completedSteps"] = [];
    const sideEffects: string[] = [];
    const stateChanges: string[] = [];
    const verification: Record<string, unknown> = {};
    let focusPolicy: DesktopFocusPolicy | undefined;
    let failedStep: KritaTransactionResult["failedStep"];
    for (const step of transaction.steps) {
      try {
        switch (step) {
          case "check_window":
            verification.window = await this.deps.getWindowInfo("Krita");
            break;
          case "check_dialogs":
            verification.dialog = await this.getDialogState(workspaceId);
            break;
          case "ensure_calibration_if_needed":
            verification.calibration = await this.requireCurrentCalibration(workspaceId);
            break;
          case "foreground_restore":
            focusPolicy = "foreground-restore";
            break;
          case "execute": {
            if (!transaction.operation) throw new Error("No allowlisted transaction operation was supplied.");
            const options = { focusPolicy };
            switch (transaction.operation) {
              case "capture":
                verification.execution = await this.captureCanvas(workspaceId, { maxWidth: 1600, quality: 90 });
                break;
              case "save":
                verification.execution = await this.saveCommand(workspaceId, options);
                sideEffects.push("document-save-requested");
                break;
              case "undo":
                verification.execution = await this.command(workspaceId, "undo", options);
                sideEffects.push("document-undo-requested");
                break;
              case "redo":
                verification.execution = await this.command(workspaceId, "redo", options);
                sideEffects.push("document-redo-requested");
                break;
              case "create_layer":
                verification.execution = await this.createLayer(workspaceId, options);
                sideEffects.push("layer-created-requested");
                break;
              case "delete_layer":
                verification.execution = await this.deleteLayer(workspaceId, options);
                sideEffects.push("layer-deleted-requested");
                break;
              case "duplicate_layer":
                verification.execution = await this.duplicateLayer(workspaceId, options);
                sideEffects.push("layer-duplicated-requested");
                break;
            }
            break;
          }
          case "capture_result": {
            const frame = await this.captureCanvas(workspaceId, { maxWidth: 1600, quality: 90 });
            verification.capture = { target: frame.target, width: frame.width, height: frame.height, previewHash: `sha256:${createHash("sha256").update(frame.buffer).digest("hex")}`, captureBackend: frame.captureBackend, occlusionSafe: frame.occlusionSafe };
            break;
          }
          case "verify":
            verification.state = this.getState(workspaceId);
            verification.dialog = await this.getDialogState(workspaceId);
            stateChanges.push("verification-completed-with-confidence-metadata");
            break;
        }
        completedSteps.push(step);
      } catch (error) {
        failedStep = step;
        verification.error = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    return {
      goal: transaction.goal,
      operation: transaction.operation,
      completedSteps,
      failedStep,
      sideEffects,
      stateChanges,
      verification: sanitizeTransactionVerification(verification),
      recoveryRequired: Boolean(failedStep) || sideEffects.some((effect) => effect.includes("requested")),
    };
  }

  private async saveCommand(workspaceId: string, options: KritaInputOptions) {
    return this.command(workspaceId, "save", options);
  }

  async exportDocument(workspaceId: string, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    return this.triggerAction(workspaceId, "export", options);
  }

  async fill(workspaceId: string, point: KritaNormalizedPoint, options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    const tool = await this.triggerAction(workspaceId, "fill_tool", options);
    const click = await this.canvasClick(workspaceId, point, options);
    return { operation: "fill", point, tool, click };
  }

  async select(
    workspaceId: string,
    shape: "rectangle" | "ellipse",
    start: KritaNormalizedPoint,
    end: KritaNormalizedPoint,
    options: KritaInputOptions = {},
  ): Promise<Record<string, unknown>> {
    const actionId = shape === "ellipse" ? "select_ellipse" : "select_rect";
    const tool = await this.triggerAction(workspaceId, actionId, options);
    const drag = await this.stroke(workspaceId, start, end, options);
    return { operation: "select", shape, start, end, tool, drag };
  }

  async batch(workspaceId: string, operations: KritaBatchOperation[], options: KritaInputOptions = {}): Promise<{
    mode: "no-plugin-desktop";
    completed: number;
    results: Array<Record<string, unknown>>;
  }> {
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 16) {
      throw new Error("Krita batch requires between 1 and 16 operations.");
    }
    const results: Array<Record<string, unknown>> = [];
    for (const operation of operations) {
      if (!operation || typeof operation !== "object") {
        throw new Error("Nested or invalid Krita batch operations are not permitted.");
      }
      switch (operation.type) {
        case "action":
          results.push(await this.triggerAction(workspaceId, operation.actionId, options));
          break;
        case "click":
          results.push(await this.canvasClick(workspaceId, operation.point, {
            button: operation.button,
            clickCount: operation.clickCount,
            focusPolicy: options.focusPolicy,
          }));
          break;
        case "stroke":
          results.push(await this.stroke(workspaceId, operation.start, operation.end, {
            durationMs: operation.durationMs,
            button: operation.button,
            focusPolicy: options.focusPolicy,
          }));
          break;
        case "path":
          results.push(await this.pathStroke(workspaceId, operation.points, { button: operation.button, focusPolicy: options.focusPolicy }));
          break;
        case "fill":
          results.push(await this.fill(workspaceId, operation.point, options));
          break;
        case "select":
          results.push(await this.select(workspaceId, operation.shape, operation.start, operation.end, options));
          break;
        default:
          throw new Error("Unknown Krita batch operation.");
      }
    }
    return { mode: "no-plugin-desktop", completed: results.length, results };
  }

  async command(
    workspaceId: string,
    command: KritaShortcutCommand,
    options: { allowUnvalidated?: boolean } & KritaInputOptions = {},
  ): Promise<Record<string, unknown>> {
    const binding = resolveKritaShortcut(workspaceId, command, {
      requireValidated: !(options.allowUnvalidated ?? false),
    });
    const window = await this.deps.getWindowInfo("Krita");
    let result;
    if (options.focusTargetId) {
      const target = options.focusTargetId === "active-layer-name"
        ? await this.refreshActiveLayerTarget(workspaceId)
        : await this.ensureUiTarget(workspaceId, options.focusTargetId);
      if (!target) throw new Error("The verified Krita UI target became unavailable before shortcut input.");
      if (this.deps.mouseClickAndKeyPress) {
        result = await this.clickTargetAndKeyPress(workspaceId, window, target, binding.keys, options);
      } else {
        await this.clickUiTarget(workspaceId, window, target, options);
        result = await this.deps.keyPress(workspaceId, binding.keys, window.title, window.windowHandle, window.processName, {
          focusPolicy: options.focusPolicy,
        });
      }
    } else {
      result = await this.deps.keyPress(workspaceId, binding.keys, window.title, window.windowHandle, window.processName, {
        focusPolicy: options.focusPolicy,
      });
    }
    this.applyCommandStateEffect(workspaceId, command);
    return {
      command,
      keys: binding.keys,
      bindingSource: binding.source,
      bindingValidated: binding.validated,
      result,
    };
  }

  async captureCanvas(
    workspaceId: string,
    input: { maxWidth?: number; quality?: number; normalizedRegion?: KritaNormalizedRegion } = {},
  ): Promise<DesktopCaptureFrame> {
    const calibration = await this.requireCurrentCalibration(workspaceId);
    const baseRegion = calibration.canvasWindowRegion;
    const region = input.normalizedRegion
      ? cropNormalizedRegion(baseRegion, input.normalizedRegion)
      : baseRegion;
    return this.deps.captureFrame({
      target: "app-window",
      windowTitle: calibration.windowTitle,
      processName: calibration.processName || KRITA_PROCESS_NAME,
      windowHandle: calibration.windowHandle,
      windowRegion: region,
      maxWidth: input.maxWidth ?? 1600,
      format: "png",
      quality: input.quality ?? 80,
    });
  }

  async canvasClick(
    workspaceId: string,
    point: KritaNormalizedPoint,
    options: { button?: "left" | "right" | "middle"; clickCount?: number } & KritaInputOptions = {},
  ): Promise<Record<string, unknown>> {
    const calibration = await this.requireCurrentCalibration(workspaceId);
    const mapped = mapNormalizedCanvasPoint(calibration, point);
    const result = await this.deps.mouseClick(workspaceId, {
      displayId: mapped.displayId,
      x: mapped.displayX,
      y: mapped.displayY,
      windowTitle: calibration.windowTitle,
      windowHandle: calibration.windowHandle,
      processName: calibration.processName || KRITA_PROCESS_NAME,
      button: options.button,
      clickCount: options.clickCount,
      focusPolicy: options.focusPolicy,
    });
    if ((options.button ?? "left") === "left") {
      updateKritaExpectedState(workspaceId, { modified: true }, { confidence: "expected", source: "canvas-click" });
    }
    return { point, mapped, result };
  }

  async stroke(
    workspaceId: string,
    start: KritaNormalizedPoint,
    end: KritaNormalizedPoint,
    options: { durationMs?: number; button?: "left" | "right" | "middle" } & KritaInputOptions = {},
  ): Promise<Record<string, unknown>> {
    const calibration = await this.requireCurrentCalibration(workspaceId);
    const mappedStart = mapNormalizedCanvasPoint(calibration, start);
    const mappedEnd = mapNormalizedCanvasPoint(calibration, end);
    const result = await this.deps.mouseDrag(workspaceId, {
      displayId: calibration.displayId,
      startX: mappedStart.displayX,
      startY: mappedStart.displayY,
      endX: mappedEnd.displayX,
      endY: mappedEnd.displayY,
      button: options.button,
      durationMs: options.durationMs,
      windowTitle: calibration.windowTitle,
      windowHandle: calibration.windowHandle,
      processName: calibration.processName || KRITA_PROCESS_NAME,
      focusPolicy: options.focusPolicy,
    });
    if ((options.button ?? "left") === "left") {
      updateKritaExpectedState(workspaceId, { modified: true }, { confidence: "expected", source: "canvas-stroke" });
    }
    return { start, end, mappedStart, mappedEnd, result };
  }

  async pathStroke(
    workspaceId: string,
    points: KritaPathPoint[],
    options: { button?: "left" | "right" | "middle" } & KritaInputOptions = {},
  ): Promise<Record<string, unknown>> {
    if (!Array.isArray(points) || points.length < 2 || points.length > 512) {
      throw new Error("Krita path stroke requires between 2 and 512 points.");
    }
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
        throw new Error("Krita path points must use normalized coordinates between 0 and 1.");
      }
      if (point.durationMs !== undefined && (!Number.isInteger(point.durationMs) || point.durationMs < 0 || point.durationMs > 10_000)) {
        throw new Error("Krita path point durationMs must be an integer from 0 to 10000.");
      }
    }
    const results: Array<Record<string, unknown>> = [];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      results.push(await this.stroke(workspaceId, previous, current, {
        button: options.button,
        durationMs: current.durationMs,
        focusPolicy: options.focusPolicy,
      }));
    }
    return {
      operation: "path-stroke",
      points,
      segments: results.length,
      button: options.button ?? "left",
      note: "Segments are bounded to the calibrated Krita canvas; each segment is an independent desktop drag.",
      results,
    };
  }

  async pan(workspaceId: string, points: KritaPathPoint[], options: KritaInputOptions = {}): Promise<Record<string, unknown>> {
    return this.pathStroke(workspaceId, points, { button: "middle", focusPolicy: options.focusPolicy });
  }

  private applyCommandStateEffect(workspaceId: string, command: KritaShortcutCommand): void {
    switch (command) {
      case "new_document":
      case "open_document":
        clearKritaCalibration(workspaceId);
        markKritaStateUnknown(workspaceId, [
          "documentName",
          "documentPath",
          "activeLayerName",
          "zoom",
          "rotation",
          "mirrored",
          "modified",
        ], `shortcut:${command}`);
        return;
      case "save":
      case "save_as":
        markKritaStateUnknown(workspaceId, ["documentPath", "modified"], `shortcut:${command}`);
        return;
      case "undo":
      case "redo":
        markKritaStateUnknown(workspaceId, ["modified"], `shortcut:${command}`);
        return;
      case "brush_tool":
        updateKritaExpectedState(workspaceId, { activeTool: "freehand_brush" }, { confidence: "expected", source: `shortcut:${command}` });
        return;
      case "eraser_toggle": {
        const state = getKritaExpectedState(workspaceId);
        const current = state.fields.eraserMode;
        if (typeof current.value === "boolean") {
          updateKritaExpectedState(workspaceId, { eraserMode: !current.value }, { confidence: "expected", source: `shortcut:${command}` });
        } else {
          markKritaStateUnknown(workspaceId, ["eraserMode"], `shortcut:${command}`);
        }
        return;
      }
      case "reset_canvas_rotation":
        updateKritaExpectedState(workspaceId, { rotation: 0 }, { confidence: "expected", source: `shortcut:${command}` });
        return;
      case "swap_foreground_background":
      case "reset_foreground_background":
        markKritaStateUnknown(workspaceId, ["foregroundColor"], `shortcut:${command}`);
        return;
      case "new_layer":
      case "delete_layer":
      case "duplicate_layer":
        markKritaStateUnknown(workspaceId, ["activeLayerName", "modified"], `shortcut:${command}`);
        return;
      case "transform_tool":
        updateKritaExpectedState(workspaceId, { activeTool: "transform" }, { confidence: "expected", source: `shortcut:${command}` });
        return;
      case "fill_tool":
        updateKritaExpectedState(workspaceId, { activeTool: "fill" }, { confidence: "expected", source: `shortcut:${command}` });
        return;
      case "select_rect":
      case "select_ellipse":
        updateKritaExpectedState(workspaceId, { activeTool: "selection" }, { confidence: "expected", source: `shortcut:${command}` });
        return;
      case "zoom_in":
      case "zoom_out":
        markKritaStateUnknown(workspaceId, ["zoom"], `shortcut:${command}`);
        return;
      case "fit_canvas":
        updateKritaExpectedState(workspaceId, { zoom: 1 }, { confidence: "expected", source: `shortcut:${command}` });
        return;
      case "select_all":
      case "invert_selection":
      case "rename_layer":
      case "move_layer_up":
      case "move_layer_down":
      case "toggle_layer_visibility":
      case "toggle_layer_lock":
      case "select_previous_layer":
      case "select_next_layer":
        markKritaStateUnknown(workspaceId, ["activeLayerName", "modified"], `shortcut:${command}`);
        return;
      case "deselect":
        return;
    }
  }
}

function cropNormalizedRegion(base: KritaCanvasRegion, crop: KritaNormalizedRegion): KritaCanvasRegion {
  validateNormalizedRegion(crop);
  const x = base.x + Math.floor(base.width * crop.x);
  const y = base.y + Math.floor(base.height * crop.y);
  const right = base.x + Math.ceil(base.width * (crop.x + crop.width));
  const bottom = base.y + Math.ceil(base.height * (crop.y + crop.height));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function validateNormalizedRegion(region: KritaNormalizedRegion): void {
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) {
    throw new Error("Normalized Krita review region values must be finite.");
  }
  if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) {
    throw new Error("Normalized Krita review region must fit inside the 0..1 canvas rectangle.");
  }
}

function parseBrushSizeText(value: string | undefined): number | undefined {
  // Windows ValuePattern exposes Krita's spin box as a bare numeric string,
  // while the visual label may include the `px` suffix. Keep the exported
  // parser strict and add the unit only for this known spinner readback.
  const parsed = parseKritaBrushSizeText(value)
    ?? (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? parseKritaBrushSizeText(`${value.trim()} px`)
      : undefined);
  return parsed === undefined ? undefined : normalizeKritaBrushSize(parsed);
}

function sanitizeTransactionVerification(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };
  for (const key of ["execution", "capture"]) {
    const candidate = result[key];
    if (!candidate || typeof candidate !== "object" || !("buffer" in candidate)) continue;
    const frame = candidate as Record<string, unknown>;
    result[key] = {
      target: frame.target,
      width: frame.width,
      height: frame.height,
      bounds: frame.bounds,
      captureBackend: frame.captureBackend,
      occlusionSafe: frame.occlusionSafe,
    };
  }
  return result;
}

function normalizeKritaFilePath(value: string): string {
  if (typeof value !== "string") throw new Error("Krita file path must be a string.");
  const normalized = value.trim();
  if (!normalized || normalized.length > 2048 || /[\r\n\0]/.test(normalized)) throw new Error("Krita file path is invalid.");
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(normalized)) throw new Error("Krita file path must be absolute; relative destinations are rejected.");
  return normalized;
}

function isVerifiedCalibration(value: { valid?: unknown; calibration?: { verifiedAt?: unknown } }): boolean {
  return value.valid === true && typeof value.calibration?.verifiedAt === "string" && value.calibration.verifiedAt.length > 0;
}

function normalizeExactUiName(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`Krita ${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 2048 || /[\r\n\0]/.test(normalized)) {
    throw new Error(`Krita ${label} is invalid.`);
  }
  return normalized;
}

function exactVisibleUiMatches(
  elements: readonly KritaUiAutomationElement[] | undefined,
  expected: string,
  predicate: (element: KritaUiAutomationElement) => boolean,
): KritaUiAutomationElement[] {
  const matches = (elements ?? []).filter((element) => !element.offscreen
    && predicate(element)
    && [element.name.trim(), element.value.trim()].some((value) => value === expected));
  if (matches.length < 2 || !matches.every((element) => /TreeItem/i.test(element.controlType))) return matches;

  // Qt can expose one visible layer row as several adjacent TreeItem UIA
  // fragments (for example visibility/thumbnail/name segments) with the same
  // accessible name and vertical bounds. Treat connected fragments on the same
  // physical row as one semantic match, while preserving separate rows with an
  // identical layer name as an ambiguity that must still fail closed.
  const groups: KritaUiAutomationElement[][] = [];
  const remaining = new Set(matches.map((_match, index) => index));
  while (remaining.size > 0) {
    const firstIndex = remaining.values().next().value as number;
    remaining.delete(firstIndex);
    const group = [matches[firstIndex]!];
    const queue = [matches[firstIndex]!];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const index of [...remaining]) {
        const candidate = matches[index]!;
        if (!sameTreeItemRowFragment(current, candidate)) continue;
        remaining.delete(index);
        group.push(candidate);
        queue.push(candidate);
      }
    }
    groups.push(group);
  }
  return groups.map((group) => {
    const representative = [...group].sort((left, right) => rectangleArea(right.bounds) - rectangleArea(left.bounds))[0]!;
    return group.some((element) => element.selected === true)
      ? { ...representative, selected: true }
      : representative;
  });
}

function sameTreeItemRowFragment(left: KritaUiAutomationElement, right: KritaUiAutomationElement): boolean {
  const leftTop = left.bounds.y;
  const leftBottom = left.bounds.y + left.bounds.height;
  const rightTop = right.bounds.y;
  const rightBottom = right.bounds.y + right.bounds.height;
  const verticalOverlap = Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(leftTop, rightTop));
  const minimumHeight = Math.max(1, Math.min(left.bounds.height, right.bounds.height));
  if (verticalOverlap / minimumHeight < 0.8) return false;
  const horizontalGap = Math.max(
    0,
    Math.max(left.bounds.x, right.bounds.x)
      - Math.min(left.bounds.x + left.bounds.width, right.bounds.x + right.bounds.width),
  );
  return horizontalGap <= 2;
}

function rectangleArea(rect: { width: number; height: number }): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function rectInsideRect(
  candidate: { x: number; y: number; width: number; height: number },
  parent: { x: number; y: number; width: number; height: number },
): boolean {
  return candidate.x >= parent.x
    && candidate.y >= parent.y
    && candidate.width > 0
    && candidate.height > 0
    && candidate.x + candidate.width <= parent.x + parent.width
    && candidate.y + candidate.height <= parent.y + parent.height;
}

function uiAutomationElementTarget(
  id: string,
  region: KritaUiRegionName,
  rect: { x: number; y: number; width: number; height: number },
  window: KritaWindowInfo,
): KritaUiTarget {
  return {
    id,
    region,
    windowHandle: window.windowHandle,
    processId: window.processId,
    processName: window.processName,
    windowDimensions: { width: window.bounds.width, height: window.bounds.height },
    displayScale: window.displayScale,
    windowRegion: { ...rect },
    confidence: 0.95,
    verifiedAt: new Date().toISOString(),
    fingerprint: `${id}:${window.windowHandle}:${window.processId}:${rect.x}:${rect.y}:${rect.width}:${rect.height}`,
    source: "visual-confirmation",
  };
}

function absoluteElementToWindowRect(
  element: KritaUiAutomationElement,
  window: KritaWindowInfo,
): { x: number; y: number; width: number; height: number } | undefined {
  const left = Math.max(element.bounds.x, window.bounds.x);
  const top = Math.max(element.bounds.y, window.bounds.y);
  const right = Math.min(element.bounds.x + element.bounds.width, window.bounds.x + window.bounds.width);
  const bottom = Math.min(element.bounds.y + element.bounds.height, window.bounds.y + window.bounds.height);
  if (right <= left || bottom <= top) return undefined;
  const rect = {
    x: Math.round(left - window.bounds.x),
    y: Math.round(top - window.bounds.y),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
  return rect.width > 0 && rect.height > 0 ? rect : undefined;
}

export function scaleKritaRegionToWindow(
  region: KritaCanvasRegion,
  captureWidth: number,
  captureHeight: number,
  windowBounds: { width: number; height: number },
): KritaCanvasRegion {
  if (!Number.isInteger(captureWidth) || !Number.isInteger(captureHeight) || captureWidth < 1 || captureHeight < 1) {
    throw new Error("Automatic Krita canvas calibration received invalid capture bounds.");
  }
  if (!Number.isInteger(windowBounds.width) || !Number.isInteger(windowBounds.height) || windowBounds.width < 1 || windowBounds.height < 1) {
    throw new Error("Automatic Krita canvas calibration received invalid live window bounds.");
  }
  const scaleX = windowBounds.width / captureWidth;
  const scaleY = windowBounds.height / captureHeight;
  const x = Math.round(region.x * scaleX);
  const y = Math.round(region.y * scaleY);
  const right = Math.round((region.x + region.width) * scaleX);
  const bottom = Math.round((region.y + region.height) * scaleY);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}
