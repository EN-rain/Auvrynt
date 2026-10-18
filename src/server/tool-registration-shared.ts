import * as z from "zod/v4";
import type { ServerConfig, WidgetMode } from "../config.js";

export const WORKSPACE_ID_SCHEMA = z.string().describe("Workspace identifier returned by open_workspace.");

export const VIEW_IMAGE_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const PROCESS_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const MUTATING_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
export const WEB_READ_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
export const WEB_WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
export const WRITE_TOOL_ANNOTATIONS = MUTATING_ANNOTATIONS;
export const EDIT_TOOL_ANNOTATIONS = MUTATING_ANNOTATIONS;
export const SHELL_TOOL_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

export const WORKSPACE_APP_URI = "ui://auvrynt/workspace-app-v3.html";

type ToolWidgetKind =
  | "workspace"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "directory"
  | "shell"
  | "show_changes";

function shouldAttachWidget(mode: WidgetMode, kind: ToolWidgetKind): boolean {
  switch (mode) {
    case "off":
    case "compact":
      return false;
    case "changes":
      return kind === "show_changes";
    case "full":
      return true;
  }
}

function shouldAttachInvocationText(mode: WidgetMode): boolean {
  return mode !== "off";
}

const TOOL_INVOCATION_COPY: Record<ToolWidgetKind, { invoking: string; invoked: string }> = {
  workspace: { invoking: "Opening workspace…", invoked: "Workspace ready" },
  read: { invoking: "Reading…", invoked: "Read complete" },
  write: { invoking: "Writing…", invoked: "Write complete" },
  edit: { invoking: "Applying edit…", invoked: "Edit applied" },
  search: { invoking: "Searching…", invoked: "Search complete" },
  directory: { invoking: "Listing files…", invoked: "Files ready" },
  shell: { invoking: "Running command…", invoked: "Command complete" },
  show_changes: { invoking: "Reviewing changes…", invoked: "Changes ready" },
};

export function toolWidgetDescriptorMeta(config: ServerConfig, kind: ToolWidgetKind): {
  _meta: Record<string, unknown>;
} {
  if (!shouldAttachInvocationText(config.widgets)) return { _meta: {} };

  const invocation = TOOL_INVOCATION_COPY[kind];
  const meta: Record<string, unknown> = {
    "openai/toolInvocation/invoking": invocation.invoking,
    "openai/toolInvocation/invoked": invocation.invoked,
  };

  if (shouldAttachWidget(config.widgets, kind)) {
    meta.ui = {
      resourceUri: WORKSPACE_APP_URI,
      visibility: ["model", "app"],
    };
    meta["openai/outputTemplate"] = WORKSPACE_APP_URI;
  }

  return { _meta: meta };
}

export function resultOutputSchema(extra: z.ZodRawShape = {}): z.ZodRawShape {
  return {
    result: z.string().describe("Model-readable result text for follow-up reasoning and plain MCP hosts."),
    ...extra,
  };
}
