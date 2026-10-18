import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { Script } from "node:vm";
import { dashboardHtml } from "./dashboard-page.js";
import type { DashboardView } from "./dashboard.js";
import { loadPlaywright } from "../playwright-runtime.js";

const now = Date.now();
const view: DashboardView = {
  ready: true,
  agentState: "connected",
  agentLastSeenAt: new Date(now - 4_000).toISOString(),
  activeToolCalls: 0,
  agentProvider: "Claude",
  pid: 4242,
  uptimeSeconds: 7_543,
  localMcpUrl: "http://127.0.0.1:3000/mcp",
  publicMcpUrl: "https://auvrynt.example.test/mcp",
  publicBaseUrl: "https://auvrynt.example.test",
  tunnelProvider: "custom",
  arbiter: {
    enabled: true,
    configured: true,
    endpoint: "https://arbiter.example.test",
    model: "laya-typed-decisions",
    timeoutMs: 10_000,
  },
  allowedRoots: ["C:\\Users\\LENOVO\\Desktop\\Projectsss\\Moonless"],
  directoryRequirements: [
    { key: "godot", label: "Godot directory", note: "Used by Godot project tools." },
  ],
  sessions: 1,
  maxSessions: 99999,
  sessionIdleTimeoutMinutes: 720,
  widgets: "compact",
  mcpRequestTimings: {
    maxSamplesPerKind: 256,
    kinds: {
      all: {
        samples: 12,
        authMs: { count: 12, p50: 4, p90: 8, p95: 9, p99: 10 },
        preDispatchMs: { count: 12, p50: 2, p90: 4, p95: 5, p99: 6 },
        dispatchMs: { count: 12, p50: 18, p90: 29, p95: 31, p99: 35 },
        totalMs: { count: 12, p50: 25, p90: 40, p95: 45, p99: 50 },
      },
    },
  },
  runningProcesses: 2,
  workspaceChanges: {
    workspaceId: "ws_dashboard_test",
    workspaceRoot: "C:\\Users\\LENOVO\\Desktop\\Projectsss\\Moonless",
    filesCreated: 4,
    filesDeleted: 1,
    filesModified: 7,
    additions: 1_000_000,
    removals: 940_000,
    startedAt: new Date(now - 60_000).toISOString(),
    sampledAt: new Date(now - 3_000).toISOString(),
  },
  integrations: [
    { key: "serena", label: "Serena", enabled: true, state: "connected", detail: "Serena is running.", toolCount: 42, toolEnabledCount: 42 },
    { key: "playwright", label: "Playwright", enabled: true, state: "available", detail: "Chromium is installed and starts on demand.", toolCount: 3, toolEnabledCount: 3 },
    { key: "blender", label: "Blender", enabled: false, state: "disabled", detail: "Not included in the active profile.", toolCount: 224, toolEnabledCount: 0 },
    { key: "godotCsharp", label: "Godot C#", enabled: false, state: "disabled", detail: "Not included in the active profile.", toolCount: 0, toolEnabledCount: 0 },
    { key: "godotGdscript", label: "Godot GDScript", enabled: false, state: "disabled", detail: "Not included in the active profile.", toolCount: 0, toolEnabledCount: 0 },
  ],
  skills: {
    enabled: true,
    agentDir: "~/.auvrynt",
    skillPaths: [],
    workspaceRoot: "C:\Users\LENOVO\Desktop\Projectsss\Moonless",
    skills: [
      {
        name: "example-skill",
        description: "Example skill for dashboard tests.",
        path: "~/.auvrynt/skills/example-skill/SKILL.md",
        baseDir: "~/.auvrynt/skills/example-skill",
        scope: "user",
        source: "agent",
        origin: "top-level",
        disableModelInvocation: false,
        agentAccess: "Exposed on open_workspace as an available skill; agents should read the SKILL.md path before using it.",
      },
    ],
    diagnostics: [],
  },
  ngrok: {
    provider: "ngrok",
    enabled: true,
    environmentOverride: false,
    activeIndex: 1,
    tokens: [
      { index: 0, fingerprint: "4A8F71C2B0", active: false, quotaExhaustedAt: new Date(now - 30_000).toISOString() },
      { index: 1, fingerprint: "70C93D15AA", active: true },
    ],
    notice: {
      tone: "warning",
      title: "ngrok token switched automatically",
      message: "1 saved token has reached the monthly request limit. Auvrynt is using backup 70C93D15AA.",
    },
  },
  logs: Array.from({ length: 24 }, (_, index) => ({
    id: 24 - index,
    ts: new Date(now - index * 50_000).toISOString(),
    level: index % 11 === 0 ? "warn" as const : "info" as const,
    event: index % 3 === 0 ? "tool_call" : index % 3 === 1 ? "mcp_request" : "http_request",
    fields: index % 3 === 0
      ? { tool: index % 2 === 0 ? "read" : "edit", success: true, durationMs: 15 + index }
      : index % 3 === 1
        ? { sessionIdPresent: true }
        : { path: "/healthz", durationMs: 4 + index },
  })),
};

const iconPath = fileURLToPath(new URL("../../docs/assets/auvrynt-icon.png", import.meta.url));
const icon = await readFile(iconPath);
const dashboardDocument = dashboardHtml(view, "browser-test-nonce", "browser-test-dashboard-token");
const inlineScript = dashboardDocument.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, "dashboard inline script is missing");
new Script(inlineScript, { filename: "dashboard-inline.js" });
let restartRequests = 0;
let restartPid = 4242;
let stopRequests = 0;
let stopCompleted = false;
let workspaceRequests = 0;
let workspacePickerRequests = 0;
let directoryRequests = 0;
let directoryPickerRequests = 0;
let sessionLimitRequests = 0;
let sessionIdleTimeoutRequests = 0;
let toolDisplayRequests = 0;
let ngrokTokenRequests = 0;
let webAgentSecretRequests = 0;
let toolToggleRequests = 0;
let selectedWorkspacePath: string | undefined;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/brand-assets/auvrynt-icon.png") {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(icon);
    return;
  }
  if (url.pathname === "/dashboard/data") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(view));
    return;
  }
  if (url.pathname === "/healthz") {
    response.writeHead(stopCompleted ? 503 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: !stopCompleted, pid: restartPid }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/web-agent-secret") {
    webAgentSecretRequests++;
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ secret: "browser-web-agent-owner-token" }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/ngrok-tokens") {
    ngrokTokenRequests++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action?: string };
    if (body.action === "add") {
      view.ngrok.tokens.push({ index: 2, fingerprint: "9F21D7A400", active: false });
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "ngrok credentials updated.", ngrok: view.ngrok, restarting: false }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/restart") {
    restartRequests++;
    restartPid = 5252;
    view.pid = restartPid;
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Restart requested.", restarting: true }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/stop") {
    stopRequests++;
    stopCompleted = true;
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Auvrynt is stopping.", stopping: true }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/select-workspace") {
    workspacePickerRequests++;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(selectedWorkspacePath
      ? { path: selectedWorkspacePath, canceled: false }
      : { canceled: true }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/select-directory") {
    directoryPickerRequests++;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ path: "C:\\Projects\\AgentAssets", canceled: false }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/directories") {
    directoryRequests++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action?: string; path?: string; index?: number };
    if (body.action === "add" && body.path) {
      if (view.allowedRoots.length >= 5) {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "A maximum of 5 agent-access directories can be configured." }));
        return;
      }
      view.allowedRoots = [...view.allowedRoots, body.path];
    } else if (body.action === "remove" && Number.isInteger(body.index)) {
      view.allowedRoots = view.allowedRoots.filter((_root, index) => index !== body.index);
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      message: body.action === "add" ? "Agent directory added." : "Agent directory removed.",
      allowedRoots: view.allowedRoots,
      closedWorkspaces: 0,
    }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/session-limit") {
    sessionLimitRequests++;
    view.maxSessions = 3;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "MCP session limit changed to 3.", maxSessions: 3 }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/session-idle-timeout") {
    sessionIdleTimeoutRequests++;
    view.sessionIdleTimeoutMinutes = 60;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "MCP idle timeout changed to 60 minutes.", idleTimeoutMinutes: 60 }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/widgets") {
    toolDisplayRequests++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { widgets?: DashboardView["widgets"] };
    view.widgets = body.widgets ?? view.widgets;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: `Tool Call Display changed to ${view.widgets}.`, widgets: view.widgets, restarting: false }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/workspace") {
    workspaceRequests++;
    view.allowedRoots = ["C:\\Projects\\NewRoot"];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Workspace changed.", allowedRoots: view.allowedRoots, closedWorkspaces: 1 }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/integrations") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Integration updated." }));
    return;
  }
  if (url.pathname === "/dashboard/tools") {
    const integration = url.searchParams.get("integration") ?? "";
    if (integration === "blender") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        integration,
        counts: { blender: { total: 224, enabled: 224 }, serena: { total: 42, enabled: 42 }, playwright: { total: 3, enabled: 3 } },
        tools: [
          { name: "blender_create_cube", title: "Create Cube", group: "Model", enabled: true },
          { name: "blender_knife_cut", title: "Knife Cut", group: "Model", enabled: true },
          { name: "blender_set_keyframe", title: "Set Keyframe", group: "Animation", enabled: false },
        ],
      }));
      return;
    }
    if (integration === "serena") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        integration,
        counts: { serena: { total: 42, enabled: 42 } },
        tools: [
          { name: "serena_find_symbol", title: "Find Symbol", group: "Code", enabled: true },
          { name: "serena_find_referencing_symbols", title: "Find Referencing Symbols", group: "Code", enabled: true },
          { name: "serena_start_session", title: "Start Session", group: "Sessions", enabled: true },
        ],
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Unknown integration." }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/tools") {
    toolToggleRequests++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { name?: string; enabled?: boolean; group?: string; groupEnabled?: boolean };
    response.writeHead(200, { "content-type": "application/json" });
    if (body.name) {
      response.end(JSON.stringify({ message: `${body.name} ${body.enabled ? "enabled" : "disabled"}.`, toolToggles: { [body.name]: body.enabled } }));
    } else {
      response.end(JSON.stringify({ message: `Group ${body.group} ${body.groupEnabled ? "enabled" : "disabled"}.`, toolToggles: {} }));
    }
    return;
  }
  if (url.pathname === "/dashboard" || url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(dashboardDocument);
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
const dashboardUrl = `http://127.0.0.1:${port}/dashboard`;
const playwright = await loadPlaywright();
const browser = await playwright.chromium.launch({ headless: true });

try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("pageerror", (error: Error) => pageErrors.push(error.stack ?? error.message));
    page.on("requestfailed", (request: any) => failedRequests.push(request.url()));
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(50);
    assert.deepEqual(pageErrors, [], `${viewport.name}: startup page errors: ${pageErrors.join("; ")}`);

    assert.equal(await page.locator(".mode-switch-button").count(), 2, `${viewport.name}: mode switch should expose Code and Jobs only`);
    assert.equal(await page.locator(".mode-switch-button[href='/dashboard']").getAttribute("aria-label"), "Code dashboard");
    assert.equal(await page.locator(".mode-switch-button[href='/dashboard/jobs']").getAttribute("title"), "Jobs dashboard");
    const modeLayout = await page.locator(".dashboard-brand-row").evaluate((row: Element) => {
      const brand = row.querySelector(".brand")!.getBoundingClientRect();
      const switcher = row.querySelector(".mode-switch")!.getBoundingClientRect();
      const labels = [...row.querySelectorAll(".mode-switch-label")].map((label: Element) => ({
        position: getComputedStyle(label).position,
        width: label.getBoundingClientRect().width,
      }));
      return { brandRight: brand.right, switchLeft: switcher.left, switchRight: switcher.right, rowRight: row.getBoundingClientRect().right, labels };
    });
    assert.ok(modeLayout.switchLeft >= modeLayout.brandRight, `${viewport.name}: mode switch must sit to the right of the Auvrynt identity`);
    assert.ok(modeLayout.switchRight <= modeLayout.rowRight + 1, `${viewport.name}: mode switch must stay inside the brand row`);
    assert.ok(modeLayout.labels.every((label: { position: string; width: number }) => label.position === "absolute" && label.width <= 1), `${viewport.name}: mode labels should be visually hidden, not removed from accessibility`);
    const modeChrome = await page.locator(".mode-switch").evaluate((element: Element) => {
      const active = element.querySelector(".mode-switch-button.active");
      const style = getComputedStyle(element);
      return { borderStyle: style.borderStyle, padding: style.padding, indicatorWidth: active ? getComputedStyle(active, "::after").width : "0px" };
    });
    assert.equal(modeChrome.borderStyle, "none", `${viewport.name}: mode switch should not have an enclosing border`);
    assert.equal(modeChrome.padding, "0px", `${viewport.name}: mode switch should not have pill padding`);
    assert.notEqual(modeChrome.indicatorWidth, "0px", `${viewport.name}: active mode should retain a visible indicator`);
    assert.equal(await page.locator("#page-title").textContent(), "Analytics", `${viewport.name}: analytics should be default`);
    assert.equal(await page.locator("#presence-title").textContent(), "Claude connected", `${viewport.name}: agent status should identify the connected AI client`);
    assert.equal(await page.locator(".activity-visual, .signal-orbit").count(), 0, `${viewport.name}: decorative orbit graphic should be removed`);
    assert.equal(await page.locator("#change-additions").textContent(), "+1M");
    assert.equal(await page.locator("#change-additions").getAttribute("title"), "+1,000,000");
    assert.equal(await page.locator("#change-removals").textContent(), "−940K");
    assert.equal(await page.locator("#files-created").textContent(), "4");
    assert.equal(await page.locator("#files-deleted").textContent(), "1");
    assert.equal(await page.locator("[data-copy-url='public']").count(), 1);
    assert.equal(await page.locator("#edit-workspace svg").count(), 1);
    assert.equal(await page.getByText("Counts successful Auvrynt write/edit file operations").count(), 0);
    assert.equal(await page.locator(".server-state").evaluate((element: HTMLElement) => getComputedStyle(element).borderTopWidth), "0px");
    assert.equal(await page.locator("#tunnel-alert").isVisible(), true, `${viewport.name}: ngrok quota alert should be visible`);
    assert.match(await page.locator("#tunnel-alert-title").textContent() ?? "", /switched automatically/i);

    const dimensions = await page.evaluate(() => {
      const workspace = document.querySelector(".workspace")!.getBoundingClientRect();
      const header = document.querySelector(".workspace-header")!.getBoundingClientRect();
      const added = document.querySelector(".delta.add")!.getBoundingClientRect();
      const removed = document.querySelector(".delta.remove")!.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        workspaceLeft: workspace.left,
        workspaceRight: workspace.right,
        headerLeft: header.left,
        headerRight: header.right,
        deltaGap: removed.left - added.right,
      };
    });
    assert.ok(
      dimensions.documentWidth <= dimensions.viewportWidth + 1 && dimensions.bodyWidth <= dimensions.viewportWidth + 1,
      `${viewport.name}: dashboard has horizontal overflow (${JSON.stringify(dimensions)})`,
    );
    assert.ok(Math.abs(dimensions.headerLeft - dimensions.workspaceLeft) <= 1, `${viewport.name}: header does not reach the workspace left edge`);
    assert.ok(Math.abs(dimensions.headerRight - dimensions.workspaceRight) <= 1, `${viewport.name}: header does not reach the workspace right edge`);
    assert.ok(dimensions.deltaGap >= 0, `${viewport.name}: additions and removals overlap`);

    await page.locator("#open-secrets").click();
    assert.equal(await page.locator("#page-title").textContent(), "Secrets");
    assert.equal(await page.locator("#view-secrets").isVisible(), true);
    assert.equal(await page.locator("#ngrok-token-input").getAttribute("type"), "password");
    assert.equal(await page.locator(".token-row").count(), 2);
    assert.equal(await page.locator("#ngrok-token-list").getByText("4A8F71C2B0", { exact: true }).count(), 1);
    assert.equal(await page.locator("#ngrok-token-list").getByText("70C93D15AA", { exact: true }).count(), 1);
    assert.equal((await page.locator("body").textContent() ?? "").includes("2abc_"), false, `${viewport.name}: raw token material must not be rendered`);
    if (viewport.name === "desktop") {
      await page.locator("#copy-web-agent-secret").click();
      await page.waitForFunction(() => document.querySelector("#web-agent-secret-status")?.textContent?.includes("Copied") === true);
      assert.equal(webAgentSecretRequests, 1, "copying the web-agent secret must use the authorized dashboard action");
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "browser-web-agent-owner-token");
      assert.equal((await page.locator("body").textContent() ?? "").includes("browser-web-agent-owner-token"), false, `${viewport.name}: raw web-agent secret must not be rendered`);
    }

    await page.locator("#tab-connectivity").click();
    assert.equal(await page.locator("#page-title").textContent(), "Connectivity");
    assert.equal(await page.locator("#view-connectivity").isVisible(), true);
    assert.equal(await page.locator("#connection-title").isVisible(), true);
    assert.equal(await page.locator("#integrations-title").isVisible(), true);
    assert.equal(await page.locator("#agent-directories-title").isVisible(), true);
    assert.equal(await page.locator(".directory-profile-note").count(), 1, `${viewport.name}: active directory profiles should be explained`);
    assert.equal(await page.getByText("Godot directory", { exact: true }).count(), 1, `${viewport.name}: Godot directory note should be visible`);
    assert.equal(await page.getByText("Krita directory", { exact: true }).count(), 0, `${viewport.name}: window-only profiles should not be labeled as directories`);
    assert.equal(
      await page.locator(".operations-grid").evaluate((element: HTMLElement) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length),
      1,
      `${viewport.name}: Connectivity sections should stack in one column`,
    );
    assert.equal(
      await page.locator("#integrations").evaluate((element: HTMLElement) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length),
      viewport.width > 940 ? 2 : 1,
      `${viewport.name}: Integrations should use two columns above the narrow breakpoint`,
    );
    const integrationButtonAlignment = await page.locator(".integration-row").evaluateAll((rows: Element[]) => rows.map((row: Element) => {
      const button = row.querySelector(".integration-toggle") as HTMLElement | null;
      return button ? Math.abs(row.getBoundingClientRect().right - button.getBoundingClientRect().right) : Number.POSITIVE_INFINITY;
    }));
    assert.ok(
      integrationButtonAlignment.every((delta: number) => delta <= 1),
      `${viewport.name}: integration action buttons should align to their row edge (${integrationButtonAlignment.join(", ")})`,
    );
    assert.equal(await page.locator(".directory-row").count(), 1, `${viewport.name}: the configured root should be listed`);
    assert.equal(await page.locator(".directory-remove").isDisabled(), true, `${viewport.name}: the last directory cannot be removed`);
    assert.equal(await page.locator("#workspace-editor").count(), 0);
    assert.equal(await page.locator("#session-limit-input").inputValue(), "99999");
    assert.equal(await page.locator("#session-limit-input").getAttribute("type"), "text");
    assert.equal(await page.locator("#session-limit-input").evaluate((element: HTMLElement) => getComputedStyle(element).borderTopWidth), "0px");
    assert.equal(await page.locator("#save-session-limit svg").count(), 1);
    assert.equal(await page.locator("#mcp-request-timing").textContent(), "p50 25ms · p95 45ms · p99 50ms");

    const countBadges = await page.locator(".integration-row .tool-count strong").allTextContents();
    assert.deepEqual(countBadges, ["42", "3", "0"], `${viewport.name}: integration tool count badges only for integrations with >0 tools`);
    const serenaRow = page.locator(".integration-row").filter({ hasText: "Serena" });
    assert.equal(await serenaRow.locator(".tool-count").getAttribute("title"), "42 of 42 tools enabled");
    assert.equal(await page.locator("[data-tools-integration]").count(), 0, `${viewport.name}: per-row gear icons are removed`);
    assert.equal(await page.locator("#open-tool-settings").count(), 1, `${viewport.name}: single header gear for tool settings`);
    const blenderRow = page.locator(".integration-row").filter({ hasText: "Blender" });
    assert.equal(await blenderRow.locator(".tool-count").getAttribute("title"), "0 of 224 tools enabled");

    await page.locator("#open-tool-settings").click();
    assert.equal(await page.locator("#page-title").textContent(), "Tool settings");
    assert.equal(await page.locator("#view-tools").isVisible(), true);
    await page.waitForFunction(() => document.querySelector("#tools-layout")?.querySelector(".tools-group"));
    assert.equal(await page.locator("[data-tools-tab]").count(), 3, `${viewport.name}: tabs for integrations that have tools`);
    assert.equal(await page.locator("[data-tools-tab='serena']").getAttribute("class"), "tools-tab active");
    assert.equal(await page.locator("[data-tools-sub]").count(), 0, `${viewport.name}: Serena is a primary tab without a legacy memory sub-tab`);
    assert.equal(await page.locator(".tools-summary").textContent(), "3 of 3 tools enabled");
    assert.equal(await page.locator(".tools-group").count(), 2, `${viewport.name}: groups rendered from classifier data`);
    assert.equal(await page.locator("[data-tool-name='serena_find_symbol']").isChecked(), true);

    await page.locator("[data-tool-name='serena_find_symbol']").evaluate((element: HTMLInputElement) => {
      element.checked = false;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector(".tools-summary")?.textContent === "2 of 3 tools enabled");
    assert.ok(toolToggleRequests >= 1, `${viewport.name}: per-tool POST was issued`);

    await page.locator("[data-tools-group='Code']").evaluate((element: HTMLInputElement) => {
      element.checked = true;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector(".tools-summary")?.textContent === "3 of 3 tools enabled");

    await page.locator("#tools-search").fill("session");
    assert.equal(await page.locator(".tools-group").count(), 1, `${viewport.name}: search narrows to matching group`);
    assert.equal(await page.locator(".tools-group[open]").count(), 1, `${viewport.name}: matching batch auto-expands while searching`);
    assert.equal(await page.locator(".tool-row").count(), 1, `${viewport.name}: search narrows to matching tool`);
    await page.locator("#tools-search").fill("");

    await page.locator("[data-tools-tab='playwright']").click();
    await page.waitForFunction(() => document.querySelector("#tools-layout")?.textContent?.includes("Unable to load tools"));
    assert.match(await page.locator("#tools-layout").textContent() ?? "", /Unable to load tools/i, `${viewport.name}: missing tools data surfaces an error message`);


    await page.locator("#tab-logs").click();
    assert.equal(await page.locator("#page-title").textContent(), "Logs");
    assert.equal(await page.locator("#view-logs").isVisible(), true);
    assert.equal(await page.locator("#pause-logs").count(), 0);
    assert.equal(await page.locator("#clear-logs").count(), 0);
    assert.equal(await page.locator(".log-filter-column").count(), 0);
    assert.equal(await page.locator(".log-filter-row").evaluate((element: HTMLElement) => getComputedStyle(element).display), "flex");
    const toolbarPositions = await page.evaluate(() => {
      const title = document.querySelector(".logs-toolbar h2")!.getBoundingClientRect();
      const search = document.querySelector("#log-search")!.getBoundingClientRect();
      const filters = [...document.querySelectorAll<HTMLElement>("[data-log-filter]")].map((element) => element.getBoundingClientRect());
      return {
        titleCenter: Math.round(title.top + title.height / 2),
        searchCenter: Math.round(search.top + search.height / 2),
        filterTops: filters.map((rect) => Math.round(rect.top)),
        filterCenters: filters.map((rect) => Math.round(rect.top + rect.height / 2)),
      };
    });
    assert.equal(new Set(toolbarPositions.filterTops).size, 1, `${viewport.name}: log filters must remain on one horizontal row`);
    if (viewport.width > 940) {
      assert.ok(Math.abs(toolbarPositions.titleCenter - toolbarPositions.searchCenter) <= 2, `${viewport.name}: title and search must share the toolbar row`);
      assert.ok(Math.abs(toolbarPositions.titleCenter - toolbarPositions.filterCenters[0]!) <= 2, `${viewport.name}: filters must share the toolbar row`);
    }

    await page.locator("#tab-commands").click();
    assert.equal(await page.locator("#page-title").textContent(), "Commands");
    assert.equal(await page.locator("#view-commands").isVisible(), true);
    assert.equal(await page.locator("#command-form, #command-output, #run-command").count(), 0);
    const commandOverflow = await page.locator("#command-list").evaluate((element: HTMLElement) => getComputedStyle(element).overflowY);
    assert.equal(commandOverflow, "visible", `${viewport.name}: command reference should use page scrolling`);

    await page.locator("#tab-connectivity").click();
    await page.locator("[data-copy-url='public']").click();
    await page.waitForFunction(() => document.querySelector("[data-copy-url='public']")?.textContent === "✓");
    await page.waitForFunction(() => document.querySelector("#action-notice")?.classList.contains("visible"));
    assert.equal(await page.locator("[data-copy-url='public']").textContent(), "✓");
    assert.match(await page.locator("#action-notice").textContent() ?? "", /copied/i);
    const toastLayout = await page.locator("#action-notice").evaluate((element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        position: getComputedStyle(element).position,
        centerOffset: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
        outsideMain: element.closest("main") === null,
        visible: element.classList.contains("visible"),
      };
    });
    assert.equal(toastLayout.position, "static");
    assert.ok(toastLayout.centerOffset <= 1, `${viewport.name}: toast is not centered`);
    assert.equal(toastLayout.outsideMain, true);
    assert.equal(toastLayout.visible, true);

    assert.deepEqual(pageErrors, [], `${viewport.name}: page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(failedRequests, [], `${viewport.name}: failed requests: ${failedRequests.join("; ")}`);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
    await page.locator("#restart").click();
    assert.equal(await page.locator("#confirm-dialog").getAttribute("open"), "");
    assert.equal(await page.locator("#confirm-title").textContent(), "Restart Auvrynt?");
    await page.locator("#confirm-accept").click();
    await page.waitForFunction(() => document.querySelector("#restart")?.getAttribute("aria-busy") === "true");
    assert.equal(await page.locator("#restart").isDisabled(), true);
    assert.equal(await page.locator("#server-state-title").textContent(), "Restarting");
    assert.equal(restartRequests, 1);
    await page.waitForFunction(() => (document.querySelector("#action-notice")?.textContent ?? "").includes("restarted successfully"));
    assert.equal(await page.locator("#server-state-title").textContent(), "Server online");
    assert.equal(await page.locator("#lifecycle-overlay").getAttribute("aria-hidden"), "true");
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
    await page.locator("#stop").click();
    assert.equal(await page.locator("#confirm-title").textContent(), "Stop Auvrynt?");
    await page.locator("#confirm-accept").click();
    await page.waitForFunction(() => document.querySelector("#stop")?.getAttribute("aria-busy") === "true");
    assert.equal(await page.locator("#stop").isDisabled(), true);
    assert.equal(await page.locator("#server-state-title").textContent(), "Stopping");
    assert.equal(stopRequests, 1);
    await page.waitForFunction(() => document.querySelector("#lifecycle-overlay")?.classList.contains("complete"));
    assert.equal(await page.locator("#lifecycle-title").textContent(), "Auvrynt stopped");
    assert.equal(await page.locator("#server-state-title").textContent(), "Stopped");
    assert.equal(await page.locator("#lifecycle-overlay").getAttribute("aria-hidden"), "false");
    await context.close();
    stopCompleted = false;
  }

  {
    selectedWorkspacePath = "C:\\Projects\\NewRoot";
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
    await page.locator("#tab-connectivity").click();
    await page.locator("#edit-workspace").click();
    await page.waitForFunction(() => document.querySelector("#action-notice")?.textContent === "Workspace changed.");
    assert.equal(workspacePickerRequests, 1);
    assert.equal(workspaceRequests, 1);
    assert.equal(await page.locator("#workspace").textContent(), "C:\\Projects\\NewRoot");
    assert.equal(await page.locator(".directory-path").textContent(), "C:\\Projects\\NewRoot");
    assert.equal(await page.locator("#server-state-title").textContent(), "Server online");
    assert.equal(await page.locator("#edit-workspace").isDisabled(), false);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
    await page.locator("#tab-connectivity").click();
    assert.equal(await page.locator(".directory-row").count(), 1);
    await page.locator("#add-directory").click();
    await page.waitForFunction(() => document.querySelector("#action-notice")?.textContent === "Agent directory added.");
    assert.equal(directoryPickerRequests, 1);
    assert.equal(directoryRequests, 1);
    assert.equal(await page.locator(".directory-row").count(), 2);
    assert.equal(await page.getByText("C:\\Projects\\AgentAssets", { exact: true }).count(), 1);
    const addedDirectory = page.locator(".directory-row").filter({ hasText: "C:\\Projects\\AgentAssets" });
    await addedDirectory.locator(".directory-remove").click();
    assert.equal(await page.locator("#confirm-title").textContent(), "Remove agent directory?");
    await page.locator("#confirm-accept").click();
    await page.waitForFunction(() => document.querySelector("#action-notice")?.textContent === "Agent directory removed.");
    assert.equal(directoryRequests, 2);
    assert.equal(await page.locator(".directory-row").count(), 1);
    assert.equal(await page.locator(".directory-remove").isDisabled(), true);
    await context.close();
  }

  {
    const previousAllowedRoots = view.allowedRoots;
    view.allowedRoots = Array.from({ length: 5 }, (_value, index) => `C:\\Projects\\AgentRoot${index + 1}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
    await page.locator("#tab-connectivity").click();
    await page.waitForFunction(() => document.querySelectorAll(".directory-row").length === 5);
    assert.equal(await page.locator(".directory-row").count(), 5);
    assert.equal(await page.locator("#add-directory").isDisabled(), true, "Add directory must disable at the five-directory limit");
    assert.match(await page.locator("#add-directory").getAttribute("title") ?? "", /maximum of 5/i);
    await context.close();
    view.allowedRoots = previousAllowedRoots;
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
    await page.locator("#tab-secrets").click();
    await page.locator("#ngrok-token-input").fill("2abc_dashboard_backup_token_123456789");
    await page.locator("#add-ngrok-token").click();
    await page.waitForFunction(() => document.querySelector("#action-notice")?.textContent === "ngrok credentials updated.");
    assert.equal(ngrokTokenRequests, 1);
    assert.equal(await page.locator("#ngrok-token-input").inputValue(), "");
    assert.equal(await page.locator(".token-row").count(), 3);
    assert.equal(await page.getByText("9F21D7A400").count(), 1);
    assert.equal((await page.locator("body").textContent() ?? "").includes("2abc_dashboard_backup_token"), false);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
    await page.locator("#tab-connectivity").click();
    await page.locator("#session-limit-input").fill("3");
    await page.locator("#save-session-limit").click();
    await page.waitForFunction(() => document.querySelector("#action-notice")?.textContent === "MCP session limit changed to 3.");
    assert.equal(sessionLimitRequests, 1);
    assert.equal(await page.locator("#session-limit-input").inputValue(), "3");
    assert.equal(await page.locator("#metric-sessions").textContent(), "1 / 3");
    assert.equal(await page.locator("#server-state-title").textContent(), "Server online");
    assert.equal(await page.locator("#save-session-limit").isDisabled(), false);
    await page.locator("#session-idle-timeout-input").fill("60");
    await page.locator("#save-session-idle-timeout").click();
    await page.waitForFunction(() => document.querySelector("#action-notice")?.textContent === "MCP idle timeout changed to 60 minutes.");
    assert.equal(sessionIdleTimeoutRequests, 1);
    assert.equal(await page.locator("#session-idle-timeout-input").inputValue(), "60");
    assert.equal(await page.locator("#save-session-idle-timeout").isDisabled(), false);
    await page.locator("#tool-display-select").selectOption("changes");
    await page.locator("#save-tool-display").click();
    await page.waitForFunction(() => document.querySelector("#action-notice")?.textContent === "Tool Call Display changed to changes.");
    assert.equal(toolDisplayRequests, 1);
    assert.equal(await page.locator("#tool-display-select").inputValue(), "changes");
    assert.equal(await page.locator("#save-tool-display").isDisabled(), false);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log("Dashboard browser layout and interaction tests passed!");
