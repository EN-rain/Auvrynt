import { createHash } from "node:crypto";
import type { DesktopCaptureFrame } from "../desktop/desktop-capture.js";
import type { KritaDialogKind, KritaDialogState } from "./krita-dialogs.js";
import type { KritaUiAutomationElement } from "./krita-ui-text.js";
import type { KritaUiRect, KritaUiTarget } from "./krita-ui-targets.js";
import type { KritaWindowInfo } from "./krita-window.js";

export type KritaDialogSubtargetId =
  | "dialog-filename"
  | "dialog-path"
  | "dialog-confirm"
  | "dialog-cancel"
  | "dialog-format"
  | "dialog-overwrite-confirm"
  | "color-hex-field"
  | "color-confirm-button";

export interface KritaDialogSubtarget extends KritaUiTarget {
  id: KritaDialogSubtargetId;
  dialogHandle: string;
  ownerWindowHandle: string;
  dialogKind: KritaDialogKind;
  dialogFingerprint: string;
}

const dialogTargetsByWorkspace = new Map<string, Map<string, KritaDialogSubtarget>>();

/**
 * Turn one bounded UI Automation snapshot into conservative popup controls.
 * Ambiguous controls are omitted instead of assigning a potentially unsafe
 * rectangle. The caller is responsible for capturing only the verified owned
 * popup before invoking this function.
 */
export function discoverKritaDialogSubtargets(
  workspaceId: string,
  window: KritaWindowInfo,
  state: KritaDialogState,
  frame: DesktopCaptureFrame,
  elements: readonly KritaUiAutomationElement[],
): KritaDialogSubtarget[] {
  validateWorkspaceId(workspaceId);
  if (!state.present || !state.handle || !state.ownerHandle || !state.bounds || !state.kind) return [];
  if (state.ownerHandle !== window.windowHandle || frame.windowHandle !== state.handle) return [];
  const popup = (window.ownedPopups ?? []).find((candidate) => candidate.handle === state.handle);
  if (!popup || popup.ownerHandle !== window.windowHandle && popup.rootOwnerHandle !== window.windowHandle) return [];
  if (popup.bounds.width !== state.bounds.width || popup.bounds.height !== state.bounds.height) return [];
  const dialogHandle = state.handle;
  const dialogKind = state.kind;
  const dialogBounds = state.bounds;
  const candidates = elements.filter((element) => !element.offscreen && element.bounds.width > 0 && element.bounds.height > 0);
  const targets: KritaDialogSubtarget[] = [];
  const addUnique = (id: KritaDialogSubtargetId, element: KritaUiAutomationElement): void => {
    if (targets.some((target) => target.id === id)) return;
    const rect = toPopupRelativeRect(element.bounds, dialogBounds);
    if (!rect) return;
    targets.push({
      id,
      region: regionForDialogTarget(id),
      windowHandle: dialogHandle,
      processId: popup.processId,
      processName: popup.processName,
      windowDimensions: { width: dialogBounds.width, height: dialogBounds.height },
      displayScale: window.displayScale,
      windowRegion: rect,
      confidence: 0.92,
      verifiedAt: new Date().toISOString(),
      fingerprint: createHash("sha256").update(JSON.stringify({
        ownerWindowHandle: window.windowHandle,
        dialogHandle,
        dialogKind,
        popupBounds: dialogBounds,
        displayScale: window.displayScale,
        id,
        rect,
      })).digest("hex"),
      source: "visual-confirmation",
      dialogHandle,
      ownerWindowHandle: window.windowHandle,
      dialogKind,
      dialogFingerprint: createDialogFingerprint(window, state),
    });
  };

  const edits = candidates.filter((element) => isEdit(element));
  const namedFilename = edits.filter((element) => hasSemantic(element, /file\s*name|filename|document\s*name|(?:^|\s)name(?:\s|$)/i));
  const namedPath = edits.filter((element) => hasSemantic(element, /path|folder|directory|location/i));
  if (state.kind === "color") {
    const hex = edits.filter((element) => /^#?[0-9a-f]{6,8}$/i.test(textOf(element)) || hasSemantic(element, /hex|html|color|colour/i));
    if (hex.length === 1) addUnique("color-hex-field", hex[0]!);
  } else {
    if (namedFilename.length === 1) addUnique("dialog-filename", namedFilename[0]!);
    else if (namedFilename.length === 0 && edits.length === 1) addUnique("dialog-filename", edits[0]!);
    if (namedPath.length === 1) addUnique("dialog-path", namedPath[0]!);
  }

  const buttons = candidates.filter(isButton);
  const confirm = buttons.filter((element) => /^(ok|open|save|export|confirm|yes|apply|replace|overwrite)$/i.test(textOf(element)));
  const cancel = buttons.filter((element) => /^(cancel|close|no|abort)$/i.test(textOf(element)));
  if (confirm.length === 1) {
    addUnique(state.kind === "overwrite" ? "dialog-overwrite-confirm" : "dialog-confirm", confirm[0]!);
    if (state.kind === "color") addUnique("color-confirm-button", confirm[0]!);
  }
  if (cancel.length === 1) addUnique("dialog-cancel", cancel[0]!);
  const formats = candidates.filter((element) => /ComboBox|List/i.test(element.controlType) || hasSemantic(element, /format|type/i));
  if (formats.length === 1) addUnique("dialog-format", formats[0]!);

  const targetsById = dialogTargetsByWorkspace.get(workspaceId) ?? new Map<string, KritaDialogSubtarget>();
  for (const target of targets) targetsById.set(target.id, target);
  dialogTargetsByWorkspace.set(workspaceId, targetsById);
  return targets.map(cloneTarget);
}

export function getKritaDialogSubtarget(workspaceId: string, id: KritaDialogSubtargetId): KritaDialogSubtarget | undefined {
  validateWorkspaceId(workspaceId);
  const target = dialogTargetsByWorkspace.get(workspaceId)?.get(id);
  return target ? cloneTarget(target) : undefined;
}

export function listKritaDialogSubtargets(workspaceId: string): KritaDialogSubtarget[] {
  validateWorkspaceId(workspaceId);
  return [...(dialogTargetsByWorkspace.get(workspaceId)?.values() ?? [])].map(cloneTarget);
}

/** Invalidate popup controls as soon as the owner, handle, kind, or geometry changes. */
export function refreshKritaDialogSubtargets(
  workspaceId: string,
  window: KritaWindowInfo,
  state: KritaDialogState,
): { active: KritaDialogSubtarget[]; invalidated: Array<{ id: string; reason: string }> } {
  validateWorkspaceId(workspaceId);
  const targets = dialogTargetsByWorkspace.get(workspaceId);
  if (!targets) return { active: [], invalidated: [] };
  const invalidated: Array<{ id: string; reason: string }> = [];
  for (const [id, target] of targets) {
    const reason = dialogTargetInvalidationReason(target, window, state);
    if (reason) {
      targets.delete(id);
      invalidated.push({ id, reason });
    }
  }
  return { active: listKritaDialogSubtargets(workspaceId), invalidated };
}

export function clearKritaDialogSubtargets(workspaceId: string): void {
  validateWorkspaceId(workspaceId);
  dialogTargetsByWorkspace.delete(workspaceId);
}

export function createDialogFingerprint(window: KritaWindowInfo, state: KritaDialogState): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    ownerWindowHandle: window.windowHandle,
    ownerProcessId: window.processId,
    dialogHandle: state.handle,
    dialogKind: state.kind,
    bounds: state.bounds,
    displayScale: window.displayScale,
  })).digest("hex")}`;
}

function dialogTargetInvalidationReason(target: KritaDialogSubtarget, window: KritaWindowInfo, state: KritaDialogState): string | undefined {
  if (!state.present || !state.handle || !state.bounds) return "dialog-closed";
  if (target.ownerWindowHandle !== window.windowHandle || state.ownerHandle !== window.windowHandle) return "owner-changed";
  if (target.dialogHandle !== state.handle) return "popup-handle-changed";
  if (target.dialogKind !== state.kind) return "dialog-kind-changed";
  if (target.windowDimensions.width !== state.bounds.width || target.windowDimensions.height !== state.bounds.height) return "dialog-geometry-changed";
  if (target.displayScale !== window.displayScale) return "display-scale-changed";
  const fingerprint = createDialogFingerprint(window, state);
  if (target.dialogFingerprint !== fingerprint) return "dialog-fingerprint-changed";
  return undefined;
}

function toPopupRelativeRect(bounds: { x: number; y: number; width: number; height: number }, popup: { x: number; y: number; width: number; height: number }): KritaUiRect | undefined {
  const left = Math.max(bounds.x, popup.x);
  const top = Math.max(bounds.y, popup.y);
  const right = Math.min(bounds.x + bounds.width, popup.x + popup.width);
  const bottom = Math.min(bounds.y + bounds.height, popup.y + popup.height);
  if (right <= left || bottom <= top) return undefined;
  const rect = { x: Math.round(left - popup.x), y: Math.round(top - popup.y), width: Math.round(right - left), height: Math.round(bottom - top) };
  return rect.width > 0 && rect.height > 0 ? rect : undefined;
}

function regionForDialogTarget(id: KritaDialogSubtargetId): KritaUiTarget["region"] {
  switch (id) {
    case "color-hex-field": return "color_hex_field";
    case "dialog-filename": return "dialog_filename";
    case "dialog-path": return "dialog_path";
    case "dialog-confirm": return "dialog_confirm";
    case "dialog-cancel": return "dialog_cancel";
    case "dialog-format": return "dialog_format";
    case "dialog-overwrite-confirm": return "dialog_overwrite_confirm";
    case "color-confirm-button": return "dialog_confirm";
  }
}

function isEdit(element: KritaUiAutomationElement): boolean {
  return /Edit|TextBox|ComboBox/i.test(element.controlType) || /QLineEdit|QTextEdit|Kis.*LineEdit/i.test(element.className);
}

function isButton(element: KritaUiAutomationElement): boolean {
  return /Button/i.test(element.controlType) || /Button/i.test(element.className);
}

function hasSemantic(element: KritaUiAutomationElement, pattern: RegExp): boolean {
  return pattern.test(`${element.name} ${element.value} ${element.automationId} ${element.className}`);
}

function textOf(element: KritaUiAutomationElement): string {
  return element.value.trim() || element.name.trim();
}

function validateWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 256 || /[\r\n\0]/.test(workspaceId)) {
    throw new Error("A valid workspaceId is required for Krita dialog targets.");
  }
}

function cloneTarget(target: KritaDialogSubtarget): KritaDialogSubtarget {
  return { ...target, windowDimensions: { ...target.windowDimensions }, windowRegion: { ...target.windowRegion } };
}
