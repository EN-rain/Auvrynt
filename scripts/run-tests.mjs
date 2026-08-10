import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const tests = [
  "src/architecture-boundaries.test.ts",
  "src/process/background-lifecycle.test.ts",
  "src/cli/runtime-support.test.ts",
  "src/infrastructure/logger-dashboard.test.ts",
  "src/db/sqlite-native-probe.test.ts",
  "src/infrastructure/config.test.ts",
  "src/infrastructure/ngrok-auth-pool.test.ts",
  "src/cli/dashboard-native-actions.test.ts",
  "src/cli/dashboard-tools-action.test.ts",
  "src/cli/tunnel-health-monitor.test.ts",
  "src/cli/serena-detected-default.test.ts",
  "src/tunnels/ngrok-tunnel.test.ts",
  "src/infrastructure/user-config.test.ts",
  "src/auth/oauth-provider.test.ts",
  "src/process/control-retry.test.ts",
  "src/process/crash-recovery.test.ts",
  "src/infrastructure/mcp-event-store.test.ts",
  "src/infrastructure/sse-heartbeat.test.ts",
  "src/infrastructure/tool-result-budget.test.ts",
  "src/integrations/playwright/browser-stability.test.ts",
  "src/tests/sustained-use.test.ts",
  "src/server/server-sustained-use.test.ts",
  "src/infrastructure/http-server-hardening.test.ts",
  "src/server/server-guardrails.test.ts",
  "src/server/mcp-tool-registrar.test.ts",
  "src/server/tool-inventory-seed.test.ts",
  "src/server/openai-session-hint.test.ts",
  "src/server/workspace-analytics.test.ts",
  "src/server/workspace-analytics-tools.test.ts",
  "src/server/dashboard-page.browser.test.ts",
  "src/tests/multi-agent-isolation.test.ts",
  "src/tests/multi-session-concurrency.test.ts",
  "src/tests/long-project-continuity.test.ts",
  "src/workspace/roots.test.ts",
  "src/workspace/skills.test.ts",
  "src/integrations/images/view-image.test.ts",
  "src/process/processes.test.ts",
  "src/workspace/search-discovery.test.ts",
  "src/integrations/playwright/playwright-runtime.test.ts",
  "src/integrations/playwright/web-tools.test.ts",
  "src/integrations/images/window-capture.test.ts",
  "src/integrations/images/image-tools.test.ts",
  "src/ui/lightweight-diff.test.ts",
  "src/ui/theme-contract.test.ts",
  "src/integrations/dotnet/dotnet-tools.test.ts",
  "src/integrations/godot/godot-tools.test.ts",
  "src/integrations/godot/godot-editor-bridge.test.ts",
  "src/integrations/godot/godot-dotnet-env.test.ts",
  "src/integrations/godot/godot-csharp-project.test.ts",
  "src/integrations/godot/godot-csharp-runner.test.ts",
  "src/integrations/godot/godot-csharp-semantic.test.ts",
  "src/integrations/blender/blender-tools.test.ts",
  "src/integrations/aseprite/aseprite-tools.test.ts",
  "src/integrations/godot/godot-gdscript.test.ts",
  "src/workspace/review-checkpoints.test.ts",
  "src/workspace/workspaces.test.ts",
  "src/integrations/integration-discovery.test.ts",
  "src/auth/connection-registry.test.ts",
  "src/auth/connection-status.test.ts",
  "src/integrations/serena/serena-manager.test.ts",
  "src/auth/session-registry.test.ts",
  "src/auth/room-registry.test.ts",
  "src/infrastructure/tool-capabilities.test.ts",
  "src/infrastructure/request-context.test.ts",
  "src/process/process-ownership.test.ts",
  "src/infrastructure/integration-queue.test.ts",
];

const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const configuredConcurrency = Number.parseInt(process.env.AUVRYNT_TEST_CONCURRENCY ?? "", 10);
const concurrency = Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
  ? Math.min(configuredConcurrency, tests.length)
  : Math.min(4, availableParallelism(), tests.length);
const configuredTimeout = Number.parseInt(process.env.AUVRYNT_TEST_TIMEOUT_MS ?? "", 10);
const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout >= 1_000
  ? configuredTimeout
  : 180_000;
const maxCapturedBytes = 2 * 1024 * 1024;

let nextIndex = 0;
let failed = false;
const startedAt = Date.now();
const activeChildren = new Set();

function appendLimited(current, chunk) {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  return next.length <= maxCapturedBytes ? next : next.subarray(next.length - maxCapturedBytes);
}

function stopActiveChildren() {
  for (const child of activeChildren) {
    child.kill("SIGTERM");
  }
}

function runTest(testPath) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [tsxCli, testPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    activeChildren.add(child);

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    child.stdout.on("data", (chunk) => { stdout = appendLimited(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendLimited(stderr, chunk); });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    timeout.unref();

    child.on("error", (error) => {
      stderr = appendLimited(stderr, Buffer.from(`${error.stack ?? error.message}\n`));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      activeChildren.delete(child);
      const durationMs = Date.now() - start;
      const passed = code === 0 && !timedOut;
      if (passed) {
        console.log(`PASS ${testPath} (${durationMs}ms)`);
      } else {
        failed = true;
        console.error(`FAIL ${testPath} (${durationMs}ms, code=${code ?? "null"}, signal=${signal ?? "none"}${timedOut ? ", timeout" : ""})`);
        if (stdout.length > 0) console.error(`--- stdout ---\n${stdout.toString("utf8").trimEnd()}`);
        if (stderr.length > 0) console.error(`--- stderr ---\n${stderr.toString("utf8").trimEnd()}`);
        stopActiveChildren();
      }
      resolve(passed);
    });
  });
}

async function worker() {
  while (!failed) {
    const index = nextIndex++;
    if (index >= tests.length) return;
    const passed = await runTest(tests[index]);
    if (!passed) return;
  }
}

const workers = Array.from({ length: concurrency }, () => worker());
await Promise.all(workers);

const durationMs = Date.now() - startedAt;
if (failed) {
  console.error(`Test suite failed after ${durationMs}ms.`);
  process.exitCode = 1;
} else {
  console.log(`All ${tests.length} tests passed in ${durationMs}ms with concurrency ${concurrency}.`);
}
