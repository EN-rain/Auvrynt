import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Request } from "express";
import {
  INTEGRATION_KEYS,
  atomicWriteJson,
  readJsonFile,
  type InstanceLockRecord,
  type IntegrationKey,
} from "../background-lifecycle.js";
import {
  MAX_MCP_SESSIONS,
  MAX_SESSION_IDLE_TIMEOUT_MS,
  MIN_SESSION_IDLE_TIMEOUT_MS,
  type ServerConfig,
} from "../config.js";
import {
  activateNgrokAuthtoken,
  addNgrokAuthtoken,
  getCurrentNgrokAuthtoken,
  removeNgrokAuthtoken,
} from "../infrastructure/ngrok-auth-pool.js";
import {
  clearContext7ApiKey,
  setContext7ApiKey,
} from "../infrastructure/context7-auth.js";
import { isLoopbackRequest, logEvent } from "../logger.js";
import type { RunningServer } from "../server.js";
import { loadAuvryntFiles, writeAuvryntConfig } from "../user-config.js";
import { selfHealStartIntegrations } from "./integration-bootstrap.js";
import { applyIntegrationProfile } from "./lifecycle-manager.js";
import { httpUrl } from "./runtime-support.js";
import { selectNativeWorkspaceFolder } from "./dashboard-native-actions.js";
import { groupToolsByName } from "../server/tool-groups.js";
import { registeredToolNamesForIntegration } from "../server/mcp-tool-registrar.js";

export interface DashboardActionDependencies {
  runningServer: RunningServer;
  config: ServerConfig;
  requestShutdown(): void;
}

export function registerDashboardActions({
  runningServer,
  config,
  requestShutdown,
}: DashboardActionDependencies): void {
  const { app } = runningServer;
  const dashboardOrigins = new Set([
    httpUrl("127.0.0.1", config.port),
    httpUrl("localhost", config.port),
    httpUrl(config.host, config.port),
  ]);
  let lastDashboardActionAt = 0;
  let dashboardRestartQueued = false;
  let dashboardStopQueued = false;
  let workspacePickerActive = false;

  const actionAuthorized = (req: Request): boolean => {
    if (!isLoopbackRequest(req) || req.header("x-auvrynt-dashboard") !== "1") return false;
    const origin = req.header("origin");
    return !origin || dashboardOrigins.has(origin);
  };
  const actionRateLimited = (): boolean => {
    const now = Date.now();
    if (now - lastDashboardActionAt < 500) return true;
    lastDashboardActionAt = now;
    return false;
  };
  const persistActiveProfiles = async (profiles: IntegrationKey[]): Promise<void> => {
    const lockPath = join(config.stateDir, "server.lock");
    const record = await readJsonFile<InstanceLockRecord>(lockPath);
    if (!record || record.pid !== process.pid) return;
    record.profiles = profiles;
    await atomicWriteJson(lockPath, record);
  };
  const persistLaunchRoot = async (launchRoot: string): Promise<void> => {
    const lockPath = join(config.stateDir, "server.lock");
    const record = await readJsonFile<InstanceLockRecord>(lockPath);
    if (!record || record.pid !== process.pid) return;
    record.launchRoot = launchRoot;
    await atomicWriteJson(lockPath, record);
  };
  const rejectUnauthorized = (req: Request, res: Parameters<Parameters<typeof app.post>[1]>[1]): boolean => {
    if (actionAuthorized(req)) return false;
    res.status(404).end();
    return true;
  };
  const rejectRateLimited = (res: Parameters<Parameters<typeof app.post>[1]>[1]): boolean => {
    if (!actionRateLimited()) return false;
    res.status(429).json({ error: "Dashboard actions are being submitted too quickly." });
    return true;
  };
  const queueDashboardRestart = (hard = false): { queued: true } | { queued: false; error: string } => {
    if (dashboardRestartQueued) return { queued: false, error: "Restart is already queued." };
    if (!process.argv[1]) return { queued: false, error: "Restart entrypoint is unavailable." };

    dashboardRestartQueued = true;
    setTimeout(() => {
      const environment = { ...process.env };
      delete environment.AUVRYNT_START_MODE;
      delete environment.AUVRYNT_CONTROL_TOKEN;
      // Preserve the managed tunnel URL for a normal dashboard restart so the
      // public MCP address survives while only the local server process cycles.
      delete environment.AUVRYNT_ALLOWED_ROOTS;
      delete environment.AUVRYNT_WORKTREE_ROOT;
      if (hard) delete environment.AUVRYNT_MANAGED_TUNNEL_URL;
      const child = spawn(process.execPath, [process.argv[1]!, "restart", ...(hard ? ["hard"] : [])], {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: environment,
      });
      child.once("error", (error) => {
        dashboardRestartQueued = false;
        logEvent(config.logging, "error", "dashboard_restart_spawn_failed", {
          error: error.message,
        });
      });
      child.unref();
    }, 180).unref();
    return { queued: true };
  };

  app.post("/__auvrynt/dashboard/integrations", async (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    const body = req.body as { integration?: unknown; enabled?: unknown };
    if (
      typeof body.integration !== "string"
      || !INTEGRATION_KEYS.includes(body.integration as IntegrationKey)
      || typeof body.enabled !== "boolean"
    ) {
      res.status(400).json({ error: "Invalid integration update." });
      return;
    }

    const key = body.integration as IntegrationKey;
    const integrations = { ...config.integrations, [key]: body.enabled };
    try {
      const healed = body.enabled
        ? await selfHealStartIntegrations(process.cwd(), config.executables, integrations)
        : {};
      const result = await runningServer.updateIntegrations(integrations, healed);
      if (!result.updated) {
        res.status(409).json({
          error: "An MCP tool call is active; retry after it finishes.",
          ...result,
        });
        return;
      }

      const profiles = INTEGRATION_KEYS.filter((profile) => integrations[profile]);
      applyIntegrationProfile(profiles);
      await persistActiveProfiles(profiles);
      logEvent(config.logging, "info", "dashboard_integration_updated", {
        integration: key,
        enabled: body.enabled,
      });
      res.json({
        ...result,
        integrations,
        message: `${key} ${body.enabled ? "enabled" : "disabled"}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent(config.logging, "error", "dashboard_integration_update_failed", {
        integration: key,
        error: message,
      });
      res.status(500).json({ error: message });
    }
  });

  app.post("/__auvrynt/dashboard/tools", async (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    const body = req.body as { integration?: unknown; name?: unknown; enabled?: unknown; group?: unknown; groupEnabled?: unknown };
    if (typeof body.integration !== "string" || !INTEGRATION_KEYS.includes(body.integration as IntegrationKey)) {
      res.status(400).json({ error: "Invalid integration update." });
      return;
    }
    if (typeof body.name === "string") {
      if (typeof body.enabled !== "boolean") {
        res.status(400).json({ error: "A tool toggle needs an enabled boolean." });
        return;
      }
      const toggles = { ...config.toolToggles };
      if (body.enabled) delete toggles[body.name];
      else toggles[body.name] = false;
      config.toolToggles = toggles;
      try {
        const files = loadAuvryntFiles();
        writeAuvryntConfig({ ...files.config, toolToggles: toggles });
        runningServer.refreshToolAvailability();
        logEvent(config.logging, "info", "dashboard_tool_toggled", {
          integration: body.integration,
          tool: body.name,
          enabled: body.enabled,
        });
        res.json({ message: `${body.name} ${body.enabled ? "enabled" : "disabled"}.`, toolToggles: toggles });
      } catch (error) {
        config.toolToggles = toggles;
        const message = error instanceof Error ? error.message : String(error);
        logEvent(config.logging, "error", "dashboard_tool_toggle_failed", {
          tool: body.name,
          error: message,
        });
        res.status(500).json({ error: message });
      }
      return;
    }
    if (typeof body.group === "string" && typeof body.groupEnabled === "boolean") {
      const toggles = { ...config.toolToggles };
      const grouped = groupToolsByName(registeredToolNamesForIntegration(body.integration));
      for (const name of grouped.get(body.group) ?? []) {
        if (body.groupEnabled) delete toggles[name];
        else toggles[name] = false;
      }
      config.toolToggles = toggles;
      try {
        const files = loadAuvryntFiles();
        writeAuvryntConfig({ ...files.config, toolToggles: toggles });
        runningServer.refreshToolAvailability();
        logEvent(config.logging, "info", "dashboard_tool_group_toggled", {
          integration: body.integration,
          group: body.group,
          enabled: body.groupEnabled,
        });
        res.json({ message: `Group ${body.group} ${body.groupEnabled ? "enabled" : "disabled"}.`, toolToggles: toggles });
      } catch (error) {
        config.toolToggles = toggles;
        const message = error instanceof Error ? error.message : String(error);
        logEvent(config.logging, "error", "dashboard_tool_group_toggle_failed", {
          group: body.group,
          error: message,
        });
        res.status(500).json({ error: message });
      }
      return;
    }
    res.status(400).json({ error: "Provide a tool name or a group to update." });
  });

  app.post("/__auvrynt/dashboard/ngrok-tokens", async (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    const body = req.body as { action?: unknown; token?: unknown; index?: unknown };
    if (body.action === "copy") {
      const token = getCurrentNgrokAuthtoken();
      if (!token) {
        res.status(404).json({ error: "No current ngrok authtoken is configured." });
        return;
      }
      logEvent(config.logging, "info", "dashboard_ngrok_token_copied", {
        source: process.env.AUVRYNT_NGROK_AUTHTOKEN?.trim() ? "environment" : "saved_pool",
      });
      res.json({ token, message: "Current ngrok secret copied." });
      return;
    }
    if (body.action !== "add" && body.action !== "remove" && body.action !== "activate") {
      res.status(400).json({ error: "Invalid ngrok token action." });
      return;
    }

    try {
      const result = body.action === "add"
        ? addNgrokAuthtoken(body.token)
        : body.action === "remove"
          ? removeNgrokAuthtoken(body.index)
          : activateNgrokAuthtoken(body.index);
      const shouldRestart = config.tunnelProvider === "ngrok"
        && result.activeChanged
        && !result.summary.environmentOverride;
      const restart = shouldRestart ? queueDashboardRestart(true) : undefined;
      if (shouldRestart && !restart?.queued) {
        res.status(409).json({ error: restart?.error ?? "Auvrynt could not queue the tunnel restart." });
        return;
      }
      const selected = result.summary.tokens.find((token) => token.active);
      logEvent(config.logging, "info", "dashboard_ngrok_token_updated", {
        action: body.action,
        tokenCount: result.summary.tokens.length,
        activeFingerprint: selected?.fingerprint,
        restartQueued: Boolean(restart?.queued),
      });
      res.status(restart?.queued ? 202 : 200).json({
        ngrok: result.summary,
        restarting: Boolean(restart?.queued),
        message: restart?.queued
          ? "ngrok credentials updated. Restarting Auvrynt with the selected token; the public URL may change unless a stable ngrok URL is configured."
          : "ngrok credentials updated.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent(config.logging, "warn", "dashboard_ngrok_token_update_failed", {
        action: body.action,
        error: message,
      });
      res.status(400).json({ error: message });
    }
  });

  app.post("/__auvrynt/dashboard/context7-key", async (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    const body = req.body as { action?: unknown; apiKey?: unknown };
    if (body.action !== "set" && body.action !== "clear") {
      res.status(400).json({ error: "Invalid Context7 key action." });
      return;
    }
    try {
      const result = body.action === "set"
        ? setContext7ApiKey(body.apiKey)
        : clearContext7ApiKey();
      logEvent(config.logging, "info", "dashboard_context7_key_updated", {
        action: body.action,
        configured: result.summary.configured,
        fingerprint: result.summary.fingerprint,
      });
      res.status(200).json({
        context7: result.summary,
        message: body.action === "set"
          ? "Context7 API key saved locally."
          : "Context7 API key removed."
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent(config.logging, "warn", "dashboard_context7_key_update_failed", {
        action: body.action,
        error: message,
      });
      res.status(400).json({ error: message });
    }
  });

  app.post("/__auvrynt/dashboard/select-workspace", async (req, res) => {
    if (rejectUnauthorized(req, res)) return;
    if (workspacePickerActive) {
      res.status(409).json({ error: "A workspace folder picker is already open." });
      return;
    }
    workspacePickerActive = true;
    try {
      const path = await selectNativeWorkspaceFolder(config.allowedRoots[0] ?? process.cwd());
      res.json(path ? { path, canceled: false } : { canceled: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent(config.logging, "error", "dashboard_workspace_picker_failed", { error: message });
      res.status(500).json({ error: message });
    } finally {
      workspacePickerActive = false;
    }
  });

  app.post("/__auvrynt/dashboard/public-url", (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    if (process.env.AUVRYNT_PUBLIC_BASE_URL !== undefined || process.env.AUVRYNT_TUNNEL_PROVIDER !== undefined) {
      res.status(409).json({
        error: "The public URL or tunnel provider is controlled by an environment variable. Remove that override before editing it here.",
      });
      return;
    }
    const body = req.body as { publicBaseUrl?: unknown };
    if (typeof body.publicBaseUrl !== "string") {
      res.status(400).json({ error: "Enter a valid HTTPS public URL." });
      return;
    }
    try {
      const parsed = new URL(body.publicBaseUrl.trim());
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
        || parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw new Error("Enter an HTTPS origin without credentials, a custom port, /mcp, query, or fragment.");
      }
      const files = loadAuvryntFiles();
      writeAuvryntConfig({
        ...files.config,
        tunnelProvider: "custom",
        publicBaseUrl: parsed.origin,
      });
      const restart = queueDashboardRestart(true);
      if (!restart.queued) {
        res.status(409).json({ error: restart.error });
        return;
      }
      logEvent(config.logging, "warn", "dashboard_public_url_updated", {
        hostname: parsed.hostname,
        restartQueued: true,
      });
      res.status(202).json({
        message: "Switching to the custom external URL and restarting Auvrynt.",
        restarting: true,
        publicBaseUrl: parsed.origin,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/__auvrynt/dashboard/session-limit", async (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    if (process.env.AUVRYNT_MAX_SESSIONS !== undefined || process.env.AUVRYNT_MAX_SESSIONS_PER_CLIENT !== undefined) {
      res.status(409).json({
        error: "MCP session limits are controlled by environment variables. Remove those overrides before editing the limit here.",
      });
      return;
    }
    const body = req.body as { maxSessions?: unknown };
    const maxSessions = Number(body.maxSessions);
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > MAX_MCP_SESSIONS) {
      res.status(400).json({ error: `MCP session limit must be between 1 and ${MAX_MCP_SESSIONS}.` });
      return;
    }
    const files = loadAuvryntFiles();
    writeAuvryntConfig({
      ...files.config,
      maxSessions,
      maxSessionsPerClient: maxSessions,
    });
    runningServer.updateSessionLimit(maxSessions);
    logEvent(config.logging, "info", "dashboard_session_limit_updated", { maxSessions });
    res.json({
      message: `MCP session limit changed to ${maxSessions}.`,
      maxSessions,
    });
  });

  app.post("/__auvrynt/dashboard/session-idle-timeout", async (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    if (process.env.AUVRYNT_SESSION_IDLE_MS !== undefined) {
      res.status(409).json({
        error: "MCP idle timeout is controlled by AUVRYNT_SESSION_IDLE_MS. Remove that environment override before editing it here.",
      });
      return;
    }
    const body = req.body as { idleTimeoutMinutes?: unknown };
    const idleTimeoutMinutes = Number(body.idleTimeoutMinutes);
    const timeoutMs = idleTimeoutMinutes * 60 * 1000;
    if (!Number.isInteger(idleTimeoutMinutes)
      || timeoutMs < MIN_SESSION_IDLE_TIMEOUT_MS
      || timeoutMs > MAX_SESSION_IDLE_TIMEOUT_MS) {
      res.status(400).json({
        error: `MCP idle timeout must be a whole number of minutes between ${MIN_SESSION_IDLE_TIMEOUT_MS / 60_000} and ${MAX_SESSION_IDLE_TIMEOUT_MS / 60_000}.`,
      });
      return;
    }
    const files = loadAuvryntFiles();
    writeAuvryntConfig({ ...files.config, sessionIdleTimeoutMs: timeoutMs });
    runningServer.updateSessionIdleTimeout(timeoutMs);
    logEvent(config.logging, "info", "dashboard_session_idle_timeout_updated", { idleTimeoutMinutes });
    res.json({
      message: `MCP idle timeout changed to ${idleTimeoutMinutes} minutes.`,
      sessionIdleTimeoutMs: timeoutMs,
      idleTimeoutMinutes,
    });
  });

  app.post("/__auvrynt/dashboard/workspace", async (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;

    const body = req.body as { path?: unknown };
    if (typeof body.path !== "string" || !body.path.trim()) {
      res.status(400).json({ error: "Enter an absolute workspace directory." });
      return;
    }

    const root = resolve(body.path.trim());
    try {
      const info = await stat(root);
      if (!info.isDirectory()) {
        res.status(400).json({ error: "The selected workspace path is not a directory." });
        return;
      }
      const previousRoots = [...config.allowedRoots];
      const update = runningServer.updateWorkspaceRoots([root]);
      if (!update.updated) {
        res.status(409).json({
          error: "A tool call is active. Retry the workspace change after it finishes.",
          ...update,
        });
        return;
      }

      try {
        const files = loadAuvryntFiles();
        writeAuvryntConfig({ ...files.config, allowedRoots: [root] });
        await persistLaunchRoot(root);
      } catch (error) {
        runningServer.updateWorkspaceRoots(previousRoots);
        throw error;
      }
      logEvent(config.logging, "info", "dashboard_workspace_updated", {
        root,
        closedWorkspaces: update.closedWorkspaces,
      });
      res.json({
        message: "Workspace changed.",
        allowedRoots: [root],
        closedWorkspaces: update.closedWorkspaces,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dashboardRestartQueued = false;
      logEvent(config.logging, "error", "dashboard_workspace_update_failed", {
        root,
        error: message,
      });
      res.status(400).json({ error: `Unable to use that workspace directory: ${message}` });
    }
  });

  app.post("/__auvrynt/dashboard/restart", (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    const restart = queueDashboardRestart();
    if (!restart.queued) {
      res.status(409).json({ error: restart.error });
      return;
    }

    logEvent(config.logging, "warn", "dashboard_restart_requested");
    res.status(202).json({
      message: "Restarting Auvrynt. The public MCP URL will remain unchanged.",
      restarting: true,
    });
  });

  app.post("/__auvrynt/dashboard/stop", (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    if (dashboardStopQueued) {
      res.status(409).json({ error: "Stop is already in progress." });
      return;
    }
    dashboardStopQueued = true;
    logEvent(config.logging, "warn", "dashboard_stop_requested");
    res.status(202).json({ message: "Auvrynt is stopping.", stopping: true });
    setImmediate(requestShutdown);
  });
}
