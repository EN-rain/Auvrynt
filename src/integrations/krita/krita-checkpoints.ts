import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DesktopCaptureFrame } from "../desktop/desktop-capture.js";
import { decodePngRgba } from "./krita-png-decoder.js";

export interface KritaCheckpoint {
  checkpointId: string;
  workspaceId: string;
  documentPath?: string;
  createdAt: string;
  previewHash: string;
  previewPath?: string;
  source: "canvas-capture";
}

export interface KritaCanvasComparison {
  compared: true;
  leftHash: string;
  rightHash: string;
  equal: boolean;
  changedPixelCount: number;
  totalPixelCount: number;
  changedPixelRatio: number;
  changedBounds?: { x: number; y: number; width: number; height: number };
  structuralDifferenceScore: number;
}

const checkpointsByWorkspace = new Map<string, Map<string, KritaCheckpoint>>();
const checkpointBuffers = new Map<string, Buffer>();
let checkpointStateDir: string | undefined;
let checkpointIndexPath: string | undefined;

export function configureKritaCheckpointStore(stateDir?: string): void {
  checkpointStateDir = stateDir ? resolve(stateDir) : undefined;
  checkpointIndexPath = checkpointStateDir ? join(checkpointStateDir, "krita-checkpoints", "index.json") : undefined;
  checkpointsByWorkspace.clear();
  checkpointBuffers.clear();
  loadCheckpointIndex();
}

export function createKritaCheckpoint(
  workspaceId: string,
  frame: DesktopCaptureFrame,
  options: { documentPath?: string; approveUnsavedLocation?: boolean } = {},
): KritaCheckpoint {
  validateWorkspaceId(workspaceId);
  if (frame.mimeType !== "image/png" || frame.format !== "png") throw new Error("Krita checkpoints require a PNG canvas capture.");
  const documentPath = options.documentPath?.trim();
  if (!documentPath && options.approveUnsavedLocation !== true) {
    throw new Error("Persistent Krita checkpoints for unsaved documents require approveUnsavedLocation=true and an explicit documentPath.");
  }
  const createdAt = new Date().toISOString();
  const checkpointId = `krita-checkpoint-${randomUUID()}`;
  const previewHash = hashBuffer(frame.buffer);
  const checkpoint: KritaCheckpoint = {
    checkpointId,
    workspaceId,
    documentPath: documentPath || undefined,
    createdAt,
    previewHash,
    source: "canvas-capture",
  };
  checkpointBuffers.set(checkpointId, Buffer.from(frame.buffer));
  if (checkpointStateDir) {
    const directory = join(checkpointStateDir, "krita-checkpoints", safeWorkspaceDirectory(workspaceId));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const previewPath = join(directory, `${checkpointId}.png`);
    writeFileSync(previewPath, frame.buffer, { mode: 0o600, flag: "wx" });
    checkpoint.previewPath = previewPath;
  }
  const workspace = checkpointsByWorkspace.get(workspaceId) ?? new Map<string, KritaCheckpoint>();
  workspace.set(checkpointId, checkpoint);
  checkpointsByWorkspace.set(workspaceId, workspace);
  persistCheckpointIndex();
  return cloneCheckpoint(checkpoint);
}

export function listKritaCheckpoints(workspaceId: string): KritaCheckpoint[] {
  validateWorkspaceId(workspaceId);
  return [...(checkpointsByWorkspace.get(workspaceId)?.values() ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(cloneCheckpoint);
}

export function getKritaCheckpoint(workspaceId: string, checkpointId: string): KritaCheckpoint {
  validateWorkspaceId(workspaceId);
  const checkpoint = checkpointsByWorkspace.get(workspaceId)?.get(checkpointId);
  if (!checkpoint) throw new Error(`Unknown Krita checkpoint "${checkpointId}".`);
  return cloneCheckpoint(checkpoint);
}

export function getKritaCheckpointBuffer(workspaceId: string, checkpointId: string): Buffer {
  const checkpoint = getKritaCheckpoint(workspaceId, checkpointId);
  const memory = checkpointBuffers.get(checkpoint.checkpointId);
  if (memory) return Buffer.from(memory);
  if (checkpoint.previewPath && existsSync(checkpoint.previewPath)) return readFileSync(checkpoint.previewPath);
  throw new Error(`Krita checkpoint preview for "${checkpointId}" is unavailable.`);
}

export function compareKritaCanvasPng(leftBuffer: Buffer, rightBuffer: Buffer): KritaCanvasComparison {
  const left = decodePngRgba(leftBuffer);
  const right = decodePngRgba(rightBuffer);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error("Krita canvas comparison requires equal image dimensions.");
  }
  const totalPixelCount = left.width * left.height;
  let changedPixelCount = 0;
  let minX = left.width;
  let minY = left.height;
  let maxX = -1;
  let maxY = -1;
  let absoluteDifference = 0;
  for (let y = 0; y < left.height; y += 1) {
    for (let x = 0; x < left.width; x += 1) {
      const offset = (y * left.width + x) * 4;
      let pixelDifference = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        pixelDifference += Math.abs((left.data[offset + channel] ?? 0) - (right.data[offset + channel] ?? 0));
      }
      absoluteDifference += pixelDifference;
      if (pixelDifference > 0) {
        changedPixelCount += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    compared: true,
    leftHash: hashBuffer(leftBuffer),
    rightHash: hashBuffer(rightBuffer),
    equal: changedPixelCount === 0,
    changedPixelCount,
    totalPixelCount,
    changedPixelRatio: totalPixelCount === 0 ? 0 : changedPixelCount / totalPixelCount,
    changedBounds: maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined,
    structuralDifferenceScore: totalPixelCount === 0 ? 0 : absoluteDifference / (totalPixelCount * 4 * 255),
  };
}

function hashBuffer(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function safeWorkspaceDirectory(workspaceId: string): string {
  return workspaceId.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 128) || "workspace";
}

function validateWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 256 || /[\r\n\0]/.test(workspaceId)) throw new Error("A valid workspaceId is required for Krita checkpoints.");
}

function cloneCheckpoint(value: KritaCheckpoint): KritaCheckpoint { return { ...value }; }

function loadCheckpointIndex(): void {
  if (!checkpointIndexPath || !existsSync(checkpointIndexPath)) return;
  try {
    const parsed = JSON.parse(readFileSync(checkpointIndexPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const workspaces = (parsed as Record<string, unknown>).workspaces;
    if (!workspaces || typeof workspaces !== "object" || Array.isArray(workspaces)) return;
    for (const [workspaceId, value] of Object.entries(workspaces as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const checkpoints = new Map<string, KritaCheckpoint>();
      for (const candidate of value) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
        const item = candidate as Record<string, unknown>;
        if (typeof item.checkpointId !== "string" || typeof item.createdAt !== "string" || typeof item.previewHash !== "string") continue;
        checkpoints.set(item.checkpointId, {
          checkpointId: item.checkpointId,
          workspaceId,
          documentPath: typeof item.documentPath === "string" ? item.documentPath : undefined,
          createdAt: item.createdAt,
          previewHash: item.previewHash,
          previewPath: typeof item.previewPath === "string" ? item.previewPath : undefined,
          source: "canvas-capture",
        });
      }
      if (checkpoints.size > 0) checkpointsByWorkspace.set(workspaceId, checkpoints);
    }
  } catch {
    // Corrupt checkpoint metadata is ignored; existing preview files remain
    // recoverable only through a new explicit checkpoint.
  }
}

function persistCheckpointIndex(): void {
  if (!checkpointIndexPath) return;
  const directory = join(checkpointStateDir!, "krita-checkpoints");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* Best effort on Windows. */ }
  const workspaces: Record<string, KritaCheckpoint[]> = {};
  for (const [workspaceId, checkpoints] of checkpointsByWorkspace) workspaces[workspaceId] = [...checkpoints.values()].map(cloneCheckpoint);
  const payload = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), workspaces }, null, 2) + "\n";
  const tempPath = `${checkpointIndexPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, payload, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, checkpointIndexPath);
    try { chmodSync(checkpointIndexPath, 0o600); } catch { /* Best effort on Windows. */ }
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch { /* Preserve original error. */ }
    }
  }
}
