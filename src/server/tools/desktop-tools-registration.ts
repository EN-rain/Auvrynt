import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import { inlineImageOrNotice } from "../../tool-result-budget.js";
import { captureDesktopFrame, type DesktopCaptureFrame } from "../../integrations/desktop/desktop-capture.js";
import { listDesktopDisplays } from "../../integrations/desktop/desktop-displays.js";
import {
  activeDesktopStreamCount,
  desktopStreamFrame,
  desktopStreamStart,
  desktopStreamStop,
  stopDesktopStreamsForWorkspace,
} from "../../integrations/desktop/desktop-stream.js";
import {
  desktopControlResume,
  desktopEmergencyStop,
  desktopKeyDown,
  desktopKeyPress,
  desktopKeyUp,
  desktopMouseClick,
  desktopMouseDrag,
  desktopMouseMove,
  desktopMouseScroll,
  desktopType,
} from "../../integrations/desktop/desktop-input.js";
import { ensureDesktopIndicator, stopDesktopIndicator } from "../../integrations/desktop/desktop-indicator.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  PROCESS_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

const captureTargetSchema = z.enum(["display", "region", "app-window"]);
const captureFormatSchema = z.enum(["png", "jpeg"]);
const regionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const displayIdSchema = z.string().min(1).max(64).optional();
const windowTitleSchema = z.string().min(1).max(256).optional();
const processNameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional();
const windowHandleSchema = z.string().regex(/^[0-9]{1,20}$/).optional();
const focusPolicySchema = z.enum(["foreground", "foreground-restore"]).optional().describe("Input must foreground the target; foreground-restore returns focus to the previously active window when possible.");
const captureAfterSchema = z.boolean().optional().describe("Capture the target app/display after the input action and return the image in the same MCP call.");

export function registerDesktopTools(server: McpServer, config: ServerConfig): void {
  registerAppTool(server, "desktop_list_displays", {
    title: "List desktop displays",
    description: "Enumerate Windows displays with stable per-call IDs, bounds, primary status, and system scale. Desktop access must be explicitly enabled.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => jsonResult({ displays: await listDesktopDisplays() }));

  registerAppTool(server, "desktop_capture", {
    title: "Capture desktop",
    description: "Capture an explicitly selected display, display-relative region, or named application window. Returns image content without persisting a workspace artifact by default.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      target: captureTargetSchema,
      displayId: displayIdSchema,
      region: regionSchema.optional(),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      maxWidth: z.number().int().min(320).max(3840).optional(),
      format: captureFormatSchema.optional(),
      quality: z.number().int().min(20).max(95).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ target, displayId, region, windowTitle, processName, windowHandle, maxWidth, format, quality }) => {
    try {
      return captureFrameResult(await captureDesktopFrame({ target, displayId, region, windowTitle, processName, windowHandle, maxWidth, format, quality }));
    } catch (error) {
      return errorResult(error);
    }
  });

  registerAppTool(server, "desktop_stream_start", {
    title: "Start desktop latest-frame stream",
    description: "Start a bounded local capture worker. The model does not receive continuous video; desktop_stream_frame returns only the newest meaningful frame when change detection finds a useful update.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      target: captureTargetSchema.default("display"),
      displayId: displayIdSchema,
      region: regionSchema.optional(),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      fps: z.number().min(0.2).max(5).optional(),
      maxWidth: z.number().int().min(320).max(3840).optional(),
      quality: z.number().int().min(20).max(95).optional(),
      changeThreshold: z.number().min(0).max(1).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "shell"),
    annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, target, displayId, region, windowTitle, processName, windowHandle, fps, maxWidth, quality, changeThreshold }) => {
    try {
      const result = await desktopStreamStart(workspaceId, {
        target,
        displayId,
        region,
        windowTitle,
        processName,
        windowHandle,
        fps,
        maxWidth,
        quality,
        changeThreshold,
      });
      ensureDesktopIndicator(workspaceId);
      return jsonResult(result);
    } catch (error) {
      return errorResult(error);
    }
  });

  registerAppTool(server, "desktop_stream_frame", {
    title: "Read latest desktop stream frame",
    description: "Return stream metadata and image content only when a meaningful change has not yet been delivered. Set includeUnchangedImage=true to force the latest image.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      streamId: z.string().min(1).max(128),
      includeUnchangedImage: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, streamId, includeUnchangedImage }) => {
    try {
      const frame = desktopStreamFrame(workspaceId, streamId, includeUnchangedImage ?? false);
      const metadata = {
        streamId: frame.streamId,
        frameNumber: frame.frameNumber,
        timestamp: frame.timestamp,
        changed: frame.changed,
        changeScore: frame.changeScore,
        sourceWidth: frame.sourceWidth,
        sourceHeight: frame.sourceHeight,
        width: frame.width,
        height: frame.height,
        error: frame.error,
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
          ...(frame.buffer && frame.mimeType
            ? inlineImageOrNotice(frame.buffer, `Desktop stream ${streamId} frame ${frame.frameNumber}`, frame.mimeType)
            : []),
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  registerAppTool(server, "desktop_stream_stop", {
    title: "Stop desktop stream",
    description: "Stop a desktop latest-frame worker and release its in-memory frame cache.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, streamId: z.string().min(1).max(128) },
    ...toolWidgetDescriptorMeta(config, "shell"),
    annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, streamId }) => {
    try {
      const result = desktopStreamStop(workspaceId, streamId);
      if (activeDesktopStreamCount(workspaceId) === 0) stopDesktopIndicator(workspaceId);
      return jsonResult(result);
    } catch (error) {
      return errorResult(error);
    }
  });

  registerPointerTools(server, config);
  registerKeyboardTools(server, config);

  registerAppTool(server, "desktop_emergency_stop", {
    title: "Emergency-stop desktop control",
    description: "Immediately disable further desktop input for this workspace, stop its desktop streams, and remove the local control indicator.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId }) => {
    const input = desktopEmergencyStop(workspaceId);
    const streamsStopped = stopDesktopStreamsForWorkspace(workspaceId);
    stopDesktopIndicator(workspaceId);
    return jsonResult({ ...input, streamsStopped });
  });

  registerAppTool(server, "desktop_control_resume", {
    title: "Resume desktop control",
    description: "Re-enable bounded desktop input after an explicit desktop_emergency_stop. The visible indicator appears again only when control or streaming is used.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId }) => jsonResult(desktopControlResume(workspaceId)));
}

function registerPointerTools(server: McpServer, config: ServerConfig): void {
  registerAppTool(server, "desktop_mouse_move", {
    title: "Move desktop mouse",
    description: "Move the pointer to display-relative coordinates. Requires an explicit displayId.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      displayId: z.string().min(1).max(64),
      x: z.number().int(),
      y: z.number().int(),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      focusPolicy: focusPolicySchema,
      captureAfter: captureAfterSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, displayId, x, y, windowTitle, processName, windowHandle, focusPolicy, captureAfter }) => inputActionResult(
    workspaceId,
    () => desktopMouseMove(workspaceId, { displayId, x, y, windowTitle, processName, windowHandle, focusPolicy }),
    captureAfter,
    { displayId, windowTitle, processName, windowHandle },
  ));

  registerAppTool(server, "desktop_mouse_click", {
    title: "Click desktop mouse",
    description: "Click at display-relative coordinates with bounded left/right/middle button support.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      displayId: z.string().min(1).max(64),
      x: z.number().int(),
      y: z.number().int(),
      button: z.enum(["left", "right", "middle"]).optional(),
      clickCount: z.number().int().min(1).max(3).optional(),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      focusPolicy: focusPolicySchema,
      captureAfter: captureAfterSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, displayId, x, y, button, clickCount, windowTitle, processName, windowHandle, focusPolicy, captureAfter }) => inputActionResult(
    workspaceId,
    () => desktopMouseClick(workspaceId, { displayId, x, y, button, clickCount, windowTitle, processName, windowHandle, focusPolicy }),
    captureAfter,
    { displayId, windowTitle, processName, windowHandle },
  ));

  registerAppTool(server, "desktop_mouse_drag", {
    title: "Drag desktop mouse",
    description: "Perform a bounded display-relative drag for organic strokes, lasso gestures, or controls with no semantic helper.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      displayId: z.string().min(1).max(64),
      startX: z.number().int(),
      startY: z.number().int(),
      endX: z.number().int(),
      endY: z.number().int(),
      button: z.enum(["left", "right", "middle"]).optional(),
      durationMs: z.number().int().min(0).max(10_000).optional(),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      focusPolicy: focusPolicySchema,
      captureAfter: captureAfterSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, displayId, startX, startY, endX, endY, button, durationMs, windowTitle, processName, windowHandle, focusPolicy, captureAfter }) => inputActionResult(
    workspaceId,
    () => desktopMouseDrag(workspaceId, { displayId, startX, startY, endX, endY, button, durationMs, windowTitle, processName, windowHandle, focusPolicy }),
    captureAfter,
    { displayId, windowTitle, processName, windowHandle },
  ));

  registerAppTool(server, "desktop_mouse_scroll", {
    title: "Scroll desktop mouse",
    description: "Send bounded vertical or horizontal wheel deltas to an optional named target window.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      deltaY: z.number().int().min(-12_000).max(12_000).optional(),
      deltaX: z.number().int().min(-12_000).max(12_000).optional(),
      displayId: displayIdSchema,
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      focusPolicy: focusPolicySchema,
      captureAfter: captureAfterSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, deltaY, deltaX, displayId, windowTitle, processName, windowHandle, focusPolicy, captureAfter }) => inputActionResult(
    workspaceId,
    () => desktopMouseScroll(workspaceId, { deltaY, deltaX, displayId, windowTitle, processName, windowHandle, focusPolicy }),
    captureAfter,
    { displayId, windowTitle, processName, windowHandle },
  ));
}

function registerKeyboardTools(server: McpServer, config: ServerConfig): void {
  registerAppTool(server, "desktop_key_press", {
    title: "Press desktop keys",
    description: "Press a key or key chord using a bounded virtual-key allowlist. Prefer setting windowTitle so input is focused into the intended app.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      keys: z.array(z.string().min(1).max(32)).min(1).max(8),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      displayId: displayIdSchema,
      focusPolicy: focusPolicySchema,
      captureAfter: captureAfterSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, keys, windowTitle, processName, windowHandle, displayId, focusPolicy, captureAfter }) => inputActionResult(
    workspaceId,
    () => desktopKeyPress(workspaceId, keys, windowTitle, windowHandle, processName, { focusPolicy }),
    captureAfter,
    { displayId, windowTitle, processName, windowHandle },
  ));

  registerAppTool(server, "desktop_key_down", {
    title: "Hold desktop key",
    description: "Press and hold one supported virtual key. Pair with desktop_key_up.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      key: z.string().min(1).max(32),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      displayId: displayIdSchema,
      focusPolicy: focusPolicySchema,
      captureAfter: captureAfterSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, key, windowTitle, processName, windowHandle, displayId, focusPolicy, captureAfter }) => inputActionResult(
    workspaceId,
    () => desktopKeyDown(workspaceId, key, windowTitle, windowHandle, processName, { focusPolicy }),
    captureAfter,
    { displayId, windowTitle, processName, windowHandle },
  ));

  registerAppTool(server, "desktop_key_up", {
    title: "Release desktop key",
    description: "Release one supported virtual key previously held with desktop_key_down.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      key: z.string().min(1).max(32),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      displayId: displayIdSchema,
      focusPolicy: focusPolicySchema,
      captureAfter: captureAfterSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, key, windowTitle, processName, windowHandle, displayId, focusPolicy, captureAfter }) => inputActionResult(
    workspaceId,
    () => desktopKeyUp(workspaceId, key, windowTitle, windowHandle, processName, { focusPolicy }),
    captureAfter,
    { displayId, windowTitle, processName, windowHandle },
  ));

  registerAppTool(server, "desktop_type", {
    title: "Type desktop text",
    description: "Type literal Unicode text through Windows SendInput. Prefer setting windowTitle to focus the intended target before typing.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      text: z.string().max(8_192),
      windowTitle: windowTitleSchema,
      processName: processNameSchema,
      windowHandle: windowHandleSchema,
      displayId: displayIdSchema,
      focusPolicy: focusPolicySchema,
      captureAfter: captureAfterSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, text, windowTitle, processName, windowHandle, displayId, focusPolicy, captureAfter }) => inputActionResult(
    workspaceId,
    () => desktopType(workspaceId, text, windowTitle, windowHandle, processName, { focusPolicy }),
    captureAfter,
    { displayId, windowTitle, processName, windowHandle },
  ));
}

async function inputActionResult(
  workspaceId: string,
  action: () => Promise<unknown>,
  captureAfter: boolean | undefined,
  targeting: { displayId?: string; windowTitle?: string; processName?: string; windowHandle?: string },
) {
  try {
    ensureDesktopIndicator(workspaceId);
    const result = await action();
    if (!captureAfter) return jsonResult(result);
    const capture = targeting.windowTitle
      ? await captureDesktopFrame({ target: "app-window", windowTitle: targeting.windowTitle, processName: targeting.processName, windowHandle: targeting.windowHandle, maxWidth: 1600, format: "png" })
      : targeting.displayId
        ? await captureDesktopFrame({ target: "display", displayId: targeting.displayId, maxWidth: 1600, format: "png" })
        : undefined;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ...(capture ? captureFrameContent(capture) : [{
          type: "text" as const,
          text: "captureAfter requested, but neither windowTitle nor displayId was supplied for a bounded capture target.",
        }]),
      ],
    };
  } catch (error) {
    return errorResult(error);
  }
}

function captureFrameResult(frame: DesktopCaptureFrame) {
  return { content: captureFrameContent(frame) };
}

function captureFrameContent(frame: DesktopCaptureFrame) {
  return [
    {
      type: "text" as const,
      text: JSON.stringify({
        target: frame.target,
        displayId: frame.displayId,
        timestamp: frame.timestamp,
        sourceWidth: frame.sourceWidth,
        sourceHeight: frame.sourceHeight,
        width: frame.width,
        height: frame.height,
        bounds: frame.bounds,
        processName: frame.processName,
        processId: frame.processId,
        windowHandle: frame.windowHandle,
        windowTitle: frame.windowTitle,
        captureBackend: frame.captureBackend,
        occlusionSafe: frame.occlusionSafe,
        foregroundWindowHandleBefore: frame.foregroundWindowHandleBefore,
        foregroundWindowHandleAfter: frame.foregroundWindowHandleAfter,
      }, null, 2),
    },
    ...inlineImageOrNotice(frame.buffer, `Desktop ${frame.target} capture`, frame.mimeType),
  ];
}

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true as const,
  };
}
