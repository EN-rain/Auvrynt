import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import { getRequestContext } from "../../request-context.js";
import { startDevServer, capturePageScreenshot, inspectPage, testResponsivePage } from "../../web-tools.js";
import {
  browserOpen,
  browserClose,
  browserListSessions,
  browserNavigate,
  browserReload,
  browserGoBack,
  browserGoForward,
  browserSnapshot,
  browserClick,
  browserType,
  browserSelectOption,
  browserHover,
  browserPressKey,
  browserWaitFor,
  browserGetText,
  browserGetAttribute,
  browserIsVisible,
  browserScroll,
  browserConsole,
  browserNetwork,
  browserEvaluate,
  browserScreenshot,
} from "../../integrations/playwright/browser-session.js";
import { compareImages, inspectImage, inspectSprite, splitSpriteSheet } from "../../image-tools.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WEB_READ_ANNOTATIONS,
  WEB_WRITE_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  PROCESS_ANNOTATIONS,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

export function registerWebImageTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  processManager: ProcessManager,
): void {
  registerAppTool(server, "start_dev_server", {
    title: "Start dev server",
    description: "Launch a local web development server as a persistent process. Auto-detects the dev script from the project. Returns a processId for use with get_process_logs and stop_process.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      command: z.string().optional().describe("Override command to run (e.g. 'npm run dev'). Auto-detected if omitted."),
      workingDirectory: z.string().optional().describe("Working directory relative to workspace root."),
      port: z.number().int().optional().describe("Expected port for the dev server."),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, command, workingDirectory, port }) => {
    try {
      const result = await startDevServer(
        workspaces,
        processManager,
        { workspaceId, command, workingDirectory, port },
        getRequestContext()?.ownerClientId,
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `start_dev_server failed: ${message}` }], isError: true };
    }
  });

  registerAppTool(server, "capture_page_screenshot", {
    title: "Capture page screenshot",
    description: "Screenshot a local or remote web page using Playwright. Saves to workspace and returns as MCP image content. Blocks unsafe schemes and SSRF addresses.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      url: z.string().describe("Page URL (http/https only). Local dev URLs like localhost:3000 are allowed."),
      outputPath: z.string().describe("Workspace-relative path to save the screenshot PNG."),
      fullPage: z.boolean().optional().describe("Capture full scrollable page (default false)."),
      viewportWidth: z.number().int().optional().describe("Viewport width in pixels (default 1280, max 3840)."),
      viewportHeight: z.number().int().optional().describe("Viewport height in pixels (default 800, max 2160)."),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().describe("Page load event to wait for."),
      delayMs: z.number().int().optional().describe("Additional delay in ms after load (max 5000)."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: WEB_WRITE_ANNOTATIONS,
  }, ({ workspaceId, url, outputPath, fullPage, viewportWidth, viewportHeight, waitUntil, delayMs }) =>
    capturePageScreenshot(workspaces, { workspaceId, url, outputPath, fullPage, viewportWidth, viewportHeight, waitUntil, delayMs }));

  registerAppTool(server, "inspect_page", {
    title: "Inspect page",
    description: "Inspect DOM structure, headings, buttons, links, and console errors of a web page using Playwright.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      url: z.string().describe("Page URL to inspect."),
      includeAccessibilityTree: z.boolean().optional().describe("Include accessibility tree."),
      includeComputedStyles: z.boolean().optional().describe("Include key computed styles."),
      maxElements: z.number().int().optional().describe("Max elements per category (default 20)."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ workspaceId, url, includeAccessibilityTree, includeComputedStyles, maxElements }) =>
    inspectPage(workspaces, { workspaceId, url, includeAccessibilityTree, includeComputedStyles, maxElements }));

  registerAppTool(server, "test_responsive_page", {
    title: "Test responsive page",
    description: "Capture the same web page across 1–6 bounded viewports using Playwright. Saves PNGs inside the workspace and returns each screenshot for visual comparison.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      url: z.string().describe("Page URL to test."),
      outputDirectory: z.string().describe("Workspace-relative directory for viewport screenshots."),
      viewports: z.array(z.object({ name: z.string(), width: z.number().int(), height: z.number().int() })).max(6).optional().describe("Optional viewport set. Defaults to mobile, tablet, and desktop."),
      fullPage: z.boolean().optional().describe("Capture the full scrollable page (default true)."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: WEB_WRITE_ANNOTATIONS,
  }, ({ workspaceId, url, outputDirectory, viewports, fullPage }) =>
    testResponsivePage(workspaces, { workspaceId, url, outputDirectory, viewports, fullPage }));

  const sessionIdSchema = z.string().describe("Browser session id from browser_open.");
  const selectorSchema = z.string().describe("CSS selector, text=, or Playwright locator string.");

  registerAppTool(server, "browser_open", {
    title: "Open browser session",
    description: "Open a persistent Playwright Chromium session for interactive automation. Returns sessionId for subsequent browser_* tools. Max 4 concurrent sessions; idle sessions expire after 15 minutes.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      url: z.string().optional().describe("Optional initial page URL (http/https)."),
      viewportWidth: z.number().int().optional().describe("Viewport width (default 1280, max 3840)."),
      viewportHeight: z.number().int().optional().describe("Viewport height (default 800, max 2160)."),
      userAgent: z.string().optional().describe("Optional custom user agent."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ workspaceId, url, viewportWidth, viewportHeight, userAgent }) =>
    browserOpen(workspaces, { workspaceId, url, viewportWidth, viewportHeight, userAgent }));

  registerAppTool(server, "browser_close", {
    title: "Close browser session",
    description: "Close a Playwright browser session and free capacity.",
    inputSchema: { sessionId: sessionIdSchema },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId }) => browserClose({ sessionId }));

  registerAppTool(server, "browser_list_sessions", {
    title: "List browser sessions",
    description: "List active Playwright browser sessions, optionally filtered by workspace.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA.optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ workspaceId }) => browserListSessions({ workspaceId }));

  registerAppTool(server, "browser_navigate", {
    title: "Browser navigate",
    description: "Navigate an open browser session to a URL with SSRF protection.",
    inputSchema: {
      sessionId: sessionIdSchema,
      url: z.string().describe("Target page URL (http/https)."),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, url, waitUntil }) => browserNavigate({ sessionId, url, waitUntil }));

  registerAppTool(server, "browser_reload", {
    title: "Browser reload",
    description: "Reload the current page in a browser session.",
    inputSchema: { sessionId: sessionIdSchema },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId }) => browserReload({ sessionId }));

  registerAppTool(server, "browser_go_back", {
    title: "Browser go back",
    description: "Navigate back in browser history.",
    inputSchema: { sessionId: sessionIdSchema },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId }) => browserGoBack({ sessionId }));

  registerAppTool(server, "browser_go_forward", {
    title: "Browser go forward",
    description: "Navigate forward in browser history.",
    inputSchema: { sessionId: sessionIdSchema },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId }) => browserGoForward({ sessionId }));

  registerAppTool(server, "browser_snapshot", {
    title: "Browser snapshot",
    description: "Capture a structured page snapshot: headings, buttons, links, inputs, and optional accessibility tree.",
    inputSchema: {
      sessionId: sessionIdSchema,
      interestingOnly: z.boolean().optional().describe("Accessibility snapshot interesting-only mode (default true)."),
      maxChars: z.number().int().optional().describe("Truncate response text length."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, interestingOnly, maxChars }) => browserSnapshot({ sessionId, interestingOnly, maxChars }));

  registerAppTool(server, "browser_click", {
    title: "Browser click",
    description: "Click an element in an open browser session.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: selectorSchema,
      button: z.enum(["left", "right", "middle"]).optional(),
      clickCount: z.number().int().optional(),
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, button, clickCount, timeoutMs }) =>
    browserClick({ sessionId, selector, button, clickCount, timeoutMs }));

  registerAppTool(server, "browser_type", {
    title: "Browser type",
    description: "Type or fill text into an input/textarea in an open browser session.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: selectorSchema,
      text: z.string().describe("Text to type or fill."),
      clear: z.boolean().optional().describe("Clear existing value first (default true)."),
      delayMs: z.number().int().optional().describe("Per-key delay when clear=false."),
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, text, clear, delayMs, timeoutMs }) =>
    browserType({ sessionId, selector, text, clear, delayMs, timeoutMs }));

  registerAppTool(server, "browser_select_option", {
    title: "Browser select option",
    description: "Select one or more options in a <select> element.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: selectorSchema,
      values: z.union([z.string(), z.array(z.string())]).describe("Option value(s) to select."),
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, values, timeoutMs }) => browserSelectOption({ sessionId, selector, values, timeoutMs }));

  registerAppTool(server, "browser_hover", {
    title: "Browser hover",
    description: "Hover over an element in an open browser session.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: selectorSchema,
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, timeoutMs }) => browserHover({ sessionId, selector, timeoutMs }));

  registerAppTool(server, "browser_press_key", {
    title: "Browser press key",
    description: "Press a keyboard key, optionally focused on a selector.",
    inputSchema: {
      sessionId: sessionIdSchema,
      key: z.string().describe("Key name, e.g. Enter, Tab, Escape, ArrowDown."),
      selector: z.string().optional().describe("Optional element to focus before keypress."),
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, key, selector, timeoutMs }) => browserPressKey({ sessionId, key, selector, timeoutMs }));

  registerAppTool(server, "browser_wait_for", {
    title: "Browser wait",
    description: "Wait for a selector, URL, load state, or a short timeout.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: z.string().optional(),
      url: z.string().optional().describe("URL substring or pattern to wait for."),
      loadState: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
      state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, url, loadState, state, timeoutMs }) =>
    browserWaitFor({ sessionId, selector, url, loadState, state, timeoutMs }));

  registerAppTool(server, "browser_get_text", {
    title: "Browser get text",
    description: "Read textContent of an element.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: selectorSchema,
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, timeoutMs }) => browserGetText({ sessionId, selector, timeoutMs }));

  registerAppTool(server, "browser_get_attribute", {
    title: "Browser get attribute",
    description: "Read an element attribute value.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: selectorSchema,
      name: z.string().describe("Attribute name, e.g. href, value, aria-label."),
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, name, timeoutMs }) => browserGetAttribute({ sessionId, selector, name, timeoutMs }));

  registerAppTool(server, "browser_is_visible", {
    title: "Browser is visible",
    description: "Check whether an element is visible.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: selectorSchema,
      timeoutMs: z.number().int().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, timeoutMs }) => browserIsVisible({ sessionId, selector, timeoutMs }));

  registerAppTool(server, "browser_scroll", {
    title: "Browser scroll",
    description: "Scroll an element into view, or wheel-scroll the page.",
    inputSchema: {
      sessionId: sessionIdSchema,
      selector: z.string().optional().describe("If set, scroll this element into view."),
      deltaX: z.number().optional(),
      deltaY: z.number().optional().describe("Wheel delta Y when no selector (default 600)."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, selector, deltaX, deltaY }) => browserScroll({ sessionId, selector, deltaX, deltaY }));

  registerAppTool(server, "browser_console", {
    title: "Browser console",
    description: "Read console messages captured by the browser session.",
    inputSchema: {
      sessionId: sessionIdSchema,
      clear: z.boolean().optional().describe("Clear stored console logs after reading."),
      types: z.array(z.string()).optional().describe("Filter by console types, e.g. error, warning."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, clear, types }) => browserConsole({ sessionId, clear, types }));

  registerAppTool(server, "browser_network", {
    title: "Browser network",
    description: "Read network requests/responses captured by the browser session, including policy-blocked URLs.",
    inputSchema: {
      sessionId: sessionIdSchema,
      clear: z.boolean().optional().describe("Clear stored network entries after reading."),
      onlyFailed: z.boolean().optional().describe("Only failed or HTTP 4xx/5xx requests."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, clear, onlyFailed }) => browserNetwork({ sessionId, clear, onlyFailed }));

  registerAppTool(server, "browser_evaluate", {
    title: "Browser evaluate",
    description: "Evaluate a short JavaScript expression in the page context. Network/module side effects are blocked.",
    inputSchema: {
      sessionId: sessionIdSchema,
      expression: z.string().describe("Expression to evaluate, e.g. document.title or location.href."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ sessionId, expression }) => browserEvaluate({ sessionId, expression }));

  registerAppTool(server, "browser_screenshot", {
    title: "Browser screenshot",
    description: "Screenshot the current page of an open browser session into the workspace artifact directory.",
    inputSchema: {
      sessionId: sessionIdSchema,
      outputPath: z.string().describe("Workspace-relative PNG path."),
      fullPage: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: WEB_WRITE_ANNOTATIONS,
  }, ({ sessionId, outputPath, fullPage }) => browserScreenshot(workspaces, { sessionId, outputPath, fullPage }));

  registerAppTool(server, "inspect_image", {
    title: "Inspect image",
    description: "Return format, dimensions, file size, alpha capability, and pixel-art likelihood for a local image. Does not resize or recompress.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, path: z.string().describe("Workspace-relative image path.") },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, path }) => inspectImage(workspaces, { workspaceId, path }));

  registerAppTool(server, "compare_images", {
    title: "Compare images",
    description: "Pixel-level comparison of two workspace PNG images. Returns exact and tolerance-based match percentages, changed pixel count, and an optional real diff PNG.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      referencePath: z.string().describe("Reference image path (workspace-relative)."),
      candidatePath: z.string().describe("Candidate image path to compare (workspace-relative)."),
      diffOutputPath: z.string().optional().describe("Workspace-relative path to save the diff image."),
      threshold: z.number().optional().describe("Per-channel tolerance (0–255, default 0)."),
      ignoreTransparentPixels: z.boolean().optional().describe("Skip fully transparent pixels in comparison."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, referencePath, candidatePath, diffOutputPath, threshold, ignoreTransparentPixels }) =>
    compareImages(workspaces, { workspaceId, referencePath, candidatePath, diffOutputPath, threshold, ignoreTransparentPixels }));

  registerAppTool(server, "inspect_sprite", {
    title: "Inspect sprite",
    description: "Analyze image dimensions against an expected sprite-cell size and report the resulting grid and divisibility.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      path: z.string().describe("Workspace-relative image path."),
      expectedCellWidth: z.number().int().optional().describe("Expected cell width for grid detection."),
      expectedCellHeight: z.number().int().optional().describe("Expected cell height for grid detection."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, path, expectedCellWidth, expectedCellHeight }) =>
    inspectSprite(workspaces, { workspaceId, path, expectedCellWidth, expectedCellHeight }));

  registerAppTool(server, "split_sprite_sheet", {
    title: "Split sprite sheet",
    description: "Split a PNG sprite sheet into real cropped frame PNGs inside the managed artifact directory. Rejects unsafe filenames and does not overwrite existing files.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      path: z.string().describe("Workspace-relative sprite sheet path."),
      columns: z.number().int().describe("Number of columns."),
      rows: z.number().int().describe("Number of rows."),
      outputDirectory: z.string().describe("Workspace-relative output directory."),
      namingPattern: z.string().optional().describe("Frame filename pattern with {col} and {row} placeholders."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, path, columns, rows, outputDirectory, namingPattern }) =>
    splitSpriteSheet(workspaces, { workspaceId, path, columns, rows, outputDirectory, namingPattern }));
}
