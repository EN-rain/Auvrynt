import { normalizeWindowTitleForMatching } from "../desktop/window-target.js";

export const KRITA_PROCESS_NAME = "krita";
export const KRITA_WINDOW_TITLE = "Krita";

export interface KritaWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KritaWindowTargetDescriptor {
  processName: string;
  title: string;
  minimized: boolean;
  bounds: KritaWindowBounds;
}

export function isKritaWindowTarget(target: KritaWindowTargetDescriptor): boolean {
  return !target.minimized
    && isKritaProcessName(target.processName)
    && isKritaWindowTitle(target.title);
}

export function isKritaProcessName(value: string): boolean {
  return value.trim().replace(/\.exe$/i, "").toLowerCase() === KRITA_PROCESS_NAME;
}

export function isKritaWindowTitle(value: string): boolean {
  const title = normalizeWindowTitleForMatching(value);
  return title === KRITA_WINDOW_TITLE.toLowerCase()
    || /\bkrita(?:\s+\[not responding\])?$/.test(title);
}

export function regionInsideWindow(
  region: { x: number; y: number; width: number; height: number },
  bounds: Pick<KritaWindowBounds, "width" | "height">,
): boolean {
  return [region.x, region.y, region.width, region.height].every(Number.isInteger)
    && region.x >= 0
    && region.y >= 0
    && region.width > 0
    && region.height > 0
    && region.x + region.width <= bounds.width
    && region.y + region.height <= bounds.height;
}
