import { captureDesktopFrame, type DesktopCaptureBackend } from "../desktop/desktop-capture.js";
import { listDesktopDisplays, type DesktopDisplay } from "../desktop/desktop-displays.js";
import {
  isKritaWindowTarget,
  isKritaProcessName,
  isKritaWindowTitle,
  KRITA_PROCESS_NAME,
  KRITA_WINDOW_TITLE,
  type KritaWindowBounds,
} from "./krita-window-target.js";
import { enumerateDesktopWindows, resolveDesktopWindow, type ResolvedDesktopWindow } from "../desktop/window-resolver.js";
import { selectOccludingDesktopWindows, selectOwnedDesktopWindows } from "../desktop/window-target.js";

export type { KritaWindowBounds } from "./krita-window-target.js";

export interface KritaWindowInfo {
  title: string;
  actualTitle: string;
  processName: string;
  processId: number;
  windowHandle: string;
  bounds: KritaWindowBounds;
  displayId: string;
  displayScale: number;
  capturedAt: string;
  captureBackend?: DesktopCaptureBackend;
  occlusionSafe?: boolean;
  foregroundPreserved?: boolean;
  ownedPopups?: KritaOwnedPopupInfo[];
  occluded?: boolean;
  occludingWindows?: KritaOccludingWindowInfo[];
  ownedPopupDiscovery?: "complete" | "unavailable";
}

export interface KritaWindowStatus extends KritaWindowInfo {
  visible: boolean;
  minimized: boolean;
}

export interface KritaOwnedPopupInfo {
  handle: string;
  processId: number;
  processName: string;
  title: string;
  visible: boolean;
  minimized: boolean;
  zOrder: number;
  bounds: KritaWindowBounds;
  ownerHandle?: string;
  rootOwnerHandle?: string;
}

export type KritaOccludingWindowInfo = KritaOwnedPopupInfo;

export async function getKritaWindowInfo(
  windowTitle = KRITA_WINDOW_TITLE,
  windowHandle?: string,
): Promise<KritaWindowInfo> {
  const title = normalizeWindowTitle(windowTitle);
  const frame = await captureDesktopFrame({
    target: "app-window",
    windowTitle: title,
    processName: KRITA_PROCESS_NAME,
    windowHandle,
    maxWidth: 320,
    format: "png",
  });
  const actualTitle = frame.windowTitle ?? title;
  const processName = frame.processName ?? "";
  if (!frame.windowHandle || frame.processId === undefined || !isKritaWindowTarget({
    processName,
    title: actualTitle,
    minimized: false,
    bounds: frame.bounds,
  })) {
    throw new Error("The resolved desktop target is not a visible Krita window.");
  }
  const displays = await listDesktopDisplays();
  const display = selectDisplayForBounds(displays, frame.bounds);
  const popupState = await discoverWindowRelations(frame.windowHandle, frame.processId);
  return {
    title,
    actualTitle,
    processName,
    processId: frame.processId,
    windowHandle: frame.windowHandle,
    bounds: { ...frame.bounds },
    displayId: display.id,
    displayScale: display.scale,
    capturedAt: frame.timestamp,
    captureBackend: frame.captureBackend,
    occlusionSafe: frame.occlusionSafe,
    foregroundPreserved: frame.foregroundWindowHandleBefore === frame.foregroundWindowHandleAfter,
    ...popupState,
  };
}

/**
 * Read-only status may inspect a visible but minimized Krita window so callers
 * can explain why canvas capture is unavailable without treating the process
 * as missing. Capture, calibration, and input continue to use the strict
 * getKritaWindowInfo path above.
 */
export async function getKritaWindowStatus(windowTitle = KRITA_WINDOW_TITLE): Promise<KritaWindowStatus> {
  const resolved = await resolveDesktopWindow({
    title: windowTitle,
    processName: KRITA_PROCESS_NAME,
    includeMinimized: true,
  });
  if (!isKritaProcessName(resolved.processName) || !isKritaWindowTitle(resolved.title)) {
    throw new Error("The resolved desktop target is not a Krita window.");
  }
  const displays = await listDesktopDisplays();
  const display = selectDisplayForBounds(displays, resolved.bounds);
  const popupState = await discoverWindowRelations(resolved.handle, resolved.processId);
  return {
    title: windowTitle,
    actualTitle: resolved.title,
    processName: resolved.processName,
    processId: resolved.processId,
    windowHandle: resolved.handle,
    bounds: { ...resolved.bounds },
    displayId: display.id,
    displayScale: display.scale,
    capturedAt: new Date().toISOString(),
    visible: resolved.visible,
    minimized: resolved.minimized,
    ...popupState,
  };
}

async function discoverWindowRelations(
  handle: string,
  processId: number,
): Promise<Pick<KritaWindowInfo, "ownedPopups" | "occluded" | "occludingWindows" | "ownedPopupDiscovery">> {
  try {
    const candidates = await enumerateDesktopWindows();
    const owner: Pick<ResolvedDesktopWindow, "handle" | "processId"> = { handle, processId };
    const popups = selectOwnedDesktopWindows(candidates, owner);
    const target = candidates.find((candidate) => candidate.handle === handle && candidate.processId === processId);
    const occludingWindows = target ? selectOccludingDesktopWindows(candidates, target) : [];
    return {
      ownedPopups: popups.map(toKritaOwnedPopupInfo),
      occluded: occludingWindows.length > 0,
      occludingWindows: occludingWindows.map(toKritaOwnedPopupInfo),
      ownedPopupDiscovery: "complete",
    };
  } catch {
    return { ownedPopups: [], ownedPopupDiscovery: "unavailable" };
  }
}

function toKritaOwnedPopupInfo(window: ResolvedDesktopWindow): KritaOwnedPopupInfo {
  return {
    handle: window.handle,
    processId: window.processId,
    processName: window.processName,
    title: window.title,
    visible: window.visible,
    minimized: window.minimized,
    zOrder: window.zOrder,
    bounds: { ...window.bounds },
    ownerHandle: window.ownerHandle,
    rootOwnerHandle: window.rootOwnerHandle,
  };
}

export function selectDisplayForBounds(displays: DesktopDisplay[], bounds: KritaWindowBounds): DesktopDisplay {
  if (displays.length === 0) throw new Error("No desktop displays are available for Krita.");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const centered = displays.find((display) => (
    centerX >= display.x
    && centerX < display.x + display.width
    && centerY >= display.y
    && centerY < display.y + display.height
  ));
  if (centered) return centered;

  let best: DesktopDisplay | undefined;
  let bestArea = 0;
  for (const display of displays) {
    const left = Math.max(bounds.x, display.x);
    const top = Math.max(bounds.y, display.y);
    const right = Math.min(bounds.x + bounds.width, display.x + display.width);
    const bottom = Math.min(bounds.y + bounds.height, display.y + display.height);
    const area = Math.max(0, right - left) * Math.max(0, bottom - top);
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  if (!best) throw new Error("Krita window is not inside any enumerated display.");
  return best;
}

function normalizeWindowTitle(value: string): string {
  const title = value.trim();
  if (!title) return "Krita";
  if (title.length > 256 || /[\r\n\0]/.test(title)) {
    throw new Error("Krita window title must be between 1 and 256 safe characters.");
  }
  return title;
}
