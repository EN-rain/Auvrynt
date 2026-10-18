import type { DesktopCaptureFrame } from "../desktop/desktop-capture.js";
import type { DesktopFocusPolicy } from "../desktop/desktop-input.js";
import type { KritaWindowInfo, KritaOwnedPopupInfo } from "./krita-window.js";

export type KritaDialogKind = "open" | "save_as" | "export" | "overwrite" | "unsaved_changes" | "color" | "unknown";

export interface KritaDialogState {
  present: boolean;
  title?: string;
  ownerHandle?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  handle?: string;
  kind?: KritaDialogKind;
  confidence: "verified-owner" | "unknown" | "none";
  capturedAt: string;
}

export interface KritaDialogDependencies {
  getWindowInfo: (windowTitle?: string, windowHandle?: string) => Promise<KritaWindowInfo>;
  captureFrame: (input: {
    target: "app-window";
    windowTitle?: string;
    processName?: string;
    windowHandle?: string;
    maxWidth?: number;
    quality?: number;
    format?: "png";
  }) => Promise<DesktopCaptureFrame>;
  keyPress: (workspaceId: string, keys: string[], windowTitle?: string, windowHandle?: string, processName?: string, options?: { focusPolicy?: DesktopFocusPolicy }) => Promise<Record<string, unknown>>;
}

export function resolveKritaDialogState(window: KritaWindowInfo): KritaDialogState {
  if (window.ownedPopupDiscovery !== "complete") {
    return { present: false, confidence: "unknown", capturedAt: new Date().toISOString() };
  }
  const popup = [...(window.ownedPopups ?? [])]
    .filter((candidate) => candidate.visible && !candidate.minimized)
    .sort((left, right) => right.zOrder - left.zOrder)[0];
  if (!popup) return { present: false, confidence: "none", capturedAt: new Date().toISOString() };
  return dialogFromPopup(popup, window.windowHandle);
}

export async function getKritaDialogState(deps: KritaDialogDependencies): Promise<KritaDialogState> {
  const window = await deps.getWindowInfo("Krita");
  return resolveKritaDialogState(window);
}

export async function captureKritaDialog(
  deps: KritaDialogDependencies,
  workspaceId: string,
): Promise<DesktopCaptureFrame> {
  const window = await deps.getWindowInfo("Krita");
  const state = resolveKritaDialogState(window);
  if (!state.present || !state.handle || !state.title) {
    throw new Error(state.confidence === "unknown"
      ? "Krita dialog ownership is unavailable; refusing to capture an uncertain popup."
      : "No visible Krita-owned dialog is open.");
  }
  void workspaceId;
  return deps.captureFrame({
    target: "app-window",
    windowTitle: state.title,
    processName: window.processName,
    windowHandle: state.handle,
    maxWidth: 1200,
    quality: 90,
    format: "png",
  });
}

export async function sendKritaDialogDecision(
  deps: KritaDialogDependencies,
  workspaceId: string,
  decision: "confirm" | "cancel",
  focusPolicy?: DesktopFocusPolicy,
): Promise<Record<string, unknown>> {
  const window = await deps.getWindowInfo("Krita");
  const state = resolveKritaDialogState(window);
  if (!state.present || !state.handle || !state.title) {
    throw new Error(state.confidence === "unknown"
      ? "Krita dialog ownership is unavailable; refusing dialog input."
      : "No visible Krita-owned dialog is open.");
  }
  const result = await deps.keyPress(
    workspaceId,
    decision === "confirm" ? ["ENTER"] : ["ESC"],
    state.title,
    state.handle,
    window.processName,
    { focusPolicy },
  );
  return {
    decision,
    dialog: state,
    result,
    recoveryState: decision === "confirm" ? "dialog_confirmed_unverified" : "dialog_cancelled",
    note: "The dialog key was sent only to a verified Krita-owned popup; callers must inspect the resulting state before claiming completion.",
  };
}

export function classifyKritaDialogTitle(title: string): KritaDialogKind {
  const value = title.toLocaleLowerCase();
  if (/save\s*as|save document/.test(value)) return "save_as";
  if (/export/.test(value)) return "export";
  if (/open|select file|choose file/.test(value)) return "open";
  if (/overwrite|already exists|replace/.test(value)) return "overwrite";
  if (/unsaved|save changes|modified/.test(value)) return "unsaved_changes";
  if (/color|colour|foreground/.test(value)) return "color";
  return "unknown";
}

function dialogFromPopup(popup: KritaOwnedPopupInfo, ownerHandle: string): KritaDialogState {
  const owned = popup.ownerHandle === ownerHandle || popup.rootOwnerHandle === ownerHandle;
  if (!owned) return { present: false, confidence: "unknown", capturedAt: new Date().toISOString() };
  return {
    present: true,
    title: popup.title,
    ownerHandle,
    handle: popup.handle,
    bounds: { ...popup.bounds },
    kind: classifyKritaDialogTitle(popup.title),
    confidence: "verified-owner",
    capturedAt: new Date().toISOString(),
  };
}

