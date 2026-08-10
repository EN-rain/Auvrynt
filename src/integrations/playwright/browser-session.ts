import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ToolResponse } from "../../pi-tools.js";
import { loadPlaywright } from "./playwright-runtime.js";
import {
  closeBrowserWithDeadline,
  settleWithin,
  shouldEmbedScreenshot,
  type ClosableBrowserLike,
} from "./browser-stability.js";
import { assertSafeWebUrl, validateWebUrl } from "./web-tools.js";

const MAX_SESSIONS = 4;
const SESSION_TTL_MS = 15 * 60_000;
const MAX_DIAGNOSTICS = 100;
const MAX_INLINE_SCREENSHOT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const CLOSE_CTX_MS = 3_000;
const CLOSE_BR_MS = 8_000;
const LAUNCH_OPTIONS = {
  headless: true,
  args: ["--disable-gpu", "--disable-breakpad", "--disable-crash-reporter", "--noerrdialogs"],
  ...(process.platform === "win32" ? { channel: "chromium" as const } : {}),
};

type AnyPage = any;
type AnyContext = any;
type AnyBrowser = ClosableBrowserLike & { newContext(opts: unknown): Promise<AnyContext> };

interface NetworkEntry {
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  failed?: string;
  at: number;
}
interface ConsoleEntry { type: string; text: string; at: number }
interface BrowserSession {
  id: string;
  workspaceId: string;
  browser: AnyBrowser;
  context: AnyContext;
  page: AnyPage;
  createdAt: number;
  lastUsedAt: number;
  allowLoopback: boolean;
  blockedRequests: string[];
  consoleLogs: ConsoleEntry[];
  network: NetworkEntry[];
}

const sessions = new Map<string, BrowserSession>();

function textResult(payload: unknown, isError = false): ToolResponse {
  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function inlineScreenshot(buffer: Buffer, label: string): ToolResponse["content"] {
  if (shouldEmbedScreenshot(buffer.length, 0, MAX_INLINE_SCREENSHOT_BYTES, MAX_INLINE_SCREENSHOT_BYTES)) {
    return [{ type: "image", data: buffer.toString("base64"), mimeType: "image/png" }];
  }
  return [{
    type: "text",
    text: `${label} was saved, but its ${buffer.length}-byte PNG was not embedded because it exceeded the stable MCP inline-image limit.`,
  }];
}

async function destroySession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  await settleWithin(() => session.context.close(), CLOSE_CTX_MS);
  await closeBrowserWithDeadline(session.browser, CLOSE_BR_MS);
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsedAt > SESSION_TTL_MS) void destroySession(id);
  }
}

function getSession(sessionId: string): BrowserSession {
  pruneExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown browser session: ${sessionId}. Open one with browser_open first.`);
  session.lastUsedAt = Date.now();
  return session;
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1" || host.startsWith("127.");
}

async function installGuard(
  context: AnyContext,
  initialUrl: string | undefined,
  blocked: string[],
  allowLoopback: boolean,
): Promise<string | undefined> {
  await context.route("**/*", async (route: any) => {
    const requestUrl = route.request().url();
    try {
      const protocol = new URL(requestUrl).protocol;
      if (["data:", "blob:", "about:"].includes(protocol)) {
        await route.continue();
        return;
      }
      await assertSafeWebUrl(requestUrl, allowLoopback);
      await route.continue();
    } catch (error) {
      if (blocked.length < MAX_DIAGNOSTICS) {
        blocked.push(`${requestUrl} (${error instanceof Error ? error.message : String(error)})`);
      }
      await route.abort("blockedbyclient");
    }
  });
  await context.routeWebSocket("**/*", async (ws: any) => {
    const socketUrl = ws.url();
    try {
      await assertSafeWebUrl(socketUrl.replace(/^ws/, "http"), allowLoopback);
      ws.connectToServer();
    } catch (error) {
      if (blocked.length < MAX_DIAGNOSTICS) {
        blocked.push(`${socketUrl} (${error instanceof Error ? error.message : String(error)})`);
      }
      await ws.close({ code: 1008, reason: "Blocked by Auvrynt network policy" });
    }
  });
  if (!initialUrl) return undefined;
  return assertSafeWebUrl(initialUrl, allowLoopback);
}

function attachDiagnostics(session: BrowserSession): void {
  session.page.on("console", (msg: any) => {
    if (session.consoleLogs.length < MAX_DIAGNOSTICS) {
      session.consoleLogs.push({ type: msg.type(), text: msg.text(), at: Date.now() });
    }
  });
  session.page.on("request", (req: any) => {
    if (session.network.length < MAX_DIAGNOSTICS) {
      session.network.push({
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        at: Date.now(),
      });
    }
  });
  session.page.on("response", (res: any) => {
    const entry = session.network.find((item) => item.url === res.url() && item.status === undefined);
    if (entry) entry.status = res.status();
  });
  session.page.on("requestfailed", (req: any) => {
    const entry = session.network.find((item) => item.url === req.url() && !item.failed);
    if (entry) entry.failed = req.failure()?.errorText ?? "failed";
  });
}

export async function browserOpen(
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    url?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    userAgent?: string;
  },
): Promise<ToolResponse> {
  registry.getWorkspace(input.workspaceId);
  pruneExpiredSessions();
  if (sessions.size >= MAX_SESSIONS) {
    return textResult(`Browser session capacity reached (max ${MAX_SESSIONS}). Close an existing session with browser_close.`, true);
  }
  let playwright: any;
  try {
    playwright = await loadPlaywright();
  } catch (error) {
    return textResult(`Playwright browser support is unavailable: ${error instanceof Error ? error.message : String(error)}. Run 'auvrynt start' to repair it automatically.`, true);
  }
  const width = Math.min(Math.max(input.viewportWidth ?? 1280, 320), 3840);
  const height = Math.min(Math.max(input.viewportHeight ?? 800, 240), 2160);
  let browser: AnyBrowser | undefined;
  let context: AnyContext | undefined;
  try {
    const validated = input.url ? validateWebUrl(input.url) : undefined;
    const allowLoopback = validated ? isLocalHost(new URL(validated).hostname) : true;
    browser = await playwright.chromium.launch(LAUNCH_OPTIONS);
    context = await browser!.newContext({
      viewport: { width, height },
      serviceWorkers: "block",
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });
    const blockedRequests: string[] = [];
    const safeUrl = await installGuard(context, validated, blockedRequests, allowLoopback);
    const page = await context.newPage();
    const session: BrowserSession = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      browser: browser!,
      context,
      page,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      allowLoopback,
      blockedRequests,
      consoleLogs: [],
      network: [],
    };
    attachDiagnostics(session);
    if (safeUrl) await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    sessions.set(session.id, session);
    return textResult({
      sessionId: session.id,
      url: page.url(),
      title: await page.title(),
      viewport: { width, height },
      blockedRequests,
    });
  } catch (error) {
    if (context) await settleWithin(() => context.close(), CLOSE_CTX_MS);
    if (browser) await closeBrowserWithDeadline(browser, CLOSE_BR_MS);
    return textResult(`browser_open failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserClose(input: { sessionId: string }): Promise<ToolResponse> {
  if (!sessions.has(input.sessionId)) {
    return textResult({ closed: false, reason: "Session not found or already closed." });
  }
  await destroySession(input.sessionId);
  return textResult({ closed: true, sessionId: input.sessionId });
}

export async function browserListSessions(input: { workspaceId?: string }): Promise<ToolResponse> {
  pruneExpiredSessions();
  const items = Array.from(sessions.values())
    .filter((s) => !input.workspaceId || s.workspaceId === input.workspaceId)
    .map((s) => ({
      sessionId: s.id,
      workspaceId: s.workspaceId,
      url: s.page.url(),
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    }));
  return textResult({ sessions: items, count: items.length });
}

export async function browserNavigate(input: {
  sessionId: string;
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const safeUrl = await assertSafeWebUrl(input.url, session.allowLoopback);
    await session.page.goto(safeUrl, {
      waitUntil: input.waitUntil ?? "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    return textResult({ sessionId: session.id, url: session.page.url(), title: await session.page.title() });
  } catch (error) {
    return textResult(`browser_navigate failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserReload(input: { sessionId: string }): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    await session.page.reload({ waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    return textResult({ sessionId: session.id, url: session.page.url(), title: await session.page.title() });
  } catch (error) {
    return textResult(`browser_reload failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserGoBack(input: { sessionId: string }): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    await session.page.goBack({ waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    return textResult({ sessionId: session.id, url: session.page.url(), title: await session.page.title() });
  } catch (error) {
    return textResult(`browser_go_back failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserGoForward(input: { sessionId: string }): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    await session.page.goForward({ waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    return textResult({ sessionId: session.id, url: session.page.url(), title: await session.page.title() });
  } catch (error) {
    return textResult(`browser_go_forward failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserSnapshot(input: {
  sessionId: string;
  interestingOnly?: boolean;
  maxChars?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const maxChars = Math.min(Math.max(input.maxChars ?? 12_000, 500), 50_000);
    let accessibility: unknown = null;
    if (session.page.accessibility?.snapshot) {
      accessibility = await session.page.accessibility.snapshot({ interestingOnly: input.interestingOnly ?? true });
    }
    const summary = await session.page.evaluate(() => {
      const pick = (selector: string, limit = 20) =>
        Array.from(document.querySelectorAll(selector)).slice(0, limit).map((el) => {
          const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            name: el.getAttribute("name") || undefined,
            type: el.getAttribute("type") || undefined,
            href: el.getAttribute("href") || undefined,
            role: el.getAttribute("role") || undefined,
            text: text || undefined,
          };
        });
      return {
        title: document.title,
        url: location.href,
        headings: pick("h1,h2,h3,h4"),
        buttons: pick("button,[role='button'],input[type='button'],input[type='submit']"),
        links: pick("a[href]"),
        inputs: pick("input,textarea,select"),
      };
    });
    let text = JSON.stringify({ sessionId: session.id, summary, accessibility }, null, 2);
    if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…truncated`;
    return textResult(text);
  } catch (error) {
    return textResult(`browser_snapshot failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserClick(input: {
  sessionId: string;
  selector: string;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    await session.page.locator(input.selector).click({
      timeout: Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000),
      button: input.button,
      clickCount: input.clickCount,
    });
    return textResult({ sessionId: session.id, clicked: input.selector, url: session.page.url() });
  } catch (error) {
    return textResult(`browser_click failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserType(input: {
  sessionId: string;
  selector: string;
  text: string;
  clear?: boolean;
  delayMs?: number;
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const locator = session.page.locator(input.selector);
    const timeout = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000);
    if (input.clear ?? true) await locator.fill(input.text, { timeout });
    else await locator.type(input.text, { timeout, delay: Math.min(input.delayMs ?? 0, 200) });
    return textResult({ sessionId: session.id, typed: true, selector: input.selector });
  } catch (error) {
    return textResult(`browser_type failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserSelectOption(input: {
  sessionId: string;
  selector: string;
  values: string | string[];
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const selected = await session.page.locator(input.selector).selectOption(input.values, {
      timeout: Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000),
    });
    return textResult({ sessionId: session.id, selected });
  } catch (error) {
    return textResult(`browser_select_option failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserHover(input: {
  sessionId: string;
  selector: string;
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    await session.page.locator(input.selector).hover({
      timeout: Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000),
    });
    return textResult({ sessionId: session.id, hovered: input.selector });
  } catch (error) {
    return textResult(`browser_hover failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserPressKey(input: {
  sessionId: string;
  key: string;
  selector?: string;
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    if (input.selector) {
      await session.page.locator(input.selector).press(input.key, {
        timeout: Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000),
      });
    } else {
      await session.page.keyboard.press(input.key);
    }
    return textResult({ sessionId: session.id, key: input.key, selector: input.selector ?? null });
  } catch (error) {
    return textResult(`browser_press_key failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserWaitFor(input: {
  sessionId: string;
  selector?: string;
  url?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  state?: "attached" | "detached" | "visible" | "hidden";
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const timeout = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000);
    if (input.selector) {
      await session.page.locator(input.selector).waitFor({ state: input.state ?? "visible", timeout });
    } else if (input.url) {
      await session.page.waitForURL(input.url, { timeout });
    } else if (input.loadState) {
      await session.page.waitForLoadState(input.loadState, { timeout });
    } else {
      await session.page.waitForTimeout(Math.min(timeout, 5_000));
    }
    return textResult({ sessionId: session.id, waited: true, url: session.page.url() });
  } catch (error) {
    return textResult(`browser_wait_for failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserGetText(input: {
  sessionId: string;
  selector: string;
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const text = await session.page.locator(input.selector).textContent({
      timeout: Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000),
    });
    return textResult({ sessionId: session.id, selector: input.selector, text: text ?? "" });
  } catch (error) {
    return textResult(`browser_get_text failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserGetAttribute(input: {
  sessionId: string;
  selector: string;
  name: string;
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const value = await session.page.locator(input.selector).getAttribute(input.name, {
      timeout: Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000),
    });
    return textResult({ sessionId: session.id, selector: input.selector, name: input.name, value });
  } catch (error) {
    return textResult(`browser_get_attribute failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserIsVisible(input: {
  sessionId: string;
  selector: string;
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const visible = await session.page.locator(input.selector).isVisible({
      timeout: Math.min(input.timeoutMs ?? 2_000, 30_000),
    });
    return textResult({ sessionId: session.id, selector: input.selector, visible });
  } catch (error) {
    return textResult({
      sessionId: input.sessionId,
      selector: input.selector,
      visible: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function browserScroll(input: {
  sessionId: string;
  selector?: string;
  deltaX?: number;
  deltaY?: number;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    if (input.selector) await session.page.locator(input.selector).scrollIntoViewIfNeeded();
    else await session.page.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 600);
    return textResult({ sessionId: session.id, scrolled: true });
  } catch (error) {
    return textResult(`browser_scroll failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserConsole(input: {
  sessionId: string;
  clear?: boolean;
  types?: string[];
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const types = input.types?.map((t) => t.toLowerCase());
    const logs = session.consoleLogs.filter((entry) => !types || types.includes(entry.type));
    if (input.clear) session.consoleLogs.length = 0;
    return textResult({ sessionId: session.id, logs, count: logs.length });
  } catch (error) {
    return textResult(`browser_console failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserNetwork(input: {
  sessionId: string;
  clear?: boolean;
  onlyFailed?: boolean;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    let requests = session.network.slice();
    if (input.onlyFailed) {
      requests = requests.filter((entry) => entry.failed || (entry.status !== undefined && entry.status >= 400));
    }
    if (input.clear) session.network.length = 0;
    return textResult({
      sessionId: session.id,
      requests,
      blockedRequests: session.blockedRequests.slice(),
      count: requests.length,
    });
  } catch (error) {
    return textResult(`browser_network failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserEvaluate(input: {
  sessionId: string;
  expression: string;
}): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const expression = input.expression.trim();
    if (!expression) return textResult("browser_evaluate requires a non-empty expression.", true);
    if (/\b(fetch|XMLHttpRequest|WebSocket|import\s*\(|require\s*\()/i.test(expression)) {
      return textResult("browser_evaluate blocked network/module side effects in expression.", true);
    }
    if (expression.length > 4_000) return textResult("browser_evaluate expression too long (max 4000 chars).", true);
    const result = await session.page.evaluate((expr: string) => {
      const fn = new Function(`"use strict"; return (${expr});`);
      return fn();
    }, expression);
    return textResult({ sessionId: session.id, result });
  } catch (error) {
    return textResult(`browser_evaluate failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export async function browserScreenshot(
  registry: WorkspaceRegistry,
  input: { sessionId: string; outputPath: string; fullPage?: boolean },
): Promise<ToolResponse> {
  try {
    const session = getSession(input.sessionId);
    const workspace = registry.getWorkspace(session.workspaceId);
    const absoluteOutputPath = registry.resolveArtifactPath(workspace, input.outputPath, "playwright");
    await mkdir(dirname(absoluteOutputPath), { recursive: true });
    const buffer = await session.page.screenshot({ fullPage: input.fullPage ?? false, type: "png" });
    await writeFile(absoluteOutputPath, buffer);
    const relPath = relative(workspace.root, absoluteOutputPath).replace(/\\/g, "/");
    return {
      content: [
        ...inlineScreenshot(buffer, `Screenshot ${relPath}`),
        {
          type: "text",
          text: JSON.stringify({ sessionId: session.id, path: relPath, url: session.page.url() }, null, 2),
        },
      ],
    };
  } catch (error) {
    return textResult(`browser_screenshot failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export function browserSessionCount(): number {
  pruneExpiredSessions();
  return sessions.size;
}
