import { decodePng } from "../images/png-codec.js";

export interface DesktopFrameDifference {
  changed: boolean;
  score: number;
  sampledPixels: number;
  dimensionsChanged: boolean;
}

export interface DesktopFrameDifferenceOptions {
  threshold?: number;
  maxSamples?: number;
}

const DEFAULT_THRESHOLD = 0.012;
const DEFAULT_MAX_SAMPLES = 4096;

export function compareDesktopFrames(
  previousPng: Buffer | undefined,
  currentPng: Buffer,
  options: DesktopFrameDifferenceOptions = {},
): DesktopFrameDifference {
  const threshold = normalizeThreshold(options.threshold);
  const maxSamples = normalizeMaxSamples(options.maxSamples);
  const current = decodePng(currentPng);

  if (!previousPng) {
    return {
      changed: true,
      score: 1,
      sampledPixels: Math.min(current.width * current.height, maxSamples),
      dimensionsChanged: false,
    };
  }

  const previous = decodePng(previousPng);
  if (previous.width !== current.width || previous.height !== current.height) {
    return {
      changed: true,
      score: 1,
      sampledPixels: 0,
      dimensionsChanged: true,
    };
  }

  const totalPixels = current.width * current.height;
  const stride = Math.max(1, Math.floor(Math.sqrt(totalPixels / maxSamples)));
  let sampledPixels = 0;
  let accumulatedDifference = 0;

  for (let y = 0; y < current.height; y += stride) {
    for (let x = 0; x < current.width; x += stride) {
      const offset = (y * current.width + x) * 4;
      accumulatedDifference += Math.abs(current.data[offset]! - previous.data[offset]!);
      accumulatedDifference += Math.abs(current.data[offset + 1]! - previous.data[offset + 1]!);
      accumulatedDifference += Math.abs(current.data[offset + 2]! - previous.data[offset + 2]!);
      sampledPixels++;
      if (sampledPixels >= maxSamples) break;
    }
    if (sampledPixels >= maxSamples) break;
  }

  const score = sampledPixels === 0
    ? 0
    : accumulatedDifference / (sampledPixels * 3 * 255);

  return {
    changed: score >= threshold,
    score,
    sampledPixels,
    dimensionsChanged: false,
  };
}

function normalizeThreshold(value: number | undefined): number {
  if (value === undefined) return DEFAULT_THRESHOLD;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Desktop frame change threshold must be between 0 and 1.");
  }
  return value;
}

function normalizeMaxSamples(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_SAMPLES;
  if (!Number.isInteger(value) || value < 64 || value > 65_536) {
    throw new Error("Desktop frame maxSamples must be an integer between 64 and 65536.");
  }
  return value;
}
