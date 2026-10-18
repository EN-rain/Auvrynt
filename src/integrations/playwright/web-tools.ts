import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import { inspectProject } from "../../search-discovery.js";
import type { ToolResponse } from "../../pi-tools.js";
import {
  assertSafeResolvedHost,
  assertSafeWebUrl,
  isExplicitLocalHost,
  normalizedHostname,
  parseWebUrl,
  validateWebUrl,
} from "../../infrastructure/network-security.js";
export { assertSafeWebUrl, validateWebUrl } from "../../infrastructure/network-security.js";
import { loadPlaywright } from "./playwright-runtime.js";
import {
  closeBrowserWithDeadline,
  settleWithin,
  shouldEmbedScreenshot,
  type ClosableBrowserLike,
} from "./browser-stability.js";

export interface StartDevServerInput {
  workspaceId: string;
  command?: string;
  workingDirectory?: string;
  port?: number;
}

export interface CapturePageScreenshotInput {
  workspaceId: string;
  url: string;
  outputPath: string;
  fullPage?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  delayMs?: number;
}

export interface InspectPageInput {
  workspaceId: string;
  url: string;
  includeAccessibilityTree?: boolean;
  includeComputedStyles?: boolean;
  maxElements?: number;
}

export interface TestResponsivePageInput {
  workspaceId: string;
  url: string;
  outputDirectory: string;
  viewports?: Array<{
    name: string;
    width: number;
    height: number;
  }>;
  fullPage?: boolean;
}

interface PlaywrightRequestLike {
  url(): string;
  failure(): { errorText?: string } | null;
}

interface PlaywrightConsoleLike {
  type(): string;
  text(): string;
}

interface PlaywrightRouteLike {
  request(): PlaywrightRequestLike;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

interface PlaywrightWebSocketRouteLike {
  url(): string;
  connectToServer(): unknown;
  close(options?: { code?: number; reason?: string }): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  route(pattern: string, handler: (route: PlaywrightRouteLike) => Promise<void>): Promise<void>;
  routeWebSocket(pattern: string, handler: (route: PlaywrightWebSocketRouteLike) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

interface PageLike {
  on(event: "console", handler: (message: PlaywrightConsoleLike) => void): void;
  on(event: "requestfailed", handler: (request: PlaywrightRequestLike) => void): void;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { fullPage: boolean; type: "png" }): Promise<Buffer>;
  title(): Promise<string>;
  evaluate<TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg): Promise<TResult>;
}

interface BrowserLike extends ClosableBrowserLike {
  newContext(options: { viewport: { width: number; height: number }; serviceWorkers?: "block" }): Promise<BrowserContextLike>;
}

interface PlaywrightLike {
  chromium: {
    launch(options: { headless: boolean; args?: string[]; channel?: string }): Promise<BrowserLike>;
  };
}

const MAX_BROWSER_JOBS = 4;
const MAX_BROWSER_DIAGNOSTICS = 100;
const BROWSER_CONTEXT_CLOSE_TIMEOUT_MS = 3_000;
const BROWSER_CLOSE_TIMEOUT_MS = 8_000;
const MAX_INLINE_SCREENSHOT_BYTES = 512 * 1024;
const MAX_INLINE_RESPONSIVE_BYTES = 1024 * 1024;
const LAUNCH_ARGS = [
  "--disable-gpu",
  "--disable-breakpad",
  "--disable-crash-reporter",
  "--noerrdialogs",
];
const LAUNCH_OPTIONS = {
  headless: true,
  args: LAUNCH_ARGS,
  ...(process.platform === "win32" ? { channel: "chromium" } : {}),
};
let activeBrowserJobs = 0;

async function closeContextWithTimeout(context: BrowserContextLike | undefined): Promise<void> {
  if (!context) return;
  await settleWithin(() => context.close(), BROWSER_CONTEXT_CLOSE_TIMEOUT_MS);
}

async function closeBrowserWithTimeout(browser: BrowserLike | undefined): Promise<void> {
  await closeBrowserWithDeadline(browser, BROWSER_CLOSE_TIMEOUT_MS);
}

function inlineScreenshotContent(buffer: Buffer, label: string): ToolResponse["content"] {
  if (shouldEmbedScreenshot(
    buffer.length,
    0,
    MAX_INLINE_SCREENSHOT_BYTES,
    MAX_INLINE_SCREENSHOT_BYTES,
  )) {
    return [{ type: "image", data: buffer.toString("base64"), mimeType: "image/png" }];
  }
  return [{
    type: "text",
    text: `${label} was saved, but its ${buffer.length}-byte PNG was not embedded because it exceeded the stable MCP inline-image limit.`,
  }];
}

function acquireBrowserSlot(): () => void {
  if (activeBrowserJobs >= MAX_BROWSER_JOBS) {
    throw new Error(`Browser capacity reached (max ${MAX_BROWSER_JOBS} concurrent jobs).`);
  }
  activeBrowserJobs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeBrowserJobs = Math.max(0, activeBrowserJobs - 1);
  };
}

async function assertSafeWebSocketUrl(urlStr: string, allowLoopback: boolean): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid WebSocket URL format: ${urlStr}`);
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(`Blocked WebSocket scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("Blocked WebSocket URL containing embedded credentials.");
  }
  await assertSafeResolvedHost(parsed, allowLoopback);
}

async function installRequestGuard(
  context: BrowserContextLike,
  initialUrl: string,
  blockedRequests: string[],
): Promise<string> {
  const parsed = parseWebUrl(initialUrl);
  const allowLoopback = isExplicitLocalHost(normalizedHostname(parsed));
  const safeInitialUrl = await assertSafeWebUrl(initialUrl, allowLoopback);

  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    try {
      const parsedRequest = new URL(requestUrl);
      if (["data:", "blob:", "about:"].includes(parsedRequest.protocol)) {
        await route.continue();
        return;
      }
      await assertSafeWebUrl(requestUrl, allowLoopback);
      await route.continue();
    } catch (error) {
      if (blockedRequests.length < MAX_BROWSER_DIAGNOSTICS) {
        const reason = error instanceof Error ? error.message : String(error);
        blockedRequests.push(`${requestUrl} (${reason})`);
      }
      await route.abort("blockedbyclient");
    }
  });

  await context.routeWebSocket("**/*", async (webSocket) => {
    const socketUrl = webSocket.url();
    try {
      await assertSafeWebSocketUrl(socketUrl, allowLoopback);
      webSocket.connectToServer();
    } catch (error) {
      if (blockedRequests.length < MAX_BROWSER_DIAGNOSTICS) {
        const reason = error instanceof Error ? error.message : String(error);
        blockedRequests.push(`${socketUrl} (${reason})`);
      }
      await webSocket.close({ code: 1008, reason: "Blocked by Auvrynt network policy" });
    }
  });

  return safeInitialUrl;
}

export async function startDevServer(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: StartDevServerInput,
  ownerClientId?: string,
): Promise<{
  processId: string;
  command: string;
  status: string;
  detectedUrls: string[];
  recentOutput: string[];
}> {
  let command = input.command;

  if (!command) {
    const summary = await inspectProject(registry, {
      workspaceId: input.workspaceId,
      path: input.workingDirectory,
    });
    command = summary.recommendedCommands.run;
    if (!command) {
      throw new Error("No development run command detected in project. Please specify command parameter.");
    }
  }

  const result = processManager.startProcess({
    workspaceId: input.workspaceId,
    ownerClientId,
    command,
    workingDirectory: input.workingDirectory,
  });

  return {
    processId: result.processId,
    command,
    status: result.status,
    detectedUrls: result.detectedUrls,
    recentOutput: result.recentOutput,
  };
}

export async function capturePageScreenshot(
  registry: WorkspaceRegistry,
  input: CapturePageScreenshotInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const validatedUrl = validateWebUrl(input.url);
  const absoluteOutputPath = registry.resolveArtifactPath(workspace, input.outputPath, "playwright");

  let playwright: PlaywrightLike;
  try {
    playwright = await loadPlaywright() as PlaywrightLike;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: "text",
        text: `Playwright browser support is unavailable: ${message}. Run 'auvrynt start' to repair it automatically.`,
      }],
      isError: true,
    };
  }

  let releaseSlot: (() => void) | undefined;
  let browser: BrowserLike | undefined;
  let context: BrowserContextLike | undefined;
  try {
    releaseSlot = acquireBrowserSlot();
    const width = Math.min(Math.max(input.viewportWidth ?? 1280, 320), 3840);
    const height = Math.min(Math.max(input.viewportHeight ?? 800, 240), 2160);

    browser = await playwright.chromium.launch(LAUNCH_OPTIONS);
    context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    const blockedRequests: string[] = [];
    const safeUrl = await installRequestGuard(context, validatedUrl, blockedRequests);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error" && consoleErrors.length < MAX_BROWSER_DIAGNOSTICS) consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req) => {
      if (failedRequests.length < MAX_BROWSER_DIAGNOSTICS) {
        failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? "failed"})`);
      }
    });

    await page.goto(safeUrl, {
      waitUntil: input.waitUntil ?? "domcontentloaded",
      timeout: 15_000,
    });

    if (input.delayMs && input.delayMs > 0) {
      await page.waitForTimeout(Math.min(input.delayMs, 5_000));
    }

    await mkdir(dirname(absoluteOutputPath), { recursive: true });
    const buffer = await page.screenshot({ fullPage: input.fullPage ?? false, type: "png" });
    await writeFile(absoluteOutputPath, buffer);
    const relPath = relative(workspace.root, absoluteOutputPath).replace(/\\/g, "/");

    return {
      content: [
        ...inlineScreenshotContent(buffer, `Screenshot ${relPath}`),
        {
          type: "text",
          text: `Saved screenshot to ${relPath}${consoleErrors.length > 0 ? `\nConsole Errors: ${consoleErrors.join("; ")}` : ""}${failedRequests.length > 0 ? `\nFailed Requests: ${failedRequests.join("; ")}` : ""}${blockedRequests.length > 0 ? `\nBlocked Requests: ${blockedRequests.join("; ")}` : ""}`,
        },
      ],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Browser screenshot failed: ${msg}` }], isError: true };
  } finally {
    await closeContextWithTimeout(context);
    await closeBrowserWithTimeout(browser);
    releaseSlot?.();
  }
}

export async function inspectPage(
  registry: WorkspaceRegistry,
  input: InspectPageInput,
): Promise<ToolResponse> {
  registry.getWorkspace(input.workspaceId);
  const validatedUrl = validateWebUrl(input.url);

  let playwright: PlaywrightLike;
  try {
    playwright = await loadPlaywright() as PlaywrightLike;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: "text",
        text: `Playwright browser support is unavailable: ${message}. Run 'auvrynt start' to repair it automatically.`,
      }],
      isError: true,
    };
  }

  let releaseSlot: (() => void) | undefined;
  let browser: BrowserLike | undefined;
  let context: BrowserContextLike | undefined;
  try {
    releaseSlot = acquireBrowserSlot();
    browser = await playwright.chromium.launch(LAUNCH_OPTIONS);
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    const blockedRequests: string[] = [];
    const safeUrl = await installRequestGuard(context, validatedUrl, blockedRequests);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error" && consoleErrors.length < MAX_BROWSER_DIAGNOSTICS) consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req) => {
      if (failedRequests.length < MAX_BROWSER_DIAGNOSTICS) {
        failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? "failed"})`);
      }
    });

    await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const title = await page.title();
    const maxElements = Math.min(Math.max(input.maxElements ?? 20, 1), 100);

    const elementsSummary = await page.evaluate((maxElem) => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .slice(0, maxElem)
        .map((el) => `${el.tagName}: ${el.textContent?.trim()}`);
      const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit']"))
        .slice(0, maxElem)
        .map((el) => el.textContent?.trim() || (el as HTMLInputElement).value || "button");
      const links = Array.from(document.querySelectorAll("a[href]"))
        .slice(0, maxElem)
        .map((el) => `${el.textContent?.trim() || "link"} -> ${(el as HTMLAnchorElement).href}`);
      return { headings, buttons, links };
    }, maxElements);

    const accessibility = input.includeAccessibilityTree
      ? await page.evaluate((maxElem) => Array.from(document.querySelectorAll(
          "[role], button, a[href], input, select, textarea, h1, h2, h3, h4, h5, h6",
        )).slice(0, maxElem).map((el) => ({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          label: el.getAttribute("aria-label"),
          text: el.textContent?.trim().slice(0, 160) || null,
          disabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
        })), maxElements)
      : undefined;

    const computedStyles = input.includeComputedStyles
      ? await page.evaluate((maxElem) => Array.from(document.querySelectorAll("body, h1, h2, h3, button, a, input"))
          .slice(0, maxElem)
          .map((el) => {
            const styles = getComputedStyle(el);
            return {
              element: el.tagName.toLowerCase(),
              display: styles.display,
              position: styles.position,
              color: styles.color,
              backgroundColor: styles.backgroundColor,
              fontSize: styles.fontSize,
              fontFamily: styles.fontFamily,
            };
          }), maxElements)
      : undefined;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          url: safeUrl,
          title,
          elements: elementsSummary,
          accessibility,
          computedStyles,
          consoleErrors,
          failedRequests,
          blockedRequests,
        }, null, 2),
      }],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Inspect page failed: ${msg}` }], isError: true };
  } finally {
    await closeContextWithTimeout(context);
    await closeBrowserWithTimeout(browser);
    releaseSlot?.();
  }
}

export async function testResponsivePage(
  registry: WorkspaceRegistry,
  input: TestResponsivePageInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const validatedUrl = validateWebUrl(input.url);
  const outputDirectory = registry.resolveArtifactPath(workspace, input.outputDirectory, "playwright");
  const requestedViewports = input.viewports ?? [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];
  if (requestedViewports.length < 1 || requestedViewports.length > 6) {
    return { content: [{ type: "text", text: "Responsive testing requires 1 to 6 viewports." }], isError: true };
  }

  const viewports = requestedViewports.map((viewport, index) => ({
    name: viewport.name.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || `viewport_${index + 1}`,
    width: Math.min(Math.max(Math.trunc(viewport.width), 240), 3840),
    height: Math.min(Math.max(Math.trunc(viewport.height), 240), 2160),
  }));
  const names = new Set(viewports.map((viewport) => viewport.name.toLowerCase()));
  if (names.size !== viewports.length) {
    return { content: [{ type: "text", text: "Responsive viewport names must be unique after filename sanitization." }], isError: true };
  }

  let playwright: PlaywrightLike;
  try {
    playwright = await loadPlaywright() as PlaywrightLike;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Playwright browser support is unavailable: ${message}. Run 'auvrynt start' to repair it automatically.` }],
      isError: true,
    };
  }

  let releaseSlot: (() => void) | undefined;
  let browser: BrowserLike | undefined;
  try {
    releaseSlot = acquireBrowserSlot();
    browser = await playwright.chromium.launch(LAUNCH_OPTIONS);
    await mkdir(outputDirectory, { recursive: true });
    const content: ToolResponse["content"] = [];
    const results: Array<{ name: string; width: number; height: number; path: string; blockedRequests: string[] }> = [];
    let inlineScreenshotBytes = 0;

    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
      try {
        const blockedRequests: string[] = [];
        const safeUrl = await installRequestGuard(context, validatedUrl, blockedRequests);
        const page = await context.newPage();
        await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
        const buffer = await page.screenshot({ fullPage: input.fullPage ?? true, type: "png" });
        const outputPath = join(outputDirectory, `${viewport.name}.png`);
        await writeFile(outputPath, buffer);
        const relPath = relative(workspace.root, outputPath).replace(/\\/g, "/");
        results.push({ ...viewport, path: relPath, blockedRequests });
        if (shouldEmbedScreenshot(
          buffer.length,
          inlineScreenshotBytes,
          MAX_INLINE_SCREENSHOT_BYTES,
          MAX_INLINE_RESPONSIVE_BYTES,
        )) {
          inlineScreenshotBytes += buffer.length;
          content.push({ type: "image", data: buffer.toString("base64"), mimeType: "image/png" });
        } else {
          content.push({
            type: "text",
            text: `${viewport.name} screenshot was saved but not embedded (${buffer.length} bytes) to keep the MCP response stable.`,
          });
        }
        content.push({ type: "text", text: `${viewport.name}: ${viewport.width}x${viewport.height} → ${relPath}` });
      } finally {
        await closeContextWithTimeout(context);
      }
    }

    content.push({ type: "text", text: JSON.stringify({ url: validatedUrl, results }, null, 2) });
    return { content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Responsive page test failed: ${message}` }], isError: true };
  } finally {
    await closeBrowserWithTimeout(browser);
    releaseSlot?.();
  }
}
