import { randomUUID } from "node:crypto";
import { captureDesktopFrame, type DesktopCaptureInput, type DesktopCaptureFrame } from "./desktop-capture.js";
import { compareDesktopFrames, type DesktopFrameDifference } from "./desktop-change-detection.js";

const MAX_STREAMS_PER_WORKSPACE = 4;
const DEFAULT_FPS = 2;
const MIN_FPS = 0.2;
const MAX_FPS = 5;

export interface DesktopStreamStartInput extends Omit<DesktopCaptureInput, "format"> {
  fps?: number;
  changeThreshold?: number;
}

export interface DesktopStreamStartResult {
  streamId: string;
  frameNumber: number;
  timestamp: string;
}

export interface DesktopStreamFrameResult {
  streamId: string;
  frameNumber: number;
  timestamp: string;
  changed: boolean;
  changeScore: number;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  buffer?: Buffer;
  mimeType?: "image/png";
  error?: string;
}

interface DesktopStreamState {
  streamId: string;
  workspaceId: string;
  captureInput: DesktopCaptureInput;
  fps: number;
  changeThreshold: number;
  interval: NodeJS.Timeout;
  captureInFlight: boolean;
  frameNumber: number;
  lastFrame?: DesktopCaptureFrame;
  lastRawBuffer?: Buffer;
  lastDifference: DesktopFrameDifference;
  lastChangedFrame?: DesktopCaptureFrame;
  lastChangedFrameNumber: number;
  lastDeliveredChangedFrameNumber: number;
  lastError?: string;
}

const streams = new Map<string, DesktopStreamState>();

export async function desktopStreamStart(
  workspaceId: string,
  input: DesktopStreamStartInput,
): Promise<DesktopStreamStartResult> {
  const activeForWorkspace = Array.from(streams.values()).filter((stream) => stream.workspaceId === workspaceId).length;
  if (activeForWorkspace >= MAX_STREAMS_PER_WORKSPACE) {
    throw new Error(`A workspace may have at most ${MAX_STREAMS_PER_WORKSPACE} active desktop streams.`);
  }

  const fps = normalizeFps(input.fps);
  const changeThreshold = normalizeThreshold(input.changeThreshold);
  const streamId = `desktop-${randomUUID()}`;
  const captureInput: DesktopCaptureInput = {
    target: input.target,
    displayId: input.displayId,
    region: input.region,
    windowTitle: input.windowTitle,
    processName: input.processName,
    windowHandle: input.windowHandle,
    windowRegion: input.windowRegion,
    maxWidth: input.maxWidth,
    quality: input.quality,
    format: "png",
  };

  const initial = await captureDesktopFrame(captureInput);
  const state = {} as DesktopStreamState;
  Object.assign(state, {
    streamId,
    workspaceId,
    captureInput,
    fps,
    changeThreshold,
    captureInFlight: false,
    frameNumber: 1,
    lastFrame: initial,
    lastRawBuffer: initial.buffer,
    lastDifference: {
      changed: true,
      score: 1,
      sampledPixels: 0,
      dimensionsChanged: false,
    },
    lastChangedFrame: initial,
    lastChangedFrameNumber: 1,
    lastDeliveredChangedFrameNumber: 0,
  });

  const interval = setInterval(() => {
    void refreshDesktopStream(state);
  }, Math.max(200, Math.round(1000 / fps)));
  interval.unref();
  state.interval = interval;
  streams.set(streamId, state);

  return {
    streamId,
    frameNumber: state.frameNumber,
    timestamp: initial.timestamp,
  };
}

export function desktopStreamFrame(
  workspaceId: string,
  streamId: string,
  includeUnchangedImage = false,
): DesktopStreamFrameResult {
  const state = getOwnedStream(workspaceId, streamId);
  const latest = state.lastFrame;
  if (!latest) {
    throw new Error(state.lastError ?? `Desktop stream ${streamId} has not produced a frame yet.`);
  }

  const changed = state.lastChangedFrameNumber > state.lastDeliveredChangedFrameNumber;
  const imageFrame = changed ? state.lastChangedFrame : includeUnchangedImage ? latest : undefined;
  if (changed) state.lastDeliveredChangedFrameNumber = state.lastChangedFrameNumber;

  return {
    streamId,
    frameNumber: state.frameNumber,
    timestamp: latest.timestamp,
    changed,
    changeScore: state.lastDifference.score,
    sourceWidth: latest.sourceWidth,
    sourceHeight: latest.sourceHeight,
    width: latest.width,
    height: latest.height,
    buffer: imageFrame?.buffer,
    mimeType: imageFrame ? "image/png" : undefined,
    error: state.lastError,
  };
}

export function desktopStreamStop(workspaceId: string, streamId: string): { stopped: true; streamId: string } {
  const state = getOwnedStream(workspaceId, streamId);
  clearInterval(state.interval);
  streams.delete(streamId);
  return { stopped: true, streamId };
}

export function stopDesktopStreamsForWorkspace(workspaceId: string): number {
  let stopped = 0;
  for (const state of streams.values()) {
    if (state.workspaceId !== workspaceId) continue;
    clearInterval(state.interval);
    streams.delete(state.streamId);
    stopped++;
  }
  return stopped;
}

export function activeDesktopStreamCount(workspaceId?: string): number {
  if (!workspaceId) return streams.size;
  return Array.from(streams.values()).filter((stream) => stream.workspaceId === workspaceId).length;
}

export function stopAllDesktopStreams(): number {
  let stopped = 0;
  for (const state of streams.values()) {
    clearInterval(state.interval);
    streams.delete(state.streamId);
    stopped++;
  }
  return stopped;
}

async function refreshDesktopStream(state: DesktopStreamState): Promise<void> {
  if (state.captureInFlight || !streams.has(state.streamId)) return;
  state.captureInFlight = true;
  try {
    const frame = await captureDesktopFrame(state.captureInput);
    const difference = compareDesktopFrames(state.lastRawBuffer, frame.buffer, {
      threshold: state.changeThreshold,
    });
    state.frameNumber++;
    state.lastFrame = frame;
    state.lastRawBuffer = frame.buffer;
    state.lastDifference = difference;
    state.lastError = undefined;
    if (difference.changed) {
      state.lastChangedFrame = frame;
      state.lastChangedFrameNumber = state.frameNumber;
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    state.captureInFlight = false;
  }
}

function getOwnedStream(workspaceId: string, streamId: string): DesktopStreamState {
  const state = streams.get(streamId);
  if (!state || state.workspaceId !== workspaceId) {
    throw new Error(`Unknown desktop stream ${streamId} for this workspace.`);
  }
  return state;
}

function normalizeFps(value: number | undefined): number {
  if (value === undefined) return DEFAULT_FPS;
  if (!Number.isFinite(value) || value < MIN_FPS || value > MAX_FPS) {
    throw new Error(`fps must be between ${MIN_FPS} and ${MAX_FPS}.`);
  }
  return value;
}

function normalizeThreshold(value: number | undefined): number {
  if (value === undefined) return 0.012;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("changeThreshold must be between 0 and 1.");
  }
  return value;
}
