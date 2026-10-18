import { getDesktopDisplay, listDesktopDisplays } from "../desktop/desktop-displays.js";
import { getKritaWindowInfo, type KritaWindowBounds } from "./krita-window.js";
import { KRITA_PROCESS_NAME, regionInsideWindow } from "./krita-window-target.js";

export { selectDisplayForBounds } from "./krita-window.js";

export interface KritaCanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KritaNormalizedPoint {
  x: number;
  y: number;
}

export interface KritaMappedPoint {
  screenX: number;
  screenY: number;
  displayX: number;
  displayY: number;
  displayId: string;
}

export interface KritaCanvasCalibration {
  workspaceId: string;
  windowTitle: string;
  processName: string;
  windowHandle: string;
  displayId: string;
  displayScale: number;
  windowBounds: KritaWindowBounds;
  displayBounds: KritaCanvasRegion;
  canvasWindowRegion: KritaCanvasRegion;
  canvasScreenRegion: KritaCanvasRegion;
  calibratedAt: string;
  verifiedAt?: string;
}

export interface KritaCalibrationCheck {
  valid: boolean;
  reason?: "missing" | "unverified" | "geometry-changed" | "display-changed" | "display-scale-changed";
  calibration?: KritaCanvasCalibration;
  currentWindow?: {
    title: string;
    actualTitle: string;
    processName: string;
    processId: number;
    windowHandle: string;
    bounds: KritaWindowBounds;
    displayId: string;
    displayScale: number;
  };
}

const calibrations = new Map<string, KritaCanvasCalibration>();

export async function calibrateKritaCanvas(
  workspaceId: string,
  canvasWindowRegion: KritaCanvasRegion,
  windowTitle = "Krita",
): Promise<KritaCanvasCalibration> {
  validateWorkspaceId(workspaceId);
  const window = await getKritaWindowInfo(windowTitle);
  const displays = await listDesktopDisplays();
  const display = getDesktopDisplay(displays, window.displayId);
  const region = normalizeCanvasRegion(canvasWindowRegion, window.bounds);
  const screenRegion = {
    x: window.bounds.x + region.x,
    y: window.bounds.y + region.y,
    width: region.width,
    height: region.height,
  };

  if (!regionInsideDisplay(screenRegion, display)) {
    throw new Error("The calibrated Krita canvas must fit entirely inside the selected display.");
  }

  const calibration: KritaCanvasCalibration = {
    workspaceId,
    windowTitle: window.title,
    processName: window.processName || KRITA_PROCESS_NAME,
    windowHandle: window.windowHandle,
    displayId: display.id,
    displayScale: window.displayScale,
    windowBounds: { ...window.bounds },
    displayBounds: {
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
    },
    canvasWindowRegion: region,
    canvasScreenRegion: screenRegion,
    calibratedAt: new Date().toISOString(),
  };
  calibrations.set(workspaceId, calibration);
  return cloneCalibration(calibration);
}

export function getKritaCalibration(workspaceId: string): KritaCanvasCalibration | undefined {
  validateWorkspaceId(workspaceId);
  const calibration = calibrations.get(workspaceId);
  return calibration ? cloneCalibration(calibration) : undefined;
}

export function clearKritaCalibration(workspaceId: string): { cleared: boolean } {
  validateWorkspaceId(workspaceId);
  return { cleared: calibrations.delete(workspaceId) };
}

export function markKritaCalibrationVerified(workspaceId: string): KritaCanvasCalibration {
  validateWorkspaceId(workspaceId);
  const calibration = calibrations.get(workspaceId);
  if (!calibration) throw new Error("Krita canvas is not calibrated for this workspace.");
  calibration.verifiedAt = new Date().toISOString();
  return cloneCalibration(calibration);
}

export async function checkKritaCalibration(workspaceId: string): Promise<KritaCalibrationCheck> {
  validateWorkspaceId(workspaceId);
  const calibration = calibrations.get(workspaceId);
  if (!calibration) return { valid: false, reason: "missing" };

  const current = await getKritaWindowInfo(calibration.windowTitle, calibration.windowHandle);
  const currentWindow = {
    title: current.title,
    actualTitle: current.actualTitle,
    processName: current.processName,
    processId: current.processId,
    windowHandle: current.windowHandle,
    bounds: { ...current.bounds },
    displayId: current.displayId,
    displayScale: current.displayScale,
  };

  if (current.displayId !== calibration.displayId) {
    return { valid: false, reason: "display-changed", calibration: cloneCalibration(calibration), currentWindow };
  }
  if (Math.abs(current.displayScale - calibration.displayScale) > 0.001) {
    return { valid: false, reason: "display-scale-changed", calibration: cloneCalibration(calibration), currentWindow };
  }
  if (!sameBounds(current.bounds, calibration.windowBounds)) {
    return { valid: false, reason: "geometry-changed", calibration: cloneCalibration(calibration), currentWindow };
  }
  if (!calibration.verifiedAt) {
    return { valid: false, reason: "unverified", calibration: cloneCalibration(calibration), currentWindow };
  }
  return { valid: true, calibration: cloneCalibration(calibration), currentWindow };
}

export async function requireValidKritaCalibration(workspaceId: string): Promise<KritaCanvasCalibration> {
  const check = await checkKritaCalibration(workspaceId);
  if (check.valid && check.calibration) return check.calibration;
  if (check.reason === "missing") {
    throw new Error("Krita canvas is not calibrated. Calibrate the canvas before using normalized drawing coordinates.");
  }
  if (check.reason === "unverified") {
    throw new Error("Krita canvas calibration is not visually confirmed. Review the canvas and confirm calibration before continuing.");
  }
  throw new Error(`Krita canvas calibration is stale (${check.reason}). Recalibrate before continuing.`);
}

export function mapNormalizedCanvasPoint(
  calibration: KritaCanvasCalibration,
  point: KritaNormalizedPoint,
): KritaMappedPoint {
  validateNormalizedPoint(point);
  const screenX = clampRounded(
    calibration.canvasScreenRegion.x + (point.x * Math.max(0, calibration.canvasScreenRegion.width - 1)),
    calibration.canvasScreenRegion.x,
    calibration.canvasScreenRegion.x + calibration.canvasScreenRegion.width - 1,
  );
  const screenY = clampRounded(
    calibration.canvasScreenRegion.y + (point.y * Math.max(0, calibration.canvasScreenRegion.height - 1)),
    calibration.canvasScreenRegion.y,
    calibration.canvasScreenRegion.y + calibration.canvasScreenRegion.height - 1,
  );
  return {
    screenX,
    screenY,
    displayX: screenX - calibration.displayBounds.x,
    displayY: screenY - calibration.displayBounds.y,
    displayId: calibration.displayId,
  };
}

export function canvasDisplayRegion(calibration: KritaCanvasCalibration): KritaCanvasRegion {
  return {
    x: calibration.canvasScreenRegion.x - calibration.displayBounds.x,
    y: calibration.canvasScreenRegion.y - calibration.displayBounds.y,
    width: calibration.canvasScreenRegion.width,
    height: calibration.canvasScreenRegion.height,
  };
}

function normalizeCanvasRegion(region: KritaCanvasRegion, windowBounds: KritaWindowBounds): KritaCanvasRegion {
  for (const [field, value] of Object.entries(region)) {
    if (!Number.isInteger(value)) throw new Error(`Krita canvas ${field} must be an integer.`);
  }
  if (![region.x, region.y, region.width, region.height].every(Number.isInteger)
    || region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1) {
    throw new Error("Krita canvas region requires non-negative x/y and positive width/height.");
  }
  if (!regionInsideWindow(region, windowBounds)) {
    throw new Error("Krita canvas region extends outside the current Krita window.");
  }
  return { ...region };
}

function regionInsideDisplay(
  region: KritaCanvasRegion,
  display: { x: number; y: number; width: number; height: number },
): boolean {
  return region.x >= display.x
    && region.y >= display.y
    && region.x + region.width <= display.x + display.width
    && region.y + region.height <= display.y + display.height;
}

function sameBounds(left: KritaWindowBounds, right: KritaWindowBounds): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function validateNormalizedPoint(point: KritaNormalizedPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new Error("Normalized Krita canvas coordinates must be finite numbers between 0 and 1.");
  }
}

function validateWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 256 || /[\r\n\0]/.test(workspaceId)) {
    throw new Error("A valid workspaceId is required for Krita calibration.");
  }
}

function clampRounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function cloneCalibration(value: KritaCanvasCalibration): KritaCanvasCalibration {
  return {
    ...value,
    windowBounds: { ...value.windowBounds },
    displayBounds: { ...value.displayBounds },
    canvasWindowRegion: { ...value.canvasWindowRegion },
    canvasScreenRegion: { ...value.canvasScreenRegion },
  };
}
