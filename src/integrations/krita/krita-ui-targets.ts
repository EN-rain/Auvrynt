import { createHash } from "node:crypto";
import type { KritaWindowInfo } from "./krita-window.js";

export { discoverKritaUiTargets } from "./krita-ui-target-discovery.js";
export type { KritaUiDiscoveryResult } from "./krita-ui-target-discovery.js";

export const KRITA_UI_REGION_NAMES = [
  "toolbar",
  "layers_docker",
  "brush_presets_docker",
  "status_bar",
  "foreground_color_control",
  "document_tabs",
  "toolbox",
  "popup",
  "dialog",
  "dialog_filename",
  "dialog_path",
  "dialog_confirm",
  "dialog_cancel",
  "dialog_format",
  "dialog_overwrite_confirm",
  "color_hex_field",
  "preset_search",
  "preset_name",
] as const;

export type KritaUiRegionName = (typeof KRITA_UI_REGION_NAMES)[number];

export interface KritaUiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KritaUiTarget {
  id: string;
  region: KritaUiRegionName;
  windowHandle: string;
  processId: number;
  processName: string;
  windowDimensions: { width: number; height: number };
  displayScale: number;
  windowRegion: KritaUiRect;
  confidence: number;
  verifiedAt: string;
  fingerprint: string;
  source: "visual-confirmation" | "user-confirmed";
}

export interface KritaUiTargetInput {
  id?: string;
  region: KritaUiRegionName;
  windowRegion: KritaUiRect;
  confidence: number;
  source?: "visual-confirmation" | "user-confirmed";
}

const targetsByWorkspace = new Map<string, Map<string, KritaUiTarget>>();

export function recordKritaUiTarget(
  workspaceId: string,
  window: KritaWindowInfo,
  input: KritaUiTargetInput,
): KritaUiTarget {
  validateWorkspaceId(workspaceId);
  validateRegionName(input.region);
  validateRect(input.windowRegion);
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("Krita UI target confidence must be between 0 and 1.");
  }
  if (input.confidence < 0.8) {
    throw new Error("Krita UI target confidence must be at least 0.8 for safe input.");
  }
  if (input.windowRegion.x + input.windowRegion.width > window.bounds.width
    || input.windowRegion.y + input.windowRegion.height > window.bounds.height) {
    throw new Error("Krita UI target must fit inside the current Krita window.");
  }
  const id = normalizeTargetId(input.id ?? `krita-${input.region}`);
  const target: KritaUiTarget = {
    id,
    region: input.region,
    windowHandle: window.windowHandle,
    processId: window.processId,
    processName: window.processName,
    windowDimensions: { width: window.bounds.width, height: window.bounds.height },
    displayScale: window.displayScale,
    windowRegion: { ...input.windowRegion },
    confidence: input.confidence,
    verifiedAt: new Date().toISOString(),
    fingerprint: createTargetFingerprint(window, input.region, input.windowRegion),
    source: input.source ?? "user-confirmed",
  };
  const targets = targetsByWorkspace.get(workspaceId) ?? new Map<string, KritaUiTarget>();
  targets.set(id, target);
  targetsByWorkspace.set(workspaceId, targets);
  return cloneTarget(target);
}

export function getKritaUiTarget(workspaceId: string, id: string): KritaUiTarget | undefined {
  validateWorkspaceId(workspaceId);
  const target = targetsByWorkspace.get(workspaceId)?.get(normalizeTargetId(id));
  return target ? cloneTarget(target) : undefined;
}

/** Remove one dynamic target before a fresh visual discovery pass. */
export function clearKritaUiTarget(workspaceId: string, id: string): { cleared: boolean } {
  validateWorkspaceId(workspaceId);
  const targets = targetsByWorkspace.get(workspaceId);
  if (!targets) return { cleared: false };
  const cleared = targets.delete(normalizeTargetId(id));
  if (targets.size === 0) targetsByWorkspace.delete(workspaceId);
  return { cleared };
}

export function listKritaUiTargets(workspaceId: string): KritaUiTarget[] {
  validateWorkspaceId(workspaceId);
  return [...(targetsByWorkspace.get(workspaceId)?.values() ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(cloneTarget);
}

export function refreshKritaUiTargets(workspaceId: string, window: KritaWindowInfo): {
  active: KritaUiTarget[];
  invalidated: Array<{ id: string; reason: string }>;
} {
  validateWorkspaceId(workspaceId);
  const targets = targetsByWorkspace.get(workspaceId);
  if (!targets) return { active: [], invalidated: [] };
  const invalidated: Array<{ id: string; reason: string }> = [];
  for (const [id, target] of targets) {
    const reason = targetInvalidationReason(target, window);
    if (reason) {
      targets.delete(id);
      invalidated.push({ id, reason });
    }
  }
  return { active: listKritaUiTargets(workspaceId), invalidated };
}

export function clearKritaUiTargets(workspaceId: string): { cleared: boolean } {
  validateWorkspaceId(workspaceId);
  return { cleared: targetsByWorkspace.delete(workspaceId) };
}

export function createTargetFingerprint(window: KritaWindowInfo, region: KritaUiRegionName, rect: KritaUiRect): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    windowHandle: window.windowHandle,
    processId: window.processId,
    processName: window.processName,
    width: window.bounds.width,
    height: window.bounds.height,
    displayScale: window.displayScale,
    region,
    rect,
  })).digest("hex")}`;
}

function targetInvalidationReason(target: KritaUiTarget, window: KritaWindowInfo): string | undefined {
  if (target.windowHandle !== window.windowHandle) return "window-handle-changed";
  if (target.processId !== window.processId || target.processName.toLowerCase() !== window.processName.toLowerCase()) return "process-changed";
  if (target.windowDimensions.width !== window.bounds.width || target.windowDimensions.height !== window.bounds.height) return "window-geometry-changed";
  if (target.displayScale !== window.displayScale) return "display-scale-changed";
  return undefined;
}

function validateRegionName(value: string): asserts value is KritaUiRegionName {
  if (!(KRITA_UI_REGION_NAMES as readonly string[]).includes(value)) throw new Error(`Unknown Krita UI region "${value}".`);
}

function validateRect(rect: KritaUiRect): void {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)) throw new Error("Krita UI target bounds must be integer rectangle values.");
  if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1) throw new Error("Krita UI target bounds must be positive and non-negative.");
}

function normalizeTargetId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) throw new Error("Krita UI target id is invalid.");
  return normalized;
}

function validateWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 256 || /[\r\n\0]/.test(workspaceId)) throw new Error("A valid workspaceId is required for Krita UI targets.");
}

function cloneTarget(target: KritaUiTarget): KritaUiTarget {
  return { ...target, windowDimensions: { ...target.windowDimensions }, windowRegion: { ...target.windowRegion } };
}
