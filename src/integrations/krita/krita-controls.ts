import type { KritaUiTarget } from "./krita-ui-targets.js";

export type KritaControlName = "brush-size" | "foreground-color" | "brush-presets" | "layers-panel";

export interface KritaControlObservation<T> {
  value?: T;
  confidence: "expected" | "visually_verified" | "unknown";
  source: string;
  observedAt: string;
}

export interface KritaApprovedBrush {
  id: string;
  label: string;
  presetName: string;
  targetRegion: "brush_presets_docker";
  verification: "visible-name-required";
}

const APPROVED_BRUSHES: readonly KritaApprovedBrush[] = [
  { id: "inking_basic", label: "Inking basic", presetName: "Basic-5 Size", targetRegion: "brush_presets_docker", verification: "visible-name-required" },
  { id: "paint_soft", label: "Paint soft", presetName: "Airbrush Soft", targetRegion: "brush_presets_docker", verification: "visible-name-required" },
  { id: "pixel_1px", label: "Pixel 1px", presetName: "Pixel", targetRegion: "brush_presets_docker", verification: "visible-name-required" },
  { id: "eraser_basic", label: "Eraser basic", presetName: "Eraser Soft", targetRegion: "brush_presets_docker", verification: "visible-name-required" },
];

const approvedById = new Map(APPROVED_BRUSHES.map((brush) => [brush.id, brush]));

export function listKritaApprovedBrushes(): KritaApprovedBrush[] {
  return APPROVED_BRUSHES.map((brush) => ({ ...brush }));
}

export function getKritaApprovedBrush(id: string): KritaApprovedBrush {
  const normalized = id.trim();
  const brush = approvedById.get(normalized);
  if (!brush) throw new Error(`Unknown approved Krita brush "${id}".`);
  return { ...brush };
}

export function normalizeKritaColor(value: string): string {
  if (typeof value !== "string") throw new Error("Krita foreground color must be a hexadecimal string.");
  const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim());
  if (!match) throw new Error("Krita foreground color must use #RRGGBB or #RRGGBBAA.");
  return `#${match[1]!.toUpperCase()}`;
}

export function normalizeKritaBrushSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 10_000) throw new Error("Krita brush size must be greater than 0 and at most 10000.");
  return Math.round(value * 100) / 100;
}

export function requireVerifiedControlTarget(target: KritaUiTarget | undefined, control: KritaControlName): KritaUiTarget {
  if (!target) throw new Error(`No verified Krita ${control} control target is available; refusing to guess UI coordinates.`);
  if (target.confidence < 0.8) throw new Error(`Krita ${control} control target confidence is too low for input.`);
  return target;
}

