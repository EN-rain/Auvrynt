import type { KritaCanvasRegion } from "./krita-calibration.js";

/** A decoded, non-interlaced 8-bit image in row-major RGBA order. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface KritaCanvasDetection {
  region: KritaCanvasRegion;
  confidence: number;
  method: "center-contrast" | "sampled-profile";
  centerColor: readonly [number, number, number];
  sampledPixels: number;
  matchingPixels: number;
}

const CHANNEL_TOLERANCE = 20;
const MIN_MARGIN = 2;
const MIN_WIDTH = 80;
const MIN_HEIGHT = 60;
const MIN_REGION_FRACTION = 0.2;

/**
 * Detect a canvas only when a stable, contrasting rectangle surrounds the image
 * center. This deliberately rejects outer bounds and ambiguous UI-only images;
 * callers can fall back to an explicitly supplied rectangle in those cases.
 */
export function detectKritaCanvasRegion(image: RgbaImage): KritaCanvasDetection | undefined {
  validateImage(image);
  const centerX = Math.floor(image.width / 2);
  const centerY = Math.floor(image.height / 2);
  const center = pixelAt(image, centerX, centerY);
  if (center[3] < 128) return undefined;

  const left = walk(image, centerX, centerY, -1, 0, center);
  const right = walk(image, centerX, centerY, 1, 0, center);
  const top = walk(image, centerX, centerY, 0, -1, center);
  const bottom = walk(image, centerX, centerY, 0, 1, center);
  const region = {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };

  // A painted stroke can interrupt one of the four center scanlines. Sample a
  // distributed interior band around each axis instead, then require a stable
  // run of pixels that match the center color. This keeps the detector
  // conservative while making it resilient to normal canvas content.
  const profileDetection = detectBySampledProfile(image, center, centerX, centerY);
  const centerDetection = evaluateRegion(image, region, center, "center-contrast");
  if (!centerDetection) return profileDetection;
  if (profileDetection && isMateriallyBroader(profileDetection.region, centerDetection.region)) {
    return profileDetection;
  }
  return centerDetection;
}

function detectBySampledProfile(
  image: RgbaImage,
  center: readonly [number, number, number, number],
  centerX: number,
  centerY: number,
): KritaCanvasDetection | undefined {
  const xRun = findStableRunContaining(axisProfile(image, "x", center), centerX);
  const yRun = findStableRunContaining(axisProfile(image, "y", center), centerY);
  if (!xRun || !yRun) return undefined;

  return evaluateRegion(
    image,
    {
      x: xRun.start,
      y: yRun.start,
      width: xRun.end - xRun.start + 1,
      height: yRun.end - yRun.start + 1,
    },
    center,
    "sampled-profile",
  );
}

function isMateriallyBroader(
  candidate: KritaCanvasRegion,
  baseline: KritaCanvasRegion,
): boolean {
  const widthGain = candidate.width - baseline.width;
  const heightGain = candidate.height - baseline.height;
  return widthGain >= Math.max(12, Math.floor(baseline.width * 0.1))
    || heightGain >= Math.max(12, Math.floor(baseline.height * 0.1));
}

function evaluateRegion(
  image: RgbaImage,
  region: KritaCanvasRegion,
  center: readonly [number, number, number, number],
  method: KritaCanvasDetection["method"],
): KritaCanvasDetection | undefined {
  if (!isPlausibleRegion(region, image.width, image.height)) return undefined;
  const sampled = sampleRegion(image, region, center);
  const outsideContrast = minimumOutsideContrast(image, region, center);
  if (sampled.total === 0 || sampled.ratio < 0.9 || outsideContrast < 0.15) return undefined;

  const sizeScore = Math.min(
    1,
    region.width / (image.width * 0.4),
    region.height / (image.height * 0.4),
  );
  const confidence = method === "sampled-profile"
    ? clamp(
      (sampled.ratio * 0.8) + (outsideContrast * 0.1) + (sizeScore * 0.1),
      0,
      1,
    )
    : clamp(
      (sampled.ratio * 0.7) + (outsideContrast * 0.15) + (sizeScore * 0.15),
      0,
      1,
    );
  if (confidence < 0.9) return undefined;

  return {
    region,
    confidence,
    method,
    centerColor: [center[0], center[1], center[2]],
    sampledPixels: sampled.total,
    matchingPixels: sampled.matching,
  };
}

type Axis = "x" | "y";

function axisProfile(
  image: RgbaImage,
  axis: Axis,
  center: readonly [number, number, number, number],
): number[] {
  const length = axis === "x" ? image.width : image.height;
  const crossLength = axis === "x" ? image.height : image.width;
  const crossStart = Math.floor(crossLength * 0.1);
  const crossSpan = Math.max(2, Math.floor(crossLength * 0.8));
  const sampleCount = Math.min(16, crossSpan);
  const scores = new Array<number>(length).fill(0);

  for (let coordinate = 0; coordinate < length; coordinate += 1) {
    let matching = 0;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const crossCoordinate = clampInteger(
        crossStart + (((sample + 0.5) * crossSpan) / sampleCount),
        0,
        crossLength - 1,
      );
      const x = axis === "x" ? coordinate : crossCoordinate;
      const y = axis === "x" ? crossCoordinate : coordinate;
      const pixel = pixelAt(image, x, y);
      if (pixel[3] >= 128 && colorDistance(pixel, center) <= CHANNEL_TOLERANCE) matching += 1;
    }
    scores[coordinate] = matching / sampleCount;
  }
  return scores;
}

function findStableRunContaining(
  scores: readonly number[],
  centerIndex: number,
  threshold = 0.55,
): { start: number; end: number } | undefined {
  if (scores[centerIndex] === undefined || scores[centerIndex]! < threshold) return undefined;
  let start = centerIndex;
  let end = centerIndex;
  while (start > 0 && scores[start - 1]! >= threshold) start -= 1;
  while (end + 1 < scores.length && scores[end + 1]! >= threshold) end += 1;
  return { start, end };
}

function walk(
  image: RgbaImage,
  startX: number,
  startY: number,
  directionX: -1 | 0 | 1,
  directionY: -1 | 0 | 1,
  center: readonly [number, number, number, number],
): number {
  let x = startX;
  let y = startY;
  while (x >= 0 && y >= 0 && x < image.width && y < image.height) {
    const pixel = pixelAt(image, x, y);
    if (pixel[3] < 128 || colorDistance(pixel, center) > CHANNEL_TOLERANCE) break;
    x += directionX;
    y += directionY;
  }
  return directionX < 0 || directionY < 0 ? (directionX < 0 ? x + 1 : y + 1) : (directionX > 0 ? x - 1 : y - 1);
}

function sampleRegion(
  image: RgbaImage,
  region: KritaCanvasRegion,
  center: readonly [number, number, number, number],
): { total: number; matching: number; ratio: number } {
  const columns = Math.min(12, region.width);
  const rows = Math.min(10, region.height);
  let total = 0;
  let matching = 0;
  for (let row = 0; row < rows; row += 1) {
    const y = region.y + Math.floor(((row + 0.5) * region.height) / rows);
    for (let column = 0; column < columns; column += 1) {
      const x = region.x + Math.floor(((column + 0.5) * region.width) / columns);
      const pixel = pixelAt(image, x, y);
      total += 1;
      if (pixel[3] >= 128 && colorDistance(pixel, center) <= CHANNEL_TOLERANCE) matching += 1;
    }
  }
  return { total, matching, ratio: total === 0 ? 0 : matching / total };
}

function minimumOutsideContrast(
  image: RgbaImage,
  region: KritaCanvasRegion,
  center: readonly [number, number, number, number],
): number {
  const samples: Array<readonly [number, number, number, number]> = [];
  const midX = region.x + Math.floor(region.width / 2);
  const midY = region.y + Math.floor(region.height / 2);
  if (region.x > 0) samples.push(pixelAt(image, region.x - 1, midY));
  if (region.x + region.width < image.width) samples.push(pixelAt(image, region.x + region.width, midY));
  if (region.y > 0) samples.push(pixelAt(image, midX, region.y - 1));
  if (region.y + region.height < image.height) samples.push(pixelAt(image, midX, region.y + region.height));
  if (samples.length < 4) return 0;
  return Math.min(...samples.map((pixel) => colorDistance(pixel, center) / 255));
}

function isPlausibleRegion(region: KritaCanvasRegion, width: number, height: number): boolean {
  return region.x >= MIN_MARGIN
    && region.y >= MIN_MARGIN
    && region.x + region.width <= width - MIN_MARGIN
    && region.y + region.height <= height - MIN_MARGIN
    && region.width >= Math.max(MIN_WIDTH, Math.floor(width * MIN_REGION_FRACTION))
    && region.height >= Math.max(MIN_HEIGHT, Math.floor(height * MIN_REGION_FRACTION))
    && region.width < Math.floor(width * 0.95)
    && region.height < Math.floor(height * 0.95);
}

function pixelAt(image: RgbaImage, x: number, y: number): readonly [number, number, number, number] {
  const offset = ((y * image.width) + x) * 4;
  return [image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!, image.data[offset + 3]!];
}

function colorDistance(left: readonly [number, number, number, number], right: readonly [number, number, number, number]): number {
  return Math.max(
    Math.abs(left[0] - right[0]),
    Math.abs(left[1] - right[1]),
    Math.abs(left[2] - right[2]),
  );
}

function validateImage(image: RgbaImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new Error("Canvas detection requires a positive image size.");
  }
  if (!(image.data instanceof Uint8Array) || image.data.length !== image.width * image.height * 4) {
    throw new Error("Canvas detection requires RGBA pixel data matching the image size.");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
