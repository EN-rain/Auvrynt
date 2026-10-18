import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlaywright } from "../playwright-runtime.js";
import { loadConfig } from "../infrastructure/config.js";
import { ingestManualJob } from "../jobs/pipeline.js";
import { JobsStore } from "../jobs/store.js";
import { boundedJobPageQuery, createJobsDashboardView } from "./jobs-dashboard.js";
import { jobsDashboardHtml } from "./jobs-dashboard-page.js";

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-jobs-browser-"));
const config = loadConfig({ AUVRYNT_ALLOWED_ROOTS: stateDir, AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough", PORT: "1" });
const store = new JobsStore(stateDir);
for (let index = 0; index < 55; index += 1) {
  ingestManualJob(store, {
    title: `Pagination Audit Job ${index + 1}`,
    company: "Pagination Studio",
    description: "Seed opportunity used to verify filtered Jobs dashboard pagination.",
    url: `https://jobs.example/pagination-audit-${index + 1}`,
  });
}
ingestManualJob(store, {
  title: "Risk Attention Job",
  company: "Audit Risk Studio",
  description: "Urgent hiring. A registration fee is required before you start.",
  url: "https://jobs.example/risk-attention",
});
const token = "browser-jobs-control-token";
const iconPath = fileURLToPath(new URL("../../docs/assets/auvrynt-icon.png", import.meta.url));
const icon = await readFile(iconPath);
let latestView = createJobsDashboardView(store, config);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/brand-assets/auvrynt-icon.png") { response.writeHead(200, { "content-type": "image/png" }); response.end(icon); return; }
  if (url.pathname === "/dashboard/jobs") { latestView = createJobsDashboardView(store, config); response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(jobsDashboardHtml(latestView, "browser-jobs-nonce", token, 4242)); return; }
  if (url.pathname === "/dashboard/jobs/data") { latestView = createJobsDashboardView(store, config); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(latestView)); return; }
  if (url.pathname === "/dashboard/jobs/opportunities") {
    latestView = createJobsDashboardView(store, config, boundedJobPageQuery(Object.fromEntries(url.searchParams.entries())));
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(latestView.opportunities)); return;
  }
  if (request.method === "POST" && url.pathname === "/__auvrynt/dashboard/jobs/add") {
    const body = await readJson(request) as any;
    const result = ingestManualJob(store, body as any);
    latestView = createJobsDashboardView(store, config);
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ data: result.job, duplicate: result.duplicate })); return;
  }
  const statusMatch = /^\/__auvrynt\/dashboard\/jobs\/([^/]+)\/status$/.exec(url.pathname);
  if (request.method === "POST" && statusMatch) {
    const body = await readJson(request) as { status: string };
    const job = store.setStatus(statusMatch[1] as any, body.status as any);
    latestView = createJobsDashboardView(store, config);
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ data: job })); return;
  }
  response.writeHead(404); response.end();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
const baseUrl = `http://127.0.0.1:${port}/dashboard/jobs`;
const playwright = await loadPlaywright();
const browser = await playwright.chromium.launch({ headless: true });

try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 667 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [];
    const failed: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.on("requestfailed", (request: any) => failed.push(request.url()));
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    assert.deepEqual(errors, [], `page errors at ${viewport.width}: ${errors.join("; ")}`);
    assert.equal(await page.locator(".jobs-title").textContent(), "Find the right next move.");
    assert.equal(await page.locator(".mode-switch-button[href='/dashboard/jobs']").getAttribute("aria-current"), "page");
    assert.equal(await page.locator(".mode-switch-button").count(), 2, "mode switch should expose Code and Jobs only");
    assert.equal(await page.locator(".mode-switch-button[href='/dashboard']").getAttribute("aria-label"), "Code dashboard");
    assert.equal(await page.locator(".mode-switch-button[href='/dashboard/jobs']").getAttribute("title"), "Jobs dashboard");
    const modeLayout = await page.locator(".jobs-brand-row").evaluate((row: Element) => {
      const brand = row.querySelector(".jobs-brand")!.getBoundingClientRect();
      const switcher = row.querySelector(".mode-switch")!.getBoundingClientRect();
      const labels = [...row.querySelectorAll(".mode-switch-label")].map((label: Element) => ({
        position: getComputedStyle(label).position,
        width: label.getBoundingClientRect().width,
      }));
      return { brandRight: brand.right, switchLeft: switcher.left, switchRight: switcher.right, rowRight: row.getBoundingClientRect().right, labels };
    });
    assert.ok(modeLayout.switchLeft >= modeLayout.brandRight, `mode switch must sit to the right of the Auvrynt identity: ${JSON.stringify(modeLayout)}`);
    assert.ok(modeLayout.switchRight <= modeLayout.rowRight + 1, `mode switch must stay inside the brand row: ${JSON.stringify(modeLayout)}`);
    assert.ok(modeLayout.labels.every((label: { position: string; width: number }) => label.position === "absolute" && label.width <= 1), "mode labels should be visually hidden, not removed from accessibility");
    const modeChrome = await page.locator(".mode-switch").evaluate((element: Element) => {
      const active = element.querySelector(".mode-switch-button.active");
      const style = getComputedStyle(element);
      return { borderStyle: style.borderStyle, padding: style.padding, indicatorWidth: active ? getComputedStyle(active, "::after").width : "0px" };
    });
    assert.equal(modeChrome.borderStyle, "none", "mode switch should not have an enclosing border");
    assert.equal(modeChrome.padding, "0px", "mode switch should not have pill padding");
    assert.notEqual(modeChrome.indicatorWidth, "0px", "active mode should retain a visible indicator");
    assert.equal(await page.locator("[data-jobs-panel='overview']").isVisible(), true);
    const dimensions = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth }));
    assert.ok(dimensions.documentWidth <= dimensions.viewportWidth + 1, `horizontal overflow: ${JSON.stringify(dimensions)}`);
    await page.locator("a[data-jobs-view='opportunities']").click();
    await page.locator("#show-add-job").click();
    await page.locator("#add-title").fill("Browser Test Job");
    await page.locator("#add-company").fill("Browser Studio");
    await page.locator("#add-description").fill("A browser-created opportunity with enough detail for the manual pipeline.");
    await page.locator("#add-url").fill("https://jobs.example/browser");
    const addResponsePromise = page.waitForResponse((response: any) => response.request().method() === "POST" && new URL(response.url()).pathname === "/__auvrynt/dashboard/jobs/add");
    const addDataResponsePromise = page.waitForResponse((response: any) => response.request().method() === "GET" && new URL(response.url()).pathname === "/dashboard/jobs/data");
    await page.locator("#add-job-form button[type='submit']").click();
    assert.equal((await addResponsePromise).status(), 200, "manual add must reach the Jobs add endpoint");
    await addDataResponsePromise;
    await page.waitForFunction(() => document.querySelector(".job-table tbody")?.textContent?.includes("Browser Test Job"));
    const filterResponsePromise = page.waitForResponse((response: any) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === "/dashboard/jobs/opportunities"
        && url.searchParams.get("query") === "Browser Test Job";
    });
    await page.locator("#job-query").fill("Browser Test Job");
    await page.locator("#job-sort").selectOption("match");
    await page.locator("#job-search-form button[type='submit']").click();
    assert.equal((await filterResponsePromise).status(), 200);
    await page.waitForFunction(() => (document.querySelector("#job-query") as HTMLInputElement | null)?.value === "Browser Test Job");
    assert.equal(await page.locator("#job-query").inputValue(), "Browser Test Job", "search text must survive a filtered rerender");
    assert.equal(await page.locator("#job-sort").inputValue(), "match", "sort choice must survive a filtered rerender");
    assert.deepEqual(await page.locator("#job-status option").evaluateAll((options: HTMLOptionElement[]) => options.map((option) => option.value)), ["", "NEW", "REVIEW", "SHORTLISTED", "READY_TO_APPLY", "APPLIED", "REPLIED", "INTERVIEW", "OFFER", "REJECTED", "CLOSED", "ARCHIVED"]);
    const statusSelect = page.locator("#jobs-view-opportunities select[data-status]").last();
    const statusResponsePromise = page.waitForResponse((response: any) => response.request().method() === "POST" && /\/status$/.test(new URL(response.url()).pathname));
    await statusSelect.selectOption("SHORTLISTED");
    const statusResponse = await statusResponsePromise;
    assert.equal(statusResponse.status(), 200, "changing an opportunity status must reach the Jobs status endpoint");
    await page.waitForFunction(() => (document.querySelector("#job-query") as HTMLInputElement | null)?.value === "Browser Test Job" && (document.querySelector("#job-sort") as HTMLSelectElement | null)?.value === "match");
    if (viewport.width === 1280) {
      await page.locator("#job-query").fill("Pagination Audit Job");
      const paginationFilterResponse = page.waitForResponse((response: any) => response.request().method() === "GET" && new URL(response.url()).pathname === "/dashboard/jobs/opportunities");
      await page.locator("#job-search-form button[type='submit']").click();
      await paginationFilterResponse;
      assert.equal(await page.locator("#next-page").isEnabled(), true, "55 matching jobs should enable filtered pagination");
      const nextPageResponse = page.waitForResponse((response: any) => response.request().method() === "GET" && new URL(response.url()).searchParams.get("page") === "2");
      await page.locator("#next-page").click();
      await nextPageResponse;
      assert.match((await page.locator(".pagination").textContent()) ?? "", /Page 2 of 2/);
      assert.equal(await page.locator("#job-query").inputValue(), "Pagination Audit Job", "pagination must preserve the active search filter");
      assert.equal(await page.locator(".job-table tbody tr").count(), 5, "filtered page 2 should contain only the remaining five matching jobs");
      await page.locator("a[data-jobs-view='overview']").click();
      await page.waitForFunction(() => document.querySelector("[data-jobs-panel='overview']")?.textContent?.includes("Risk Attention Job"));
      assert.match((await page.locator("[data-jobs-panel='overview']").textContent()) ?? "", /Risk Attention Job/, "Overview attention items must remain global after filtering Opportunities");
    }
    await page.locator("a[data-jobs-view='tracker']").click();
    await page.waitForFunction(() => document.querySelector("[data-jobs-panel='tracker']")?.textContent?.includes("Browser Test Job"));
    assert.equal(await page.locator("[data-jobs-panel='tracker']").isVisible(), true);
    const shortlistedColumn = page.locator(".tracker-column").filter({ hasText: "SHORTLISTED /" });
    assert.match((await shortlistedColumn.textContent()) ?? "", /Browser Test Job/, "the server-side status change must move the job into the SHORTLISTED tracker column");
    await page.locator("#tracker-table-mode").click();
    assert.equal(await page.locator(".tracker-table").isVisible(), true);
    await page.locator("a[data-jobs-view='profile']").click();
    await page.waitForSelector("#profile-salary");
    assert.equal(await page.locator("#profile-salary").isVisible(), true);
    assert.equal(await page.locator("#profile-employment").isVisible(), true);
    assert.equal(await page.locator(".preference-fieldset").isVisible(), true);
    await page.locator("a[data-jobs-view='integrations']").click();
    await page.waitForSelector("#jobs-view-integrations .integration-grid");
    assert.equal(await page.locator(".integration-grid").isVisible(), true);
    assert.equal(await page.locator(".integration-card").count(), 2);
    assert.equal(await page.locator(".integration-status.status-disabled").count(), 1);
    assert.match(await page.locator("#jobs-view-integrations").textContent(), /Server setup required/);
    const integrationsDimensions = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth }));
    assert.ok(integrationsDimensions.documentWidth <= integrationsDimensions.viewportWidth + 1, `integrations overflow: ${JSON.stringify(integrationsDimensions)}`);
    assert.deepEqual(errors, [], `runtime page errors at ${viewport.width}: ${errors.join("; ")}`);
    assert.deepEqual(failed, [], `failed requests at ${viewport.width}: ${failed.join("; ")}`);
    await context.close();
  }
  console.log("jobs dashboard browser tests passed");
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(stateDir, { recursive: true, force: true });
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
