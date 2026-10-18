import { detectKritaCanvasRegion, type RgbaImage } from "./krita-canvas-detector.js";
import type { KritaWindowInfo } from "./krita-window.js";
import type { KritaUiRect, KritaUiRegionName, KritaUiTargetInput } from "./krita-ui-targets.js";

/**
 * Result of bounded layout analysis over a captured Krita application window.
 * The image is supplied by the strict app-window renderer; this module never
 * reads the desktop or sends input. Targets are emitted only when their
 * geometry is anchored to visual structure in that image.
 */
export interface KritaUiDiscoveryResult {
  method: "target-only-layout";
  confidence: number;
  canvasRegion?: KritaUiRect;
  targets: KritaUiTargetInput[];
  rejected: string[];
}

interface PixelComponent {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

/**
 * Locate stable Krita UI regions without fixed screen coordinates. The canvas
 * detector provides the primary anchor; toolbar accents, dock edges, panel
 * separators, and selected-row highlights provide secondary anchors. If a
 * structural signal is ambiguous it is omitted rather than guessed.
 */
export function discoverKritaUiTargets(
  window: KritaWindowInfo,
  image: RgbaImage,
  verifiedCanvasWindowRegion?: KritaUiRect,
): KritaUiDiscoveryResult {
  validateImage(image);
  const detectedCanvas = detectKritaCanvasRegion(image);
  const detection = detectedCanvas ?? (verifiedCanvasWindowRegion
    ? anchoredCanvasDetection(window, image, verifiedCanvasWindowRegion)
    : undefined);
  const rejected: string[] = [];
  if (!detection) {
    return {
      method: "target-only-layout",
      confidence: 0,
      targets: [],
      rejected: ["canvas-not-detected"],
    };
  }

  const targets: KritaUiTargetInput[] = [];
  const ids = new Set<string>();
  const add = (id: string, region: KritaUiRegionName, rect: KritaUiRect, confidence: number): void => {
    const mapped = mapCaptureRectToWindow(rect, image, window);
    if (!mapped || ids.has(id)) {
      rejected.push(`${id}-geometry-invalid`);
      return;
    }
    ids.add(id);
    targets.push({
      id,
      region,
      windowRegion: mapped,
      confidence: clamp(confidence, 0.8, 0.99),
      source: "visual-confirmation",
    });
  };

  const uiScale = clamp(Math.min(image.width / 1942, image.height / 1030), 0.35, 1.5);
  // The toolbar's vertical offset follows the larger window dimension on
  // narrow/portrait layouts, while control widths/heights should follow the
  // smaller dimension. Keep those scales separate so a tall phone-like
  // window does not make small controls disappear from the scan band.
  const toolbarScanScale = clamp(Math.max(image.width / 1942, image.height / 1030), 0.35, 1.5);
  const toolbarScanHeight = Math.max(36, Math.round(86 * toolbarScanScale));
  const toolbarTop = Math.max(0, detection.region.y - toolbarScanHeight);
  const toolbarEnd = Math.max(toolbarTop + 1, detection.region.y);
  const accentMinimumArea = Math.max(16, Math.round(80 * uiScale * uiScale));
  const toolbarAccents = findAccentComponents(image, toolbarTop, toolbarEnd, 0, image.width, accentMinimumArea);
  const sizeComponent = toolbarAccents
    .filter((component) => component.width >= Math.max(8, Math.round(24 * uiScale))
      && component.height >= Math.max(6, Math.round(10 * uiScale))
      && component.width <= Math.max(120, Math.round(260 * uiScale)))
    .sort((left, right) => right.x - left.x)[0];
  const toolbarY = sizeComponent ? Math.max(0, sizeComponent.y - 7) : Math.max(0, detection.region.y - 48);
  const toolbarHeight = Math.max(24, detection.region.y - toolbarY);
  add("toolbar", "toolbar", { x: 0, y: toolbarY, width: image.width, height: toolbarHeight }, detection.confidence - 0.03);

  if (sizeComponent) {
    // Krita's spin box uses a colored label segment followed by the numeric
    // field and arrow buttons. Expand the visually detected segment in the
    // same row instead of clicking a hard-coded toolbar coordinate.
    const expandedWidth = clamp(Math.round(sizeComponent.width * 3.2), 140, 360);
    add(
      "brush-size",
      "toolbar",
      {
        x: sizeComponent.x,
        y: Math.max(0, sizeComponent.y - 1),
        width: Math.min(expandedWidth, image.width - sizeComponent.x),
        height: Math.min(sizeComponent.height + 2, image.height - sizeComponent.y + 1),
      },
      Math.min(detection.confidence, 0.93),
    );
  } else {
    rejected.push("brush-size-accent-ambiguous");
  }

  // Keep the color target in the compact toolbar control band. A broad
  // toolbar-sized rectangle would be safe for capture but its center could
  // land in the document-tab/canvas boundary when used for a click.
  const colorControlHeight = sizeComponent
    ? Math.min(Math.max(20, sizeComponent.height + 2), toolbarHeight)
    : Math.min(toolbarHeight, 40);
  const colorControl = deriveForegroundControlRect(image, detection.region, toolbarY, colorControlHeight, uiScale);
  if (colorControl) add("foreground-color", "foreground_color_control", colorControl, Math.min(detection.confidence - 0.08, 0.9));
  else rejected.push("foreground-color-contrast-ambiguous");

  const dockStart = findDockStart(image, detection.region);
  if (dockStart === undefined) {
    rejected.push("right-dock-edge-ambiguous");
  } else {
    const dockTop = Math.min(image.height - 1, Math.max(toolbarEnd + 1, sizeComponent ? sizeComponent.y + sizeComponent.height + 6 : detection.region.y - 48));
    const dockBottom = Math.max(dockTop + 1, image.height - Math.max(24, Math.round(image.height * 0.04)));
    const dockWidth = image.width - dockStart;
    const split = findDockSplit(image, dockStart, dockTop, dockBottom);
    if (!split) {
      rejected.push("dock-panel-split-ambiguous");
    } else {
      const layersTop = dockTop + Math.max(8, Math.round((split.row - dockTop) * 0.28));
      add("layers-panel", "layers_docker", { x: dockStart, y: layersTop, width: dockWidth, height: Math.max(1, split.row - layersTop) }, Math.min(detection.confidence, split.confidence));
      add("brush-presets", "brush_presets_docker", { x: dockStart, y: split.row + 2, width: dockWidth, height: Math.max(1, dockBottom - split.row - 2) }, Math.min(detection.confidence, split.confidence));

      const activeRow = findAccentComponents(image, layersTop, split.row, dockStart, image.width, accentMinimumArea)
        .filter((component) => component.width >= Math.max(24, Math.round(dockWidth * 0.45))
          && component.height >= Math.max(8, Math.round(14 * uiScale))
          && component.height <= Math.max(32, Math.round(64 * uiScale)))
        // A selected layer row is below the Layers opacity control; choosing
        // the lowest wide highlight avoids mistaking that control for the row.
        .sort((left, right) => right.y - left.y)[0];
      if (activeRow) {
        add("active-layer-name", "layers_docker", {
          x: activeRow.x,
          y: activeRow.y,
          width: activeRow.width,
          height: activeRow.height,
        }, Math.min(detection.confidence, 0.9));
      } else {
        rejected.push("active-layer-row-ambiguous");
      }
    }
  }

  // These structural regions are useful for read-only verification and are
  // anchored to the detected canvas rather than to a fixed screen layout.
  const chromeHeight = Math.max(24, Math.round(48 * uiScale));
  const chromeY = Math.max(0, toolbarEnd - chromeHeight);
  add("document-tabs", "document_tabs", { x: 0, y: chromeY, width: image.width, height: Math.min(chromeHeight, image.height - chromeY) }, detection.confidence - 0.08);
  add("toolbox", "toolbox", { x: 0, y: chromeY, width: Math.max(1, detection.region.x), height: Math.max(1, image.height - chromeY) }, detection.confidence - 0.08);
  add("status-bar", "status_bar", { x: 0, y: detection.region.y + detection.region.height, width: image.width, height: Math.max(1, image.height - detection.region.y - detection.region.height) }, detection.confidence - 0.08);

  return {
    method: "target-only-layout",
    confidence: detection.confidence,
    canvasRegion: { ...detection.region },
    targets,
    rejected,
  };
}

function anchoredCanvasDetection(
  window: KritaWindowInfo,
  image: RgbaImage,
  region: KritaUiRect,
): { region: KritaUiRect; confidence: number } | undefined {
  if (window.bounds.width < 1 || window.bounds.height < 1
    || region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1
    || region.x + region.width > window.bounds.width
    || region.y + region.height > window.bounds.height) return undefined;
  const scaleX = image.width / window.bounds.width;
  const scaleY = image.height / window.bounds.height;
  const mapped = {
    x: Math.floor(region.x * scaleX),
    y: Math.floor(region.y * scaleY),
    width: Math.max(1, Math.round(region.width * scaleX)),
    height: Math.max(1, Math.round(region.height * scaleY)),
  };
  if (mapped.x < 0 || mapped.y < 0 || mapped.x + mapped.width > image.width || mapped.y + mapped.height > image.height) return undefined;
  return { region: mapped, confidence: 0.84 };
}

function findAccentComponents(image: RgbaImage, yStart: number, yEnd: number, xStart: number, xEnd: number, minimumArea = 80): PixelComponent[] {
  const left = clampInteger(xStart, 0, image.width - 1);
  const top = clampInteger(yStart, 0, image.height - 1);
  const right = clampInteger(xEnd, left + 1, image.width);
  const bottom = clampInteger(yEnd, top + 1, image.height);
  const localWidth = right - left;
  const localHeight = bottom - top;
  const visited = new Uint8Array(localWidth * localHeight);
  const components: PixelComponent[] = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const local = (y - top) * localWidth + (x - left);
      if (visited[local] || !isAccentPixel(image, x, y)) continue;
      visited[local] = 1;
      const queue: number[] = [local];
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      while (queue.length > 0) {
        const current = queue.pop()!;
        const currentX = left + (current % localWidth);
        const currentY = top + Math.floor(current / localWidth);
        area += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        for (const [nextX, nextY] of [[currentX - 1, currentY], [currentX + 1, currentY], [currentX, currentY - 1], [currentX, currentY + 1]]) {
          if (nextX < left || nextX >= right || nextY < top || nextY >= bottom) continue;
          const next = (nextY - top) * localWidth + (nextX - left);
          if (visited[next] || !isAccentPixel(image, nextX, nextY)) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
      if (area >= minimumArea) {
        components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area });
      }
    }
  }
  return components;
}

function isAccentPixel(image: RgbaImage, x: number, y: number): boolean {
  const offset = (y * image.width + x) * 4;
  const red = image.data[offset]!;
  const green = image.data[offset + 1]!;
  const blue = image.data[offset + 2]!;
  return blue - red >= 24 && green - red >= 8 && blue >= 82 && red < 170;
}

function deriveForegroundControlRect(
  image: RgbaImage,
  canvas: KritaUiRect,
  toolbarY: number,
  toolbarHeight: number,
  uiScale = 1,
): KritaUiRect | undefined {
  const x = clampInteger(canvas.x - 2, 0, image.width - 1);
  const width = Math.min(84, image.width - x);
  const height = Math.min(Math.max(20, toolbarHeight), image.height - toolbarY);
  if (width < 24 || height < 12) return undefined;
  let dark = 0;
  let bright = 0;
  let total = 0;
  for (let row = toolbarY; row < toolbarY + height; row += 2) {
    for (let column = x; column < x + width; column += 2) {
      const offset = (row * image.width + column) * 4;
      const luminance = (0.2126 * image.data[offset]!) + (0.7152 * image.data[offset + 1]!) + (0.0722 * image.data[offset + 2]!);
      if (luminance < 35) dark += 1;
      if (luminance > 190) bright += 1;
      total += 1;
    }
  }
  const darkThreshold = Math.max(0.006, 0.015 * Math.min(1, uiScale));
  const brightThreshold = Math.max(0.02, 0.03 * Math.min(1, uiScale));
  return total > 0 && dark / total >= darkThreshold && bright / total >= brightThreshold
    ? { x, y: toolbarY, width, height }
    : undefined;
}

function findDockStart(image: RgbaImage, canvas: KritaUiRect): number | undefined {
  const start = clampInteger(canvas.x + canvas.width + 8, 0, image.width - 1);
  const yStart = clampInteger(Math.max(0, canvas.y - 48), 0, image.height - 1);
  const yEnd = clampInteger(Math.max(yStart + 1, image.height - 48), yStart + 1, image.height);
  const minimumRun = Math.max(24, Math.round(image.width * 0.06));
  const minimumDockWidth = Math.max(40, Math.round(image.width * 0.08));
  const baselineEnd = Math.min(image.width, start + Math.max(16, Math.round(image.width * 0.04)));
  const baseline = columnAverageLuminance(image, Math.floor((start + baselineEnd) / 2), yStart, yEnd);
  // A wide responsive docker can contain bright headers, swatches, and
  // separators. Requiring every column to stay below 112 luminance splits
  // that one dock into short runs. Keep the dark-fraction gate (which rejects
  // the gray canvas gutter) but allow a modest luminance rise above the local
  // gutter baseline so the whole panel can be recognized as one structure.
  const dockAverageThreshold = Math.min(128, baseline - 2);
  let runStart: number | undefined;
  for (let x = start; x < image.width; x += 1) {
    const average = columnAverageLuminance(image, x, yStart, yEnd);
    const darkFraction = columnDarkFraction(image, x, yStart, yEnd);
    if (average <= dockAverageThreshold && darkFraction >= 0.55) {
      runStart ??= x;
      if (x - runStart + 1 >= minimumRun && image.width - runStart >= minimumDockWidth) {
        return refineDockStart(image, runStart, yStart, yEnd);
      }
    } else {
      runStart = undefined;
    }
  }
  return undefined;
}

function refineDockStart(image: RgbaImage, candidate: number, yStart: number, yEnd: number): number {
  // Scrollbars and resize gutters can satisfy the dark-column test before the
  // actual docker begins. Prefer the first short, positive luminance edge that
  // leads into a stable panel; if no such edge exists retain the run start.
  const end = Math.min(image.width - 1, candidate + Math.max(24, Math.round(image.width * 0.04)));
  let best = candidate;
  let bestRise = 4;
  for (let x = candidate; x < end; x += 1) {
    const rise = columnAverageLuminance(image, x + 1, yStart, yEnd) - columnAverageLuminance(image, x, yStart, yEnd);
    if (rise > bestRise) {
      bestRise = rise;
      best = x + 1;
    }
  }
  return best;
}

function columnAverageLuminance(image: RgbaImage, x: number, yStart: number, yEnd: number): number {
  let sum = 0;
  let count = 0;
  for (let y = yStart; y < yEnd; y += 4) {
    const offset = (y * image.width + x) * 4;
    sum += (0.2126 * image.data[offset]!) + (0.7152 * image.data[offset + 1]!) + (0.0722 * image.data[offset + 2]!);
    count += 1;
  }
  return count === 0 ? 255 : sum / count;
}

function findDockSplit(image: RgbaImage, dockStart: number, dockTop: number, dockBottom: number): { row: number; confidence: number } | undefined {
  const expected = dockTop + Math.round((dockBottom - dockTop) * 0.62);
  const innerStart = Math.min(image.width - 1, dockStart + Math.max(16, Math.round((image.width - dockStart) * 0.08)));
  const innerEnd = Math.max(innerStart + 1, image.width - Math.max(12, Math.round((image.width - dockStart) * 0.04)));
  const candidates: number[] = [];
  const topMargin = Math.max(24, Math.round((dockBottom - dockTop) * 0.12));
  const bottomMargin = Math.max(24, Math.round((dockBottom - dockTop) * 0.1));
  for (let row = dockTop + topMargin; row < dockBottom - bottomMargin; row += 1) {
    const stats = rowLuminanceStats(image, row, innerStart, innerEnd);
    if (stats.standardDeviation <= 4.5 && stats.average >= 35 && stats.average <= 100) candidates.push(row);
  }
  if (candidates.length === 0) return undefined;
  const row = candidates.reduce((best, candidate) => Math.abs(candidate - expected) < Math.abs(best - expected) ? candidate : best, candidates[0]!);
  const distance = Math.abs(row - expected) / Math.max(1, dockBottom - dockTop);
  if (distance > 0.18) return undefined;
  return { row, confidence: clamp(0.94 - distance, 0.8, 0.94) };
}

function columnDarkFraction(image: RgbaImage, x: number, yStart: number, yEnd: number): number {
  let dark = 0;
  let total = 0;
  for (let y = yStart; y < yEnd; y += 4) {
    const offset = (y * image.width + x) * 4;
    const luminance = (0.2126 * image.data[offset]!) + (0.7152 * image.data[offset + 1]!) + (0.0722 * image.data[offset + 2]!);
    if (luminance < 112) dark += 1;
    total += 1;
  }
  return total === 0 ? 0 : dark / total;
}

function rowLuminanceStats(image: RgbaImage, y: number, xStart: number, xEnd: number): { average: number; standardDeviation: number } {
  let sum = 0;
  let squared = 0;
  let count = 0;
  for (let x = xStart; x < xEnd; x += 2) {
    const offset = (y * image.width + x) * 4;
    const luminance = (0.2126 * image.data[offset]!) + (0.7152 * image.data[offset + 1]!) + (0.0722 * image.data[offset + 2]!);
    sum += luminance;
    squared += luminance * luminance;
    count += 1;
  }
  const average = count === 0 ? 0 : sum / count;
  return { average, standardDeviation: count === 0 ? 0 : Math.sqrt(Math.max(0, (squared / count) - (average * average))) };
}

function mapCaptureRectToWindow(rect: KritaUiRect, image: RgbaImage, window: KritaWindowInfo): KritaUiRect | undefined {
  const scaleX = window.bounds.width / image.width;
  const scaleY = window.bounds.height / image.height;
  const x = clampInteger(Math.round(rect.x * scaleX), 0, window.bounds.width - 1);
  const y = clampInteger(Math.round(rect.y * scaleY), 0, window.bounds.height - 1);
  const right = clampInteger(Math.round((rect.x + rect.width) * scaleX), x + 1, window.bounds.width);
  const bottom = clampInteger(Math.round((rect.y + rect.height) * scaleY), y + 1, window.bounds.height);
  if (right <= x || bottom <= y) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

function validateImage(image: RgbaImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new Error("Krita UI discovery requires a positive image size.");
  }
  if (!(image.data instanceof Uint8Array) || image.data.length !== image.width * image.height * 4) {
    throw new Error("Krita UI discovery requires RGBA pixel data matching the image size.");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
