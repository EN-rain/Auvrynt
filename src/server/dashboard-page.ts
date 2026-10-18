import { AUVRYNT_COMMANDS } from "../infrastructure/command-reference.js";
import { DASHBOARD_PAGE_CSS } from "./dashboard-page-styles.js";
import { dashboardModeSwitcher } from "./dashboard-shell.js";
import type { DashboardView } from "./dashboard.js";
import { MAX_ALLOWED_ROOTS } from "../workspace/roots.js";

const PAGE_META = {
  analytics: {
    kicker: "Operations",
    title: "Analytics",
    description: "",
  },
  connectivity: {
    kicker: "Configuration",
    title: "Connectivity",
    description: "Manage MCP endpoints, the active workspace, and local integrations.",
  },
  secrets: {
    kicker: "Private configuration",
    title: "Secrets",
    description: "Manage OS-protected local ngrok credentials and automatic quota failover.",
  },
  logs: {
    kicker: "Observability",
    title: "Logs",
    description: "Inspect MCP, tool, authentication, and lifecycle events.",
  },
  commands: {
    kicker: "Reference",
    title: "Commands",
    description: "Search the local Auvrynt command surface.",
  },
  tools: {
    kicker: "Configuration",
    title: "Tool settings",
    description: "Enable or disable individual integration tools. Disabled tools disappear from the MCP tool list.",
  },
} as const;

export function dashboardHtml(view: DashboardView, nonce: string, dashboardControlToken: string): string {
  const commands = commandMarkup();
  const initialData = jsonForHtml(view);
  const dashboardControlTokenJson = jsonForHtml(dashboardControlToken);
  const firstRoot = view.allowedRoots[0] ?? "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Auvrynt Dashboard</title>
    <style nonce="${escapeHtml(nonce)}">
      ${DASHBOARD_PAGE_CSS}
    </style>
  </head>
  <body>
    <div class="app-shell">
      <aside class="control-rail" aria-label="Auvrynt controls">
        <div class="dashboard-brand-row">
          <div class="brand">
          <img src="/brand-assets/auvrynt-icon.png" alt="" width="38" height="38" />
          <div><span class="brand-name">Auvrynt</span><span class="brand-version">PID <span id="rail-pid">${view.pid}</span></span></div>
          </div>
          ${dashboardModeSwitcher("code")}
        </div>

        <section class="agent-presence" id="agent-presence" data-state="${view.agentState}" aria-live="polite">
          <div class="presence-head"><span class="presence-dot" aria-hidden="true"></span><strong class="presence-title" id="presence-title">${escapeHtml(agentStateLabel(view))}</strong></div>
          <p class="presence-detail" id="presence-detail">${escapeHtml(agentStateDetail(view))}</p>
        </section>

        <p class="rail-label">Workspace</p>
        <nav class="dashboard-nav" role="tablist" aria-label="Dashboard views" aria-orientation="vertical">
          <button class="nav-tab" id="tab-analytics" type="button" role="tab" aria-selected="true" aria-controls="view-analytics" data-view="analytics"><span class="nav-icon">A</span><span class="nav-label">Analytics</span><span class="nav-count" id="nav-session-count">${view.sessions}/${view.maxSessions}</span></button>
          <button class="nav-tab" id="tab-connectivity" type="button" role="tab" aria-selected="false" aria-controls="view-connectivity" data-view="connectivity"><span class="nav-icon">C</span><span class="nav-label">Connectivity</span><span class="nav-count">${view.integrations.filter((item) => item.enabled).length}</span></button>
          <button class="nav-tab" id="tab-secrets" type="button" role="tab" aria-selected="false" aria-controls="view-secrets" data-view="secrets"><span class="nav-icon">S</span><span class="nav-label">Secrets</span><span class="nav-count" id="nav-token-count">${view.ngrok.tokens.length}</span></button>
          <button class="nav-tab" id="tab-logs" type="button" role="tab" aria-selected="false" aria-controls="view-logs" data-view="logs"><span class="nav-icon">L</span><span class="nav-label">Logs</span><span class="nav-count" id="nav-log-count">${view.logs.length}</span></button>
          <button class="nav-tab" id="tab-commands" type="button" role="tab" aria-selected="false" aria-controls="view-commands" data-view="commands"><span class="nav-icon">›_</span><span class="nav-label">Commands</span><span class="nav-count">${AUVRYNT_COMMANDS.length}</span></button>
        </nav>

        <div class="rail-spacer"></div>
        <div class="lifecycle">
          <button class="button primary" id="restart" type="button">Restart</button>
          <button class="button stop" id="stop" type="button">Stop</button>
        </div>
        <p class="rail-meta">Local control surface<br />Uptime <span id="rail-uptime">${escapeHtml(formatUptime(view.uptimeSeconds))}</span></p>
      </aside>

      <main class="workspace">
        <header class="workspace-header">
          <div>
            <p class="page-kicker" id="page-kicker">${PAGE_META.analytics.kicker}</p>
            <h1 class="page-title" id="page-title">${PAGE_META.analytics.title}</h1>
            <p class="page-description" id="page-description" hidden>${PAGE_META.analytics.description}</p>
          </div>
          <div class="server-state">
            <span class="server-state-dot" id="server-state-dot" aria-hidden="true"></span>
            <span class="server-state-copy"><strong id="server-state-title">Server online</strong><small id="server-state-detail">Refreshes every 2 seconds</small></span>
          </div>
        </header>

        <section class="tunnel-alert" id="tunnel-alert" role="alert" hidden>
          <span class="tunnel-alert-icon" aria-hidden="true">!</span>
          <div class="tunnel-alert-copy"><strong id="tunnel-alert-title"></strong><p id="tunnel-alert-message"></p></div>
          <button class="button" id="open-secrets" type="button">Open Secrets</button>
        </section>

        <section class="dashboard-view" id="view-analytics" role="tabpanel" aria-labelledby="tab-analytics" data-view-panel="analytics">
          <div class="analytics-lead">
            <section class="activity-surface" id="activity-surface" data-agent-state="${view.agentState}">
              <div class="activity-copy">
                <div>
                  <p class="surface-label">Web agent presence</p>
                  <h2 class="agent-headline" id="agent-headline">${escapeHtml(agentHeadline(view))}</h2>
                  <p class="agent-caption" id="agent-caption">${escapeHtml(agentCaption(view))}</p>
                </div>
                <div class="activity-foot"><span id="agent-sessions">${view.sessions} active session${view.sessions === 1 ? "" : "s"}</span><span id="agent-tools">${view.activeToolCalls} tool call${view.activeToolCalls === 1 ? "" : "s"} running</span><span id="agent-last-seen">${escapeHtml(lastSeenLabel(view.agentLastSeenAt))}</span></div>
              </div>
            </section>

            <section class="change-surface" aria-labelledby="change-title">
              <div class="change-head"><div><p class="surface-label">Current workspace</p><h2 id="change-title">Agent changes</h2><p class="change-workspace" id="change-workspace" title="${escapeHtml(view.workspaceChanges.workspaceRoot ?? "No workspace opened")}">${escapeHtml(view.workspaceChanges.workspaceRoot ?? "No workspace opened")}</p></div><span class="change-sampled" id="change-sampled">${escapeHtml(agentChangeLabel(view.workspaceChanges.workspaceRoot, view.workspaceChanges.sampledAt))}</span></div>
              <div class="code-delta"><div class="delta add"><strong id="change-additions" title="+${view.workspaceChanges.additions.toLocaleString()}">+${escapeHtml(formatMetricNumber(view.workspaceChanges.additions))}</strong><span>Lines added</span></div><div class="delta remove"><strong id="change-removals" title="−${view.workspaceChanges.removals.toLocaleString()}">−${escapeHtml(formatMetricNumber(view.workspaceChanges.removals))}</strong><span>Lines removed</span></div></div>
              <div class="file-delta"><div><strong id="files-created">${view.workspaceChanges.filesCreated}</strong><span>Created</span></div><div><strong id="files-modified">${view.workspaceChanges.filesModified}</strong><span>Modified</span></div><div><strong id="files-deleted">${view.workspaceChanges.filesDeleted}</strong><span>Deleted</span></div></div>
            </section>
          </div>

          <div class="runtime-strip" aria-label="Runtime metrics">
            <div class="runtime-metric"><span>MCP sessions</span><strong id="metric-sessions">${view.sessions} / ${view.maxSessions}</strong></div>
            <div class="runtime-metric"><span>Managed processes</span><strong id="metric-processes">${view.runningProcesses}</strong></div>
            <div class="runtime-metric"><span>Tool calls sampled</span><strong id="metric-tools">0</strong></div>
            <div class="runtime-metric"><span>Average HTTP</span><strong id="metric-http">—</strong></div>
            <div class="runtime-metric"><span>Server uptime</span><strong id="metric-uptime">${escapeHtml(formatUptime(view.uptimeSeconds))}</strong></div>
          </div>

          <div class="analytics-lower">
            <section class="analytics-panel" aria-labelledby="activity-title">
              <div class="analytics-panel-head"><h3 id="activity-title">Operational activity</h3><small id="analytics-window">Latest 0 events</small></div>
              <div class="activity-chart" id="activity-chart" aria-label="Recent event activity chart"></div>
              <div class="chart-axis"><span>30m ago</span><span>15m</span><span>Now</span></div>
            </section>
            <div class="analytics-stack">
              <section class="analytics-panel" aria-labelledby="tools-title"><div class="analytics-panel-head"><h3 id="tools-title">Most used tools</h3><small>Current sample</small></div><div class="top-tools" id="top-tools"></div></section>
              <section class="analytics-panel" aria-labelledby="health-title"><div class="analytics-panel-head"><h3 id="health-title">Health signals</h3><small>Warnings and failures</small></div><div class="mix-list" id="health-signals"></div></section>
            </div>
          </div>
        </section>

        <section class="dashboard-view" id="view-connectivity" role="tabpanel" aria-labelledby="tab-connectivity" data-view-panel="connectivity" hidden>
          <div class="operations-grid">
            <section class="section-surface" aria-labelledby="connection-title">
              <div class="section-head"><div><h2 id="connection-title">Connection</h2><p>Endpoints and the root exposed to web agents.</p></div></div>
              <div class="connection-list">
                <div class="connection-row"><span class="connection-label">Local MCP</span><span class="connection-value"><a id="local-mcp" href="${escapeHtml(view.localMcpUrl)}">${escapeHtml(view.localMcpUrl)}</a></span><button class="icon-button" type="button" data-copy-url="local" aria-label="Copy Local MCP URL" title="Copy Local MCP URL">⧉</button></div>
                <div class="connection-row"><span class="connection-label">Public MCP</span><span class="connection-value"><a id="public-mcp" href="${escapeHtml(view.publicMcpUrl)}">${escapeHtml(view.publicMcpUrl)}</a></span><button class="icon-button" type="button" data-copy-url="public" aria-label="Copy Public MCP URL" title="Copy Public MCP URL">⧉</button></div>
                <div class="connection-row"><span class="connection-label">Arbiter</span><span class="connection-value" id="arbiter-status"></span><span aria-hidden="true"></span></div>
                <div class="connection-row"><span class="connection-label">MCP latency</span><span class="connection-value" id="mcp-request-timing">No samples yet</span><span aria-hidden="true"></span></div>
                <div class="connection-row"><span class="connection-label">Workspace</span><span class="connection-value" id="workspace" title="${escapeHtml(firstRoot)}">${escapeHtml(firstRoot || "No workspace configured")}</span><button class="icon-button" id="edit-workspace" type="button" aria-label="Choose workspace folder" title="Choose workspace folder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.75a1.75 1.75 0 0 1-1.75 1.75H5.25a1.75 1.75 0 0 1-1.75-1.75z"/><path d="M3.5 9h17"/></svg></button></div>
                <form class="session-limit-form" id="session-limit-form"><div class="session-limit-copy"><strong>MCP session limit</strong><small>Maximum concurrent connections</small></div><input class="session-limit-input" id="session-limit-input" type="text" inputmode="numeric" pattern="[1-9][0-9]{0,2}" maxlength="3" value="${view.maxSessions}" aria-label="Maximum concurrent MCP sessions" /><button class="icon-button" id="save-session-limit" type="submit" aria-label="Apply MCP session limit" title="Apply MCP session limit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z"/><path d="m13.5 8.5 3 3"/></svg></button></form>
                <form class="session-limit-form session-idle-timeout-form" id="session-idle-timeout-form"><div class="session-limit-copy"><strong>MCP idle timeout</strong><small>Inactive sessions close; active tool calls are protected</small></div><input class="session-limit-input" id="session-idle-timeout-input" type="text" inputmode="numeric" pattern="[1-9][0-9]{0,4}" maxlength="5" value="${view.sessionIdleTimeoutMinutes}" aria-label="MCP idle timeout in minutes" /><span class="session-time-unit">min</span><button class="icon-button" id="save-session-idle-timeout" type="submit" aria-label="Apply MCP idle timeout" title="Apply MCP idle timeout"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z"/><path d="m13.5 8.5 3 3"/></svg></button></form>
                <form class="session-limit-form" id="tool-display-form"><div class="session-limit-copy"><strong>Tool Call Display</strong><small>Compact keeps short tool text without custom result cards</small></div><select class="session-limit-input" id="tool-display-select" aria-label="Tool Call Display mode"><option value="compact"${view.widgets === "compact" ? " selected" : ""}>Compact</option><option value="changes"${view.widgets === "changes" ? " selected" : ""}>Changes only</option><option value="full"${view.widgets === "full" ? " selected" : ""}>Full cards</option><option value="off"${view.widgets === "off" ? " selected" : ""}>Off</option></select><button class="icon-button" id="save-tool-display" type="submit" aria-label="Apply Tool Call Display mode" title="Apply Tool Call Display mode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z"/><path d="m13.5 8.5 3 3"/></svg></button></form>
              </div>
            </section>

            <section class="section-surface" aria-labelledby="agent-directories-title">
              <div class="section-head">
                <div><h2 id="agent-directories-title">Agent directories</h2><p>Directories web agents can access through Auvrynt. Up to ${MAX_ALLOWED_ROOTS} directories.</p></div>
                <button class="button section-action" id="add-directory" type="button">Add directory</button>
              </div>
              <div class="directory-profile-notes" id="agent-directory-profile-notes" aria-label="Profile directory notes"></div>
              <div class="directory-list" id="agent-directories" aria-live="polite"></div>
            </section>

            <section class="section-surface" aria-labelledby="integrations-title">
              <div class="section-head">
                <div><h2 id="integrations-title">Integrations</h2><p>Availability and live bridge state.</p></div>
                <button class="icon-button" id="open-tool-settings" type="button" aria-label="Open tool settings" title="Tool settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 13.5a7.6 7.6 0 0 0 .1-1.5 7.6 7.6 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a8.2 8.2 0 0 0-2.6-1.5L14 2.8h-4l-.4 2.7a8.2 8.2 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8.2 8.2 0 0 0 2.6 1.5l.4 2.7h4l.4-2.7a8.2 8.2 0 0 0 2.6-1.5l2.4 1 2-3.5z"/></svg></button>
              </div>
              <div class="integration-list" id="integrations"></div>
            </section>

            <section class="section-surface skills-span" aria-labelledby="connectivity-skills-title">
              <div class="section-head">
                <div><h2 id="connectivity-skills-title">Skills</h2><p>Installed Agent Skills available to agents on open_workspace.</p></div>
              </div>
              <div class="skills-meta" id="skills-meta-connectivity"></div>
              <div class="skill-list" id="skill-list-connectivity"></div>
            </section>
          </div>
        </section>
        <section class="dashboard-view" id="view-secrets" role="tabpanel" aria-labelledby="tab-secrets" data-view-panel="secrets" hidden>
          <div class="secret-copy-bar" aria-labelledby="web-agent-secret-title">
            <span class="secret-copy-title" id="web-agent-secret-title">Web-agent authentication</span>
            <button class="button primary" id="copy-web-agent-secret" type="button" aria-describedby="web-agent-secret-help">Copy secret</button>
            <p class="secret-copy-help" id="web-agent-secret-help">Copies the local Owner token used to authenticate a web agent. Keep it private.</p>
            <p class="secret-copy-status" id="web-agent-secret-status" role="status" aria-live="polite"></p>
          </div>
          <div class="secrets-layout">
            <section class="section-surface" aria-labelledby="secret-add-title">
              <div class="section-head"><div><h2 id="secret-add-title">Add ngrok authtoken</h2><p>Values stay in the private local Auvrynt auth file and are never returned to this page.</p></div></div>
              <form class="secret-form" id="ngrok-token-form" autocomplete="off">
                <label class="secret-label" for="ngrok-token-input">ngrok authtoken</label>
                <div class="secret-input-row"><input class="secret-input" id="ngrok-token-input" type="password" minlength="16" maxlength="512" spellcheck="false" autocomplete="new-password" placeholder="Paste a backup authtoken" /><button class="button primary" id="add-ngrok-token" type="submit">Add token</button></div>
                <p class="secret-help">Auvrynt identifies saved tokens only by a one-way SHA-256 fingerprint. On ERR_NGROK_727 it marks the active token exhausted, selects the next available token, and recreates the tunnel. Backup tokens must belong to different ngrok accounts because tokens on one account share the same quota. Unless you configured a stable ngrok URL, the public MCP URL may change and must be updated in the connector.</p>
              </form>
              <p class="secret-warning" id="ngrok-environment-warning" hidden>AUVRYNT_NGROK_AUTHTOKEN currently overrides this pool. Remove the environment variable before automatic switching can use saved tokens.</p>
            </section>

            <section class="section-surface" aria-labelledby="secret-list-title">
              <div class="section-head"><div><h2 id="secret-list-title">Saved ngrok tokens</h2><p>Only fingerprints and health state are displayed.</p></div></div>
              <div class="token-list" id="ngrok-token-list"></div>
            </section>

          </div>
        </section>

        <section class="dashboard-view" id="view-logs" role="tabpanel" aria-labelledby="tab-logs" data-view-panel="logs" hidden>
          <div class="view-toolbar logs-toolbar"><h2>Recent events</h2><input class="search" id="log-search" type="search" placeholder="Search logs…" autocomplete="off" /><div class="log-filter-row" role="group" aria-label="Log categories"><button class="filter active" data-log-filter="all" type="button">All</button><button class="filter" data-log-filter="tool" type="button">Tool</button><button class="filter" data-log-filter="mcp" type="button">MCP</button><button class="filter" data-log-filter="http" type="button">HTTP</button><button class="filter" data-log-filter="auth" type="button">Auth</button><button class="filter" data-log-filter="error" type="button">Error</button></div></div>
          <div class="logs-wrap"><button class="button new-logs" id="new-logs" type="button"></button><div class="logs" id="log-list" tabindex="0" aria-label="Recent Auvrynt logs"></div></div>
        </section>

        <section class="dashboard-view" id="view-commands" role="tabpanel" aria-labelledby="tab-commands" data-view-panel="commands" hidden>
          <div class="view-toolbar command-toolbar"><div><h2>Command reference</h2><p class="page-description">Browse Auvrynt commands and copy them for use in a local terminal.</p></div><input class="search" id="command-search" type="search" placeholder="Filter commands…" autocomplete="off" /></div>
          <div class="commands" id="command-list">${commands}</div>
        </section>

        <section class="dashboard-view" id="view-tools" role="tabpanel" aria-labelledby="tab-tools" data-view-panel="tools" hidden>
          <div class="view-toolbar tools-toolbar">
            <div class="tools-tab-stack">
              <div class="tools-integration-tabs" id="tools-integration-tabs" role="tablist" aria-label="Integration tool settings"></div>
              <div class="tools-sub-tabs" id="tools-sub-tabs" role="tablist" aria-label="Integration tool subgroups" hidden></div>
            </div>
            <input class="search" id="tools-search" type="search" placeholder="Filter tools…" autocomplete="off" />
          </div>
          <div class="tools-layout" id="tools-layout"></div>
        </section>
      </main>
    </div>

    <div class="lifecycle-overlay" id="lifecycle-overlay" role="status" aria-live="assertive" aria-hidden="true"><div class="lifecycle-panel"><div class="lifecycle-spinner" aria-hidden="true"></div><h2 class="lifecycle-title" id="lifecycle-title">Restarting Auvrynt</h2><p class="lifecycle-message" id="lifecycle-message">Please wait while local services reconnect.</p><div class="lifecycle-progress" aria-hidden="true"></div></div></div>
    <dialog class="confirm-dialog" id="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message"><div class="confirm-body"><p class="confirm-kicker">Auvrynt control</p><h2 class="confirm-title" id="confirm-title">Confirm action</h2><p class="confirm-message" id="confirm-message"></p></div><div class="confirm-actions"><button class="button" id="confirm-cancel" type="button">Cancel</button><button class="button primary" id="confirm-accept" type="button">Continue</button></div></dialog>
    <div class="toast-region" aria-live="polite" aria-atomic="true"><div class="toast" id="action-notice" role="status"></div></div>

    <script nonce="${escapeHtml(nonce)}">
      (() => {
        const pageMeta = ${jsonForHtml(PAGE_META)};
        const dashboardControlToken = ${dashboardControlTokenJson};
        const maxAllowedRoots = ${MAX_ALLOWED_ROOTS};
        let state = ${initialData};
        let activeFilter = "all";
        let knownNewestId = state.logs[0]?.id ?? 0;
        let unseenLogs = 0;
        let lifecycleMode = null;
        let refreshFailures = 0;
        const viewNames = ["analytics", "connectivity", "secrets", "logs", "commands", "tools"];
        let activeView = viewNames.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "analytics";
        const logs = document.getElementById("log-list");
        const integrations = document.getElementById("integrations");
        const directories = document.getElementById("agent-directories");
        const directoryProfileNotes = document.getElementById("agent-directory-profile-notes");
        const addDirectoryButton = document.getElementById("add-directory");
        const skillList = document.getElementById("skill-list-connectivity");
        const skillsMeta = document.getElementById("skills-meta-connectivity");
        const notice = document.getElementById("action-notice");
        const newLogs = document.getElementById("new-logs");
        const logSearch = document.getElementById("log-search");
        const activityChart = document.getElementById("activity-chart");
        const topTools = document.getElementById("top-tools");
        const healthSignals = document.getElementById("health-signals");
        const tunnelAlert = document.getElementById("tunnel-alert");
        const tunnelAlertTitle = document.getElementById("tunnel-alert-title");
        const tunnelAlertMessage = document.getElementById("tunnel-alert-message");
        const openSecretsButton = document.getElementById("open-secrets");
        const ngrokTokenForm = document.getElementById("ngrok-token-form");
        const ngrokTokenInput = document.getElementById("ngrok-token-input");
        const addNgrokTokenButton = document.getElementById("add-ngrok-token");
        const ngrokTokenList = document.getElementById("ngrok-token-list");
        const ngrokEnvironmentWarning = document.getElementById("ngrok-environment-warning");
        const copyWebAgentSecretButton = document.getElementById("copy-web-agent-secret");
        const webAgentSecretStatus = document.getElementById("web-agent-secret-status");
        const restartButton = document.getElementById("restart");
        const stopButton = document.getElementById("stop");
        const lifecycleOverlay = document.getElementById("lifecycle-overlay");
        const lifecycleTitle = document.getElementById("lifecycle-title");
        const lifecycleMessage = document.getElementById("lifecycle-message");
        const confirmDialog = document.getElementById("confirm-dialog");
        const confirmTitle = document.getElementById("confirm-title");
        const confirmMessage = document.getElementById("confirm-message");
        const confirmCancel = document.getElementById("confirm-cancel");
        const confirmAccept = document.getElementById("confirm-accept");
        const sessionLimitForm = document.getElementById("session-limit-form");
        const sessionLimitInput = document.getElementById("session-limit-input");
        const saveSessionLimitButton = document.getElementById("save-session-limit");
        const sessionIdleTimeoutForm = document.getElementById("session-idle-timeout-form");
        const sessionIdleTimeoutInput = document.getElementById("session-idle-timeout-input");
        const saveSessionIdleTimeoutButton = document.getElementById("save-session-idle-timeout");
        const toolDisplayForm = document.getElementById("tool-display-form");
        const toolDisplaySelect = document.getElementById("tool-display-select");
        const saveToolDisplayButton = document.getElementById("save-tool-display");
        const toolsIntegrationTabs = document.getElementById("tools-integration-tabs");
        const toolsSubTabs = document.getElementById("tools-sub-tabs");
        const toolsSearch = document.getElementById("tools-search");
        const toolsLayout = document.getElementById("tools-layout");
        let toolsPrimary = null;
        let toolsSub = null;
        let toolsIntegration = null;
        let toolsData = null;
        let toolsFilter = "";
        let toolsBusy = new Set();
        const toolsOpenGroups = new Set();
        let toolsRendering = false;
        const openToolSettingsButton = document.getElementById("open-tool-settings");
        let confirmResolver = null;
        let refreshTimer = null;

        const category = (entry) => {
          const event = entry.event.toLowerCase();
          if (entry.level === "error") return "error";
          if (event.includes("tool")) return "tool";
          if (event.includes("mcp") || event.includes("session")) return "mcp";
          if (event.includes("auth") || event.includes("oauth") || event.includes("token")) return "auth";
          if (event.includes("http")) return "http";
          return "other";
        };
        const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
        const time = (value) => new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const uptime = (seconds) => {
          const total = Math.max(0, Math.floor(seconds));
          const days = Math.floor(total / 86400);
          const hours = Math.floor((total % 86400) / 3600);
          const minutes = Math.floor((total % 3600) / 60);
          return [days ? days + "d" : "", hours ? hours + "h" : "", minutes + "m"].filter(Boolean).join(" ");
        };
        const relativeTime = (value) => {
          if (!value) return "No agent activity yet";
          const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
          if (seconds < 5) return "Active just now";
          if (seconds < 60) return "Active " + seconds + "s ago";
          if (seconds < 3600) return "Active " + Math.floor(seconds / 60) + "m ago";
          return "Active " + Math.floor(seconds / 3600) + "h ago";
        };
        const levelClass = (value, maximum) => "level-" + Math.max(0, Math.min(10, maximum > 0 ? Math.round((value / maximum) * 10) : 0));
        const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const exactNumber = (value) => new Intl.NumberFormat().format(Math.max(0, Number(value) || 0));
        const compactNumber = (value) => {
          const normalized = Math.max(0, Number(value) || 0);
          return normalized < 100000
            ? exactNumber(normalized)
            : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(normalized);
        };
        let toastTimer = null;

        function showToast(message, tone = "info", duration = 3200) {
          if (toastTimer) window.clearTimeout(toastTimer);
          toastTimer = null;
          notice.textContent = message;
          notice.classList.toggle("error", tone === "error");
          notice.classList.remove("visible");
          void notice.offsetWidth;
          notice.classList.add("visible");
          if (duration > 0) {
            toastTimer = window.setTimeout(() => {
              notice.classList.remove("visible");
              toastTimer = null;
              window.setTimeout(() => {
                if (!notice.classList.contains("visible")) notice.textContent = "";
              }, 240);
            }, duration);
          }
        }

        function finishConfirmation(accepted) {
          const resolve = confirmResolver;
          confirmResolver = null;
          if (confirmDialog.open) confirmDialog.close();
          resolve?.(accepted);
        }

        function confirmAction(title, message, acceptLabel = "Continue") {
          if (confirmResolver) finishConfirmation(false);
          confirmTitle.textContent = title;
          confirmMessage.textContent = message;
          confirmAccept.textContent = acceptLabel;
          confirmDialog.showModal();
          confirmCancel.focus();
          return new Promise((resolve) => { confirmResolver = resolve; });
        }

        function setChangeMetric(id, value, prefix) {
          const element = document.getElementById(id);
          const exact = prefix + exactNumber(value);
          element.textContent = prefix + compactNumber(value);
          element.title = exact;
          element.setAttribute("aria-label", exact);
        }

        function agentText(nextState) {
          const provider = nextState.agentProvider || "AI agent";
          if (nextState.agentState === "working") return { title: provider + " working", headline: provider + " is actively using Auvrynt.", caption: nextState.activeToolCalls + " tool call" + (nextState.activeToolCalls === 1 ? " is" : "s are") + " executing now." };
          if (nextState.agentState === "connected") return { title: provider + " connected", headline: provider + " is connected and ready.", caption: nextState.sessions + " authenticated MCP session" + (nextState.sessions === 1 ? " is" : "s are") + " currently open." };
          if (nextState.agentState === "stopping") return { title: "Server stopping", headline: "Auvrynt is closing active connections.", caption: "The dashboard will stop refreshing when shutdown completes." };
          return { title: "Waiting for AI", headline: "Auvrynt is online and ready.", caption: "Connect ChatGPT, Claude, Gemini, or another MCP-compatible AI client." };
        }

        function setActiveView(view, updateHash = true) {
          activeView = viewNames.includes(view) ? view : "analytics";
          document.querySelectorAll("[data-view]").forEach((tab) => {
            const selected = tab.dataset.view === activeView;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
          });
          document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== activeView; });
          document.getElementById("page-kicker").textContent = pageMeta[activeView].kicker;
          document.getElementById("page-title").textContent = pageMeta[activeView].title;
          const pageDescription = document.getElementById("page-description");
          pageDescription.textContent = pageMeta[activeView].description;
          pageDescription.hidden = !pageMeta[activeView].description;
          if (updateHash) window.history.replaceState(null, "", "#" + activeView);
          if (activeView === "tools") {
            // Populate tabs on hash load / keyboard nav, not only gear click.
            if (!toolsPrimary) resolveToolsSelection(null);
            renderToolsTabs();
            if (!toolsData) void loadActiveToolsPanel();
            else renderTools();
          }
        }

        function renderAgentPresence() {
          const copy = agentText(state);
          const presence = document.getElementById("agent-presence");
          presence.dataset.state = state.agentState;
          document.getElementById("presence-title").textContent = copy.title;
          document.getElementById("presence-detail").textContent = state.agentState === "waiting" ? copy.caption : relativeTime(state.agentLastSeenAt);
          const activitySurface = document.getElementById("activity-surface");
          activitySurface.dataset.agentState = state.agentState;
          document.getElementById("agent-headline").textContent = copy.headline;
          document.getElementById("agent-caption").textContent = copy.caption;
          document.getElementById("agent-sessions").textContent = state.sessions + " active session" + (state.sessions === 1 ? "" : "s");
          document.getElementById("agent-tools").textContent = state.activeToolCalls + " tool call" + (state.activeToolCalls === 1 ? "" : "s") + " running";
          document.getElementById("agent-last-seen").textContent = relativeTime(state.agentLastSeenAt);
          document.getElementById("nav-session-count").textContent = state.sessions + "/" + state.maxSessions;
          if (document.activeElement !== sessionLimitInput && !sessionLimitInput.disabled) {
            sessionLimitInput.value = String(state.maxSessions);
          }
          if (document.activeElement !== sessionIdleTimeoutInput && !sessionIdleTimeoutInput.disabled) {
            sessionIdleTimeoutInput.value = String(state.sessionIdleTimeoutMinutes);
          }
          if (document.activeElement !== toolDisplaySelect && !toolDisplaySelect.disabled) {
            toolDisplaySelect.value = state.widgets;
          }
        }

        function operationalEntries() {
          return state.logs.filter((entry) => {
            if (entry.event !== "http_request") return true;
            const path = typeof entry.fields.path === "string" ? entry.fields.path : "";
            return !path.startsWith("/dashboard") && !path.startsWith("/brand-assets/");
          });
        }

        function renderAnalytics() {
          const entries = operationalEntries();
          const toolCalls = entries.filter((entry) => entry.event === "tool_call");
          const errors = entries.filter((entry) => entry.level === "error");
          const httpDurations = entries.filter((entry) => entry.event === "http_request" && Number.isFinite(Number(entry.fields.durationMs))).map((entry) => Number(entry.fields.durationMs));
          const averageHttp = httpDurations.length ? httpDurations.reduce((total, value) => total + value, 0) / httpDurations.length : null;

          document.getElementById("metric-sessions").textContent = state.sessions + " / " + state.maxSessions;
          document.getElementById("metric-processes").textContent = String(state.runningProcesses);
          document.getElementById("metric-tools").textContent = String(toolCalls.length);
          document.getElementById("metric-http").textContent = averageHttp === null ? "—" : averageHttp < 1000 ? Math.round(averageHttp) + "ms" : (averageHttp / 1000).toFixed(1) + "s";
          document.getElementById("metric-uptime").textContent = uptime(state.uptimeSeconds);
          document.getElementById("rail-uptime").textContent = uptime(state.uptimeSeconds);
          document.getElementById("rail-pid").textContent = String(state.pid);
          document.getElementById("analytics-window").textContent = "Latest " + entries.length + " operational events";
          document.getElementById("nav-log-count").textContent = String(state.logs.length);

          const changes = state.workspaceChanges;
          setChangeMetric("change-additions", changes.additions, "+");
          setChangeMetric("change-removals", changes.removals, "−");
          document.getElementById("files-created").textContent = exactNumber(changes.filesCreated);
          document.getElementById("files-modified").textContent = exactNumber(changes.filesModified);
          document.getElementById("files-deleted").textContent = exactNumber(changes.filesDeleted);
          const changedWorkspace = changes.workspaceRoot || "No workspace opened";
          const changedWorkspaceElement = document.getElementById("change-workspace");
          changedWorkspaceElement.textContent = changedWorkspace;
          changedWorkspaceElement.title = changedWorkspace;
          document.getElementById("change-sampled").textContent = changes.workspaceRoot
            ? "Auvrynt · " + relativeTime(changes.sampledAt).replace("Active", "Updated")
            : "No agent changes yet";

          const now = Date.now();
          const windowMs = 30 * 60 * 1000;
          const bucketCount = 12;
          const bucketMs = windowMs / bucketCount;
          const bucketStart = now - windowMs;
          const buckets = Array.from({ length: bucketCount }, () => 0);
          entries.forEach((entry) => {
            const timestamp = Date.parse(entry.ts);
            if (!Number.isFinite(timestamp) || timestamp < bucketStart || timestamp > now) return;
            const index = Math.min(bucketCount - 1, Math.floor((timestamp - bucketStart) / bucketMs));
            buckets[index] += 1;
          });
          const peak = Math.max(1, ...buckets);
          activityChart.innerHTML = buckets.map((count, index) => '<span class="activity-bar ' + levelClass(count, peak) + '" title="Bucket ' + (index + 1) + ': ' + count + ' events"></span>').join("");

          const toolCounts = new Map();
          toolCalls.forEach((entry) => {
            const tool = typeof entry.fields.tool === "string" ? entry.fields.tool : "unknown";
            toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
          });
          const rankedTools = [...toolCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 6);
          topTools.innerHTML = rankedTools.length ? rankedTools.map(([name, count]) => '<div class="top-tool"><span class="top-tool-name" title="' + escape(name) + '">' + escape(name) + '</span><strong>' + count + '</strong></div>').join("") : '<div class="analytics-empty">No tool calls in the current sample.</div>';

          const health = [
            ["Warnings", entries.filter((entry) => entry.level === "warn").length],
            ["Errors", errors.length],
            ["Failed tools", toolCalls.filter((entry) => entry.fields.success === false).length],
            ["Closed sessions", entries.filter((entry) => entry.event === "mcp_session_closed").length],
          ];
          const healthPeak = Math.max(1, ...health.map((item) => item[1]));
          healthSignals.innerHTML = health.map(([name, count]) => '<div class="mix-row"><span class="mix-label">' + escape(name) + '</span><span class="mix-track"><span class="mix-fill ' + levelClass(count, healthPeak) + '"></span></span><span class="mix-count">' + count + '</span></div>').join("");
        }

        function firstVisibleAnchor() {
          const rows = [...logs.querySelectorAll(".log-row")];
          const row = rows.find((item) => item.offsetTop + item.offsetHeight >= logs.scrollTop);
          return row ? { id: row.dataset.logId, offset: row.offsetTop - logs.scrollTop } : null;
        }
        function updateNewLogButton() {
          newLogs.textContent = unseenLogs === 1 ? "↑ 1 new log" : "↑ " + unseenLogs + " new logs";
          newLogs.classList.toggle("visible", unseenLogs > 0 && logs.scrollTop > 4);
        }
        function renderLogs() {
          const atTop = logs.scrollTop <= 4;
          const anchor = atTop ? null : firstVisibleAnchor();
          const query = logSearch.value.trim().toLowerCase();
          const visible = state.logs.filter((entry) => {
            const entryCategory = category(entry);
            if (activeFilter === "error" && entry.level !== "error") return false;
            if (activeFilter !== "all" && activeFilter !== "error" && entryCategory !== activeFilter) return false;
            return !query || (entry.ts + " " + entry.level + " " + entry.event + " " + JSON.stringify(entry.fields)).toLowerCase().includes(query);
          });
          logs.innerHTML = visible.length ? visible.map((entry) => '<div class="log-row" data-log-id="' + entry.id + '"><time>' + time(entry.ts) + '</time><span class="log-level ' + entry.level + '">' + escape(entry.level.toUpperCase()) + '</span><span class="log-event">' + escape(entry.event) + '</span><span class="log-fields">' + escape(Object.keys(entry.fields).length ? JSON.stringify(entry.fields) : "") + '</span></div>').join("") : '<div class="empty">No matching events.</div>';
          if (atTop) { logs.scrollTop = 0; unseenLogs = 0; }
          else if (anchor) {
            const anchored = logs.querySelector('[data-log-id="' + anchor.id + '"]');
            if (anchored) logs.scrollTop = anchored.offsetTop - anchor.offset;
          }
          updateNewLogButton();
        }

        function renderIntegrations() {
          integrations.innerHTML = state.integrations.map((item) => {
            const countBadge = item.toolCount > 0
              ? '<span class="tool-count" title="' + item.toolEnabledCount + ' of ' + item.toolCount + ' tools enabled"><strong>' + item.toolEnabledCount + '</strong>/' + item.toolCount + '</span>'
              : '<span class="tool-count tool-count-empty" aria-hidden="true"></span>';
            return '<div class="integration-row"><div class="integration-name"><strong>' + escape(item.label) + '</strong><small>' + escape(item.detail) + '</small></div>' + countBadge + '<span class="state ' + item.state + '">' + escape(item.state) + '</span><button class="button integration-toggle" type="button" data-integration="' + escape(item.key) + '" data-enabled="' + item.enabled + '">' + (item.enabled ? "Disable" : "Enable") + '</button></div>';
          }).join("");
        }

        function renderDirectories() {
          const roots = Array.isArray(state.allowedRoots) ? state.allowedRoots : [];
          const requirements = Array.isArray(state.directoryRequirements) ? state.directoryRequirements : [];
          const atLimit = roots.length >= maxAllowedRoots;
          addDirectoryButton.disabled = Boolean(lifecycleMode) || atLimit;
          addDirectoryButton.title = atLimit ? "Maximum of " + maxAllowedRoots + " agent-access directories reached" : "Add directory";
          addDirectoryButton.setAttribute("aria-label", atLimit ? "Maximum of " + maxAllowedRoots + " agent-access directories reached" : "Add directory");
          directoryProfileNotes.hidden = requirements.length === 0;
          directoryProfileNotes.innerHTML = requirements.map((requirement) => '<div class="directory-profile-note"><strong>' + escape(requirement.label) + '</strong><span>' + escape(requirement.note) + '</span></div>').join("");
          if (!roots.length) {
            directories.innerHTML = '<div class="empty">No agent-access directories configured.</div>';
            return;
          }
          directories.innerHTML = roots.map((root, index) => '<div class="directory-row"><div class="directory-name"><strong>Directory ' + (index + 1) + '</strong><span class="directory-path" title="' + escape(root) + '">' + escape(root) + '</span></div><button class="button directory-remove" type="button" data-directory-action="remove" data-directory-index="' + index + '" aria-label="Remove ' + escape(root) + '" title="Remove directory" ' + (roots.length === 1 ? 'disabled' : '') + '>Remove</button></div>').join("");
        }

        function renderSkills() {
          const skillsState = state.skills || { enabled: false, agentDir: "", skillPaths: [], skills: [], diagnostics: [] };
          if (skillsMeta) {
            const rows = [];
            rows.push('<div class="connection-row"><span class="connection-label">Status</span><span class="connection-value">' + (skillsState.enabled ? 'Skills enabled' : 'Skills disabled (AUVRYNT_SKILLS=false)') + '</span></div>');
            rows.push('<div class="connection-row"><span class="connection-label">Agent dir</span><span class="connection-value" title="' + escape(skillsState.agentDir || '') + '">' + escape(skillsState.agentDir || '—') + '</span></div>');
            if (skillsState.workspaceRoot) {
              rows.push('<div class="connection-row"><span class="connection-label">Workspace</span><span class="connection-value" title="' + escape(skillsState.workspaceRoot) + '">' + escape(skillsState.workspaceRoot) + '</span></div>');
            }
            const extra = (skillsState.skillPaths || []).length ? skillsState.skillPaths.join(', ') : 'none';
            rows.push('<div class="connection-row"><span class="connection-label">Extra paths</span><span class="connection-value" title="' + escape(extra) + '">' + escape(extra) + '</span></div>');
            rows.push('<div class="connection-row"><span class="connection-label">Agent access</span><span class="connection-value">Returned on open_workspace as available skills</span></div>');
            skillsMeta.innerHTML = rows.join('');
          }
          if (!skillList) return;
          if (!skillsState.enabled) {
            skillList.innerHTML = '<div class="empty">Skills are disabled. Set AUVRYNT_SKILLS=true (default) to load Agent Skills.</div>';
            return;
          }
          const skills = skillsState.skills || [];
          if (!skills.length) {
            skillList.innerHTML = '<div class="empty">No skills discovered under agent dir, project .pi/skills, or AUVRYNT_SKILL_PATHS.</div>';
            return;
          }
          skillList.innerHTML = skills.map((skill) => {
            const badge = skill.disableModelInvocation ? 'manual' : skill.scope;
            const badgeClass = skill.disableModelInvocation ? 'exhausted' : (skill.scope === 'project' ? 'active' : '');
            return '<div class="skill-row"><div class="skill-name"><strong>' + escape(skill.name) + '</strong></div><span class="token-status ' + badgeClass + '">' + escape(badge) + '</span></div>';
          }).join('');
        }

        function renderNgrok() {
          const ngrok = state.ngrok;
          document.getElementById("nav-token-count").textContent = String(ngrok.tokens.length);
          ngrokEnvironmentWarning.hidden = !ngrok.environmentOverride;
          const noticeData = ngrok.notice;
          tunnelAlert.hidden = !noticeData;
          tunnelAlert.classList.toggle("error", noticeData?.tone === "error");
          if (noticeData) {
            tunnelAlertTitle.textContent = noticeData.title;
            tunnelAlertMessage.textContent = noticeData.message;
          } else {
            tunnelAlertTitle.textContent = "";
            tunnelAlertMessage.textContent = "";
          }
          ngrokTokenList.innerHTML = ngrok.tokens.length
            ? ngrok.tokens.map((token) => {
              const exhausted = Boolean(token.quotaExhaustedAt);
              const status = exhausted ? "Quota exhausted" : token.active ? "Active" : "Standby";
              const statusClass = exhausted ? "exhausted" : token.active ? "active" : "";
              const detail = exhausted
                ? "Limit detected " + new Date(token.quotaExhaustedAt).toLocaleString()
                : token.active ? "Used for the next ngrok tunnel start" : "Available for automatic failover";
              const activateLabel = exhausted ? "Retry" : "Use";
              const activateButton = token.active && !exhausted
                ? ""
                : '<button class="button token-action" type="button" data-ngrok-action="activate" data-ngrok-index="' + token.index + '">' + activateLabel + '</button>';
              return '<div class="token-row"><div class="token-name"><strong>' + escape(token.fingerprint) + '</strong><small>' + escape(detail) + '</small></div><span class="token-status ' + statusClass + '">' + status + '</span><div class="token-actions">' + activateButton + '<button class="button token-action stop" type="button" data-ngrok-action="remove" data-ngrok-index="' + token.index + '">Remove</button></div></div>';
            }).join("")
            : '<div class="empty">No managed ngrok tokens saved.</div>';
        }

        function renderConnection() {
          const local = document.getElementById("local-mcp");
          const publicUrl = document.getElementById("public-mcp");
          const arbiterStatus = document.getElementById("arbiter-status");
          local.textContent = state.localMcpUrl;
          local.href = state.localMcpUrl;
          publicUrl.textContent = state.publicMcpUrl;
          publicUrl.href = state.publicMcpUrl;
          if (arbiterStatus) {
            const arbiter = state.arbiter;
            if (!arbiter) {
              arbiterStatus.textContent = "Unavailable";
            } else {
              const status = arbiter.enabled
                ? arbiter.configured ? "enabled / configured" : "enabled / missing API key"
                : "disabled";
              arbiterStatus.textContent = status + " · " + arbiter.model + " · " + arbiter.endpoint;
            }
          }
          const timing = state.mcpRequestTimings?.kinds?.all;
          const timingElement = document.getElementById("mcp-request-timing");
          if (timing?.totalMs?.count) {
            const total = timing.totalMs;
            const auth = timing.authMs;
            const dispatch = timing.dispatchMs;
            timingElement.textContent = "p50 " + total.p50 + "ms · p95 " + total.p95 + "ms · p99 " + total.p99 + "ms";
            timingElement.title = "Samples: " + timing.samples
              + (auth ? " | auth p50 " + auth.p50 + "ms" : "")
              + (dispatch ? " | dispatch p50 " + dispatch.p50 + "ms" : "");
          } else {
            timingElement.textContent = "No samples yet";
            timingElement.title = "Rolling MCP timing data appears after requests are handled.";
          }
          const roots = Array.isArray(state.allowedRoots) ? state.allowedRoots : [];
          const root = roots[0] || "No workspace configured";
          const workspace = document.getElementById("workspace");
          workspace.textContent = root + (roots.length > 1 ? " +" + (roots.length - 1) : "");
          workspace.title = roots.join("\\n");
        }

        function renderServerState() {
          const title = document.getElementById("server-state-title");
          const detail = document.getElementById("server-state-detail");
          const dot = document.getElementById("server-state-dot");
          if (lifecycleMode === "restarting") { title.textContent = "Restarting"; detail.textContent = "Waiting for Auvrynt to return"; dot.style.background = "var(--auvrynt-warning)"; return; }
          if (lifecycleMode === "stopped") { title.textContent = "Stopped"; detail.textContent = "Auvrynt is offline"; dot.style.background = "var(--auvrynt-danger)"; return; }
          if (lifecycleMode === "stopping" || !state.ready) { title.textContent = "Stopping"; detail.textContent = "Closing local services"; dot.style.background = "var(--auvrynt-warning)"; return; }
          title.textContent = "Server online";
          detail.textContent = "Refreshes every 2 seconds";
          dot.style.background = "var(--auvrynt-accent)";
        }

        function renderState(nextState) {
          const previousNewestId = knownNewestId;
          state = nextState;
          knownNewestId = state.logs[0]?.id ?? previousNewestId;
          if (knownNewestId > previousNewestId && logs.scrollTop > 4) unseenLogs += state.logs.filter((entry) => entry.id > previousNewestId).length;
          renderAgentPresence();
          renderConnection();
          renderDirectories();
          renderIntegrations();
          renderSkills();
          renderNgrok();
          renderAnalytics();
          renderLogs();
          renderServerState();
          if (activeView === "tools") {
            renderToolsTabs();
            if (toolsData) renderTools();
          }
        }

        async function refresh() {
          if (lifecycleMode) return;
          try {
            const response = await fetch("/dashboard/data", {
              cache: "no-store",
              signal: AbortSignal.timeout(3_000),
            });
            if (!response.ok) throw new Error("Dashboard refresh failed (" + response.status + ")");
            const nextState = await response.json();
            refreshFailures = 0;
            renderState(nextState);
          } catch {
            refreshFailures += 1;
            if (refreshFailures >= 3) {
              const title = document.getElementById("server-state-title");
              const detail = document.getElementById("server-state-detail");
              const dot = document.getElementById("server-state-dot");
              title.textContent = "Reconnecting";
              detail.textContent = "Waiting for dashboard data";
              dot.style.background = "var(--auvrynt-warning)";
            }
          }
        }

        async function postAction(path, body) {
          const response = await fetch(path, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-auvrynt-dashboard-token": dashboardControlToken,
            },
            body: JSON.stringify(body ?? {}),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || "Action failed (" + response.status + ")");
          return result;
        }

        function setButtonBusy(button, busy, label) {
          if (!button.dataset.label) button.dataset.label = button.textContent;
          button.setAttribute("aria-busy", String(busy));
          button.disabled = busy;
          button.textContent = busy ? label : button.dataset.label;
        }

        function beginLifecycle(mode, message, detail) {
          lifecycleMode = mode;
          if (refreshTimer) window.clearInterval(refreshTimer);
          restartButton.disabled = true;
          stopButton.disabled = true;
          document.documentElement.setAttribute("aria-busy", "true");
          lifecycleOverlay.classList.remove("complete");
          lifecycleTitle.textContent = mode === "restarting" ? "Restarting Auvrynt" : "Stopping Auvrynt";
          lifecycleMessage.textContent = detail || (mode === "restarting"
            ? "Please wait while the dashboard reconnects."
            : "Please wait while active connections and local services close safely.");
          lifecycleOverlay.classList.add("active");
          lifecycleOverlay.setAttribute("aria-hidden", "false");
          state = { ...state, ready: false, agentState: "stopping" };
          showToast(message, "info", 0);
          renderAgentPresence();
          renderServerState();
        }

        function endLifecycle() {
          lifecycleMode = null;
          document.documentElement.removeAttribute("aria-busy");
          lifecycleOverlay.classList.remove("active", "complete");
          lifecycleOverlay.setAttribute("aria-hidden", "true");
          renderServerState();
        }

        function finishStopLifecycle() {
          lifecycleMode = "stopped";
          document.documentElement.removeAttribute("aria-busy");
          lifecycleOverlay.classList.add("complete");
          lifecycleTitle.textContent = "Auvrynt stopped";
          lifecycleMessage.textContent = "The local server and tunnel are offline. Run auvrynt start when you are ready to reconnect.";
          setButtonBusy(stopButton, false, "");
          restartButton.disabled = true;
          stopButton.disabled = true;
          renderServerState();
        }

        async function waitForRestart() {
          const previousPid = state.pid;
          const previousPublicMcpUrl = state.publicMcpUrl;
          let sawOffline = false;
          const deadline = Date.now() + 90_000;
          let attempt = 0;
          while (Date.now() < deadline) {
            attempt += 1;
            await delay(Math.min(500 + attempt * 75, 1_500));
            try {
              const response = await fetch("/healthz?restart=" + Date.now(), {
                cache: "no-store",
                signal: AbortSignal.timeout(3_000),
              });
              if (!response.ok) { sawOffline = true; continue; }
              const health = await response.json().catch(() => ({}));
              const pidChanged = typeof health.pid === "number" && health.pid !== previousPid;
              if (sawOffline || pidChanged) {
                const dashboardResponse = await fetch("/dashboard/data?restart=" + Date.now(), {
                  cache: "no-store",
                  signal: AbortSignal.timeout(3_000),
                });
                if (!dashboardResponse.ok) continue;
                const nextState = await dashboardResponse.json();
                const publicUrlChanged = Boolean(
                  previousPublicMcpUrl
                  && nextState.publicMcpUrl
                  && previousPublicMcpUrl !== nextState.publicMcpUrl,
                );
                renderState(nextState);
                endLifecycle();
                restartButton.disabled = false;
                stopButton.disabled = false;
                setButtonBusy(restartButton, false, "");
                refreshTimer = window.setInterval(refresh, 2_000);
                showToast(
                  publicUrlChanged
                    ? "Auvrynt restarted, but the public MCP URL changed. Update the connector to the new URL shown in Connectivity."
                    : "Auvrynt restarted successfully.",
                  publicUrlChanged ? "error" : "info",
                  publicUrlChanged ? 0 : 2400,
                );
                if (publicUrlChanged) setActiveView("connectivity");
                return;
              }
            } catch {
              sawOffline = true;
            }
          }
          endLifecycle();
          restartButton.disabled = false;
          stopButton.disabled = false;
          setButtonBusy(restartButton, false, "");
          showToast("Restart did not complete. The existing public URL was preserved; check Auvrynt status, then retry.", "error", 0);
          refreshTimer = window.setInterval(refresh, 2_000);
          void refresh();
        }

        async function waitForStop() {
          const deadline = Date.now() + 30_000;
          let consecutiveOfflineChecks = 0;
          while (Date.now() < deadline) {
            await delay(650);
            try {
              const response = await fetch("/healthz?stop=" + Date.now(), {
                cache: "no-store",
                signal: AbortSignal.timeout(2_000),
              });
              consecutiveOfflineChecks = response.ok ? 0 : consecutiveOfflineChecks + 1;
            } catch {
              consecutiveOfflineChecks++;
            }
            if (consecutiveOfflineChecks >= 2) {
              finishStopLifecycle();
              return;
            }
          }
          endLifecycle();
          restartButton.disabled = false;
          stopButton.disabled = false;
          setButtonBusy(stopButton, false, "");
          showToast("Auvrynt did not finish stopping within 30 seconds. Check its status and retry.", "error", 0);
          refreshTimer = window.setInterval(refresh, 2_000);
          void refresh();
        }

        document.querySelectorAll("[data-view]").forEach((tab) => {
          tab.addEventListener("click", () => setActiveView(tab.dataset.view));
          tab.addEventListener("keydown", (event) => {
            const horizontal = window.matchMedia("(max-width: 940px)").matches;
            const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
            const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
            if (event.key !== previousKey && event.key !== nextKey) return;
            event.preventDefault();
            const direction = event.key === nextKey ? 1 : -1;
            const nextIndex = (viewNames.indexOf(activeView) + direction + viewNames.length) % viewNames.length;
            setActiveView(viewNames[nextIndex]);
            document.querySelector('[data-view="' + activeView + '"]').focus();
          });
        });
        window.addEventListener("hashchange", () => setActiveView(window.location.hash.slice(1), false));
        openSecretsButton.addEventListener("click", () => setActiveView("secrets"));

        copyWebAgentSecretButton.addEventListener("click", async () => {
          setButtonBusy(copyWebAgentSecretButton, true, "Copying");
          webAgentSecretStatus.textContent = "";
          try {
            const result = await postAction("/__auvrynt/dashboard/web-agent-secret", {});
            if (typeof result.secret !== "string" || result.secret.length < 16) throw new Error("The web-agent secret is unavailable.");
            const copied = await copyText(result.secret, copyWebAgentSecretButton, "Web-agent secret copied.");
            if (copied) webAgentSecretStatus.textContent = "Copied. Keep this secret private.";
          } catch (error) {
            webAgentSecretStatus.textContent = error instanceof Error ? error.message : String(error);
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            setButtonBusy(copyWebAgentSecretButton, false, "");
          }
        });

        confirmCancel.addEventListener("click", () => finishConfirmation(false));
        confirmAccept.addEventListener("click", () => finishConfirmation(true));
        confirmDialog.addEventListener("cancel", (event) => { event.preventDefault(); finishConfirmation(false); });
        confirmDialog.addEventListener("click", (event) => {
          if (event.target === confirmDialog) finishConfirmation(false);
        });

        openToolSettingsButton?.addEventListener("click", () => { void openToolsView(); });

        integrations.addEventListener("click", async (event) => {
          const button = event.target.closest("[data-integration]");
          if (!button) return;
          const enabled = button.dataset.enabled === "true";
          const label = button.closest(".integration-row")?.querySelector("strong")?.textContent || "integration";
          if (enabled && !await confirmAction("Disable " + label + "?", "Active operations for this integration may be interrupted.", "Disable")) return;
          setButtonBusy(button, true, enabled ? "Disabling" : "Enabling");
          try {
            const result = await postAction("/__auvrynt/dashboard/integrations", { integration: button.dataset.integration, enabled: !enabled });
            showToast(result.message || "Integration updated.");
            await refresh();
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
            setButtonBusy(button, false, "");
          }
        });

        async function loadToolsData(integration) {
          const response = await fetch("/dashboard/tools?integration=" + encodeURIComponent(integration), { cache: "no-store", signal: AbortSignal.timeout(5_000) });
          if (!response.ok) throw new Error("Tool data failed (" + response.status + ")");
          return await response.json();
        }

        function integrationByKey(key) {
          return state.integrations.find((item) => item.key === key);
        }

        function buildToolsPrimaryTabs() {
          const tabs = [];
          const gds = integrationByKey("godotGdscript");
          const gcs = integrationByKey("godotCsharp");
          const godotCount = (gds?.toolCount || 0) + (gcs?.toolCount || 0);
          if (godotCount > 0) {
            tabs.push({ key: "godot", label: "Godot", toolCount: godotCount });
          }
          const serena = integrationByKey("serena");
          if ((serena?.toolCount || 0) > 0) {
            tabs.push({ key: "serena", label: "Serena", toolCount: serena.toolCount });
          }
          for (const item of state.integrations) {
            if (item.key === "godotGdscript" || item.key === "godotCsharp" || item.key === "serena") continue;
            if (item.toolCount > 0) tabs.push({ key: item.key, label: item.label, toolCount: item.toolCount });
          }
          return tabs;
        }

        function buildToolsSubTabs(primary) {
          if (primary === "godot") {
            return [
              { key: "godotGdscript", label: "GDScript", toolCount: integrationByKey("godotGdscript")?.toolCount || 0 },
              { key: "godotCsharp", label: "C#", toolCount: integrationByKey("godotCsharp")?.toolCount || 0 },
            ].filter((item) => item.toolCount > 0);
          }
          return [];
        }

        function resolveToolsSelection(preferredIntegration) {
          const primaryTabs = buildToolsPrimaryTabs();
          if (!primaryTabs.length) {
            toolsPrimary = null;
            toolsSub = null;
            toolsIntegration = null;
            return;
          }
          if (preferredIntegration === "godotGdscript" || preferredIntegration === "godotCsharp") {
            toolsPrimary = primaryTabs.some((t) => t.key === "godot") ? "godot" : primaryTabs[0].key;
            toolsSub = preferredIntegration;
          } else if (preferredIntegration === "serena") {
            toolsPrimary = primaryTabs.some((t) => t.key === "serena") ? "serena" : primaryTabs[0].key;
            toolsSub = null;
          } else if (preferredIntegration && primaryTabs.some((t) => t.key === preferredIntegration)) {
            toolsPrimary = preferredIntegration;
            toolsSub = null;
          } else if (!toolsPrimary || !primaryTabs.some((t) => t.key === toolsPrimary)) {
            const enabled = state.integrations.find((item) => item.enabled && item.toolCount > 0);
            if (enabled?.key === "godotGdscript" || enabled?.key === "godotCsharp") {
              toolsPrimary = "godot";
              toolsSub = enabled.key;
            } else if (enabled?.key === "serena") {
              toolsPrimary = "serena";
              toolsSub = null;
            } else {
              toolsPrimary = enabled?.key || primaryTabs[0].key;
              toolsSub = null;
            }
          }
          const subs = buildToolsSubTabs(toolsPrimary);
          if (subs.length) {
            if (!toolsSub || !subs.some((s) => s.key === toolsSub)) {
              toolsSub = subs.find((s) => s.toolCount > 0)?.key || subs[0].key;
            }
            toolsIntegration = toolsSub;
          } else {
            toolsSub = null;
            toolsIntegration = toolsPrimary;
          }
        }

        async function loadActiveToolsPanel() {
          if (!toolsPrimary) {
            toolsData = null;
            toolsLayout.innerHTML = '<div class="empty">No integration tools are registered yet.</div>';
            return;
          }
          if (!toolsIntegration) {
            toolsData = null;
            toolsLayout.innerHTML = '<div class="empty">No tools available for this tab.</div>';
            return;
          }
          toolsLayout.innerHTML = '<div class="empty">Loading tools…</div>';
          try {
            const data = await loadToolsData(toolsIntegration);
            toolsData = data.tools || [];
            renderTools();
          } catch (error) {
            toolsData = null;
            toolsLayout.innerHTML = '<div class="empty">Unable to load tools: ' + escape(error instanceof Error ? error.message : String(error)) + "</div>";
          }
        }

        async function openToolsView(preferredIntegration) {
          toolsPrimary = null;
          toolsSub = null;
          toolsIntegration = null;
          toolsData = null;
          resolveToolsSelection(preferredIntegration);
          setActiveView("tools");
          await loadActiveToolsPanel();
        }

        function renderToolsTabs() {
          const primaryTabs = buildToolsPrimaryTabs();
          toolsIntegrationTabs.innerHTML = primaryTabs.map((item) => {
            const active = item.key === toolsPrimary;
            return '<button class="tools-tab' + (active ? " active" : "") + '" role="tab" aria-selected="' + (active ? "true" : "false") + '" data-tools-tab="' + escape(item.key) + '" type="button">' + escape(item.label) + '<small>' + item.toolCount + '</small></button>';
          }).join("") || '<span class="tools-no-tabs">No integration tools are registered yet.</span>';

          const subs = buildToolsSubTabs(toolsPrimary);
          if (!toolsSubTabs) return;
          if (!subs.length) {
            toolsSubTabs.hidden = true;
            toolsSubTabs.innerHTML = "";
            return;
          }
          toolsSubTabs.hidden = false;
          toolsSubTabs.innerHTML = subs.map((item) => {
            const active = item.key === toolsSub;
            const count = item.placeholder ? "" : "<small>" + item.toolCount + "</small>";
            return '<button class="tools-tab' + (active ? " active" : "") + '" role="tab" aria-selected="' + (active ? "true" : "false") + '" data-tools-sub="' + escape(item.key) + '" type="button">' + escape(item.label) + count + '</button>';
          }).join("");
        }


        function captureOpenToolBatches() {
          toolsLayout.querySelectorAll("[data-tools-batch]").forEach((batch) => {
            if (batch.open) toolsOpenGroups.add(batch.dataset.toolsBatch);
            else toolsOpenGroups.delete(batch.dataset.toolsBatch);
          });
        }

        function renderTools() {
          if (!toolsData) { toolsLayout.innerHTML = '<div class="empty">No tools loaded.</div>'; return; }
          captureOpenToolBatches();
          const filter = toolsFilter.trim().toLowerCase();
          const visible = filter ? toolsData.filter((tool) => tool.name.toLowerCase().includes(filter) || tool.title.toLowerCase().includes(filter) || tool.group.toLowerCase().includes(filter)) : toolsData;
          const groups = new Map();
          for (const tool of visible) {
            const list = groups.get(tool.group) ?? [];
            list.push(tool);
            groups.set(tool.group, list);
          }
          const allEnabledCount = toolsData.filter((tool) => tool.enabled).length;
          const total = toolsData.length;
          const summary = '<div class="tools-summary"><strong>' + allEnabledCount + '</strong> of <strong>' + total + '</strong> tools enabled</div>';
          const searching = Boolean(toolsFilter.trim());
          const groupMarkup = Array.from(groups.entries()).map(([group, tools]) => {
            const enabledCount = tools.filter((tool) => tool.enabled).length;
            const allOn = enabledCount === tools.length;
            const someOn = enabledCount > 0 && !allOn;
            const open = searching || toolsOpenGroups.has(group);
            const groupBusy = tools.some((tool) => toolsBusy.has(tool.name));
            return '<details class="tools-group' + (someOn ? " partial" : "") + '" data-tools-batch="' + escape(group) + '"' + (open ? " open" : "") + '>' +
              '<summary class="tools-group-head">' +
                '<span class="tools-group-title"><span class="tools-group-chevron" aria-hidden="true"></span><strong>' + escape(group) + '</strong><span class="tools-group-count">' + enabledCount + '/' + tools.length + '</span></span>' +
                '<label class="tool-toggle tools-group-toggle" title="' + (allOn ? "Disable batch" : "Enable batch") + '"' + (someOn ? ' data-partial="true"' : '') + '>' +
                  '<input type="checkbox" data-tools-group="' + escape(group) + '"' + (allOn ? " checked" : "") + (groupBusy ? " disabled" : "") + ' />' +
                  '<span class="tool-toggle-track" aria-hidden="true"></span>' +
                '</label>' +
              '</summary>' +
              '<div class="tools-group-list">' + tools.map((tool) => {
                const busy = toolsBusy.has(tool.name);
                return '<div class="tool-row' + (tool.enabled ? "" : " disabled") + '"><label class="tool-check"><input type="checkbox" data-tool-name="' + escape(tool.name) + '"' + (tool.enabled ? " checked" : "") + (busy ? " disabled" : "") + ' /><span class="tool-check-box" aria-hidden="true"></span></label><div class="tool-info"><strong>' + escape(tool.title) + '</strong><code>' + escape(tool.name) + '</code></div></div>';
              }).join("") + '</div></details>';
          }).join("");
          toolsRendering = true;
          toolsLayout.innerHTML = summary + (groupMarkup || '<div class="empty">No tools match the filter.</div>');
          toolsRendering = false;
        }

        toolsIntegrationTabs.addEventListener("click", (event) => {
          const tab = event.target.closest("[data-tools-tab]");
          if (!tab) return;
          toolsPrimary = tab.dataset.toolsTab;
          const subs = buildToolsSubTabs(toolsPrimary);
          toolsSub = subs.find((s) => s.toolCount > 0)?.key || subs[0]?.key || null;
          toolsIntegration = toolsSub || toolsPrimary;
          renderToolsTabs();
          void loadActiveToolsPanel();
        });

        toolsSubTabs?.addEventListener("click", (event) => {
          const tab = event.target.closest("[data-tools-sub]");
          if (!tab) return;
          toolsSub = tab.dataset.toolsSub;
          toolsIntegration = toolsSub;
          renderToolsTabs();
          void loadActiveToolsPanel();
        });

        toolsSearch.addEventListener("input", () => {
          toolsFilter = toolsSearch.value;
          renderTools();
        });

        toolsLayout.addEventListener("toggle", (event) => {
          if (toolsRendering) return;
          const batch = event.target.closest("[data-tools-batch]");
          if (!batch || event.target !== batch) return;
          if (batch.open) toolsOpenGroups.add(batch.dataset.toolsBatch);
          else toolsOpenGroups.delete(batch.dataset.toolsBatch);
        });

        toolsLayout.addEventListener("click", (event) => {
          if (event.target.closest(".tools-group-toggle")) event.stopPropagation();
        });

        toolsLayout.addEventListener("change", async (event) => {
          const groupToggle = event.target.closest("[data-tools-group]");
          if (groupToggle) {
            const group = groupToggle.dataset.toolsGroup;
            const groupEnabled = groupToggle.checked;
            const names = toolsData.filter((tool) => tool.group === group).map((tool) => tool.name);
            for (const name of names) toolsBusy.add(name);
            groupToggle.disabled = true;
            try {
              const result = await postAction("/__auvrynt/dashboard/tools", { integration: toolsIntegration, group, groupEnabled });
              for (const tool of toolsData) if (tool.group === group) tool.enabled = groupEnabled;
              toolsOpenGroups.add(group);
              renderTools();
              renderToolsTabs();
              showToast(result.message || (groupEnabled ? group + " tools enabled." : group + " tools disabled."));
            } catch (error) {
              groupToggle.checked = !groupEnabled;
              toolsOpenGroups.add(group);
              renderTools();
              showToast(error instanceof Error ? error.message : String(error), "error");
            } finally {
              for (const name of names) toolsBusy.delete(name);
            }
            return;
          }
          const checkbox = event.target.closest("[data-tool-name]");
          if (!checkbox) return;
          const name = checkbox.dataset.toolName;
          const enabled = checkbox.checked;
          toolsBusy.add(name);
          checkbox.disabled = true;
          try {
            const result = await postAction("/__auvrynt/dashboard/tools", { integration: toolsIntegration, name, enabled });
            const tool = toolsData.find((item) => item.name === name);
            if (tool) {
              tool.enabled = enabled;
              toolsOpenGroups.add(tool.group);
            }
            renderTools();
            renderToolsTabs();
            showToast(result.message || (enabled ? name + " enabled." : name + " disabled."));
          } catch (error) {
            checkbox.checked = !enabled;
            const tool = toolsData.find((item) => item.name === name);
            if (tool) toolsOpenGroups.add(tool.group);
            renderTools();
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            toolsBusy.delete(name);
          }
        });

        function applyNgrokResult(result) {
          state.ngrok = result.ngrok;
          renderNgrok();
          showToast(result.message || "ngrok credentials updated.");
          if (result.restarting) {
            beginLifecycle(
              "restarting",
              result.message || "Restarting Auvrynt with the selected ngrok token.",
              "The ngrok tunnel is being recreated. A random ngrok URL may change, and the connector may need the new URL.",
            );
            void waitForRestart();
            return true;
          }
          return false;
        }

        ngrokTokenForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const token = ngrokTokenInput.value.trim();
          if (token.length < 16 || token.length > 512 || /\\s/.test(token)) {
            showToast("Enter a valid ngrok authtoken without spaces.", "error");
            ngrokTokenInput.focus();
            return;
          }
          setButtonBusy(addNgrokTokenButton, true, "Adding");
          ngrokTokenInput.disabled = true;
          try {
            const result = await postAction("/__auvrynt/dashboard/ngrok-tokens", { action: "add", token });
            ngrokTokenInput.value = "";
            applyNgrokResult(result);
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            ngrokTokenInput.value = "";
            if (!lifecycleMode) {
              ngrokTokenInput.disabled = false;
              setButtonBusy(addNgrokTokenButton, false, "");
            }
          }
        });

        ngrokTokenList.addEventListener("click", async (event) => {
          const button = event.target.closest("[data-ngrok-action]");
          if (!button) return;
          const action = button.dataset.ngrokAction;
          const index = Number(button.dataset.ngrokIndex);
          const token = state.ngrok.tokens.find((item) => item.index === index);
          if (!token) return;
          if (action === "remove" && !await confirmAction("Remove ngrok token?", "Auvrynt will permanently delete saved token " + token.fingerprint + ".", "Remove")) return;
          if (action === "activate" && !await confirmAction("Switch ngrok token?", "Auvrynt will recreate the public tunnel using token " + token.fingerprint + ".", "Switch")) return;
          setButtonBusy(button, true, action === "remove" ? "Removing" : "Switching");
          try {
            const result = await postAction("/__auvrynt/dashboard/ngrok-tokens", { action, index });
            if (!applyNgrokResult(result)) setButtonBusy(button, false, "");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
            setButtonBusy(button, false, "");
          }
        });

        restartButton.addEventListener("click", async () => {
          if (!await confirmAction("Restart Auvrynt?", "Connected AI clients may briefly lose access while the server restarts.", "Restart")) return;
          setButtonBusy(restartButton, true, "Restarting");
          try {
            const result = await postAction("/__auvrynt/dashboard/restart", {});
            beginLifecycle("restarting", result.message || "Restarting Auvrynt… The public MCP URL will stay the same.");
            void waitForRestart();
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
            setButtonBusy(restartButton, false, "");
            stopButton.disabled = false;
          }
        });

        stopButton.addEventListener("click", async () => {
          if (!await confirmAction("Stop Auvrynt?", "Connected AI clients will lose access until Auvrynt is started again.", "Stop")) return;
          setButtonBusy(stopButton, true, "Stopping");
          try {
            const result = await postAction("/__auvrynt/dashboard/stop", {});
            beginLifecycle("stopping", result.message || "Auvrynt is stopping…");
            void waitForStop();
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
            setButtonBusy(stopButton, false, "");
            restartButton.disabled = false;
          }
        });

        const editWorkspaceButton = document.getElementById("edit-workspace");
        editWorkspaceButton.addEventListener("click", async () => {
          editWorkspaceButton.disabled = true;
          editWorkspaceButton.setAttribute("aria-busy", "true");
          try {
            const selected = await postAction("/__auvrynt/dashboard/select-workspace", {});
            if (selected.canceled || !selected.path) return;
            const result = await postAction("/__auvrynt/dashboard/workspace", { path: selected.path });
            state.allowedRoots = result.allowedRoots || [selected.path];
            renderConnection();
            renderDirectories();
            showToast(result.message || "Workspace changed.");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            editWorkspaceButton.disabled = Boolean(lifecycleMode);
            editWorkspaceButton.setAttribute("aria-busy", "false");
          }
        });

        addDirectoryButton.addEventListener("click", async () => {
          setButtonBusy(addDirectoryButton, true, "Adding");
          try {
            const selected = await postAction("/__auvrynt/dashboard/select-directory", {});
            if (selected.canceled || !selected.path) return;
            const result = await postAction("/__auvrynt/dashboard/directories", { action: "add", path: selected.path });
            state.allowedRoots = result.allowedRoots || [...(state.allowedRoots || []), selected.path];
            renderConnection();
            renderDirectories();
            showToast(result.message || "Agent directory added.");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            if (!lifecycleMode) setButtonBusy(addDirectoryButton, false, "");
          }
        });

        directories.addEventListener("click", async (event) => {
          const button = event.target.closest("[data-directory-action='remove']");
          if (!button || button.disabled) return;
          const index = Number(button.dataset.directoryIndex);
          const root = state.allowedRoots?.[index];
          if (!Number.isInteger(index) || !root) return;
          if (!await confirmAction("Remove agent directory?", "Web agents will no longer access " + root + ".", "Remove")) return;
          setButtonBusy(button, true, "Removing");
          try {
            const result = await postAction("/__auvrynt/dashboard/directories", { action: "remove", index });
            state.allowedRoots = result.allowedRoots || state.allowedRoots.filter((_root, rootIndex) => rootIndex !== index);
            renderConnection();
            renderDirectories();
            showToast(result.message || "Agent directory removed.");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
            setButtonBusy(button, false, "");
          }
        });

        sessionLimitForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const maxSessions = Number(sessionLimitInput.value);
          if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 999) {
            showToast("MCP session limit must be between 1 and 999.", "error");
            sessionLimitInput.focus();
            return;
          }
          if (maxSessions === state.maxSessions) {
            showToast("MCP session limit is already " + maxSessions + ".");
            return;
          }
          saveSessionLimitButton.disabled = true;
          saveSessionLimitButton.setAttribute("aria-busy", "true");
          sessionLimitInput.disabled = true;
          try {
            const result = await postAction("/__auvrynt/dashboard/session-limit", { maxSessions });
            state.maxSessions = result.maxSessions;
            renderAgentPresence();
            renderAnalytics();
            showToast(result.message || "MCP session limit changed.");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            saveSessionLimitButton.disabled = false;
            saveSessionLimitButton.setAttribute("aria-busy", "false");
            sessionLimitInput.disabled = false;
          }
        });

        sessionIdleTimeoutForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const idleTimeoutMinutes = Number(sessionIdleTimeoutInput.value);
          if (!Number.isInteger(idleTimeoutMinutes) || idleTimeoutMinutes < 1 || idleTimeoutMinutes > 10080) {
            showToast("MCP idle timeout must be between 1 minute and 10080 minutes (7 days).", "error");
            sessionIdleTimeoutInput.focus();
            return;
          }
          if (idleTimeoutMinutes === state.sessionIdleTimeoutMinutes) {
            showToast("MCP idle timeout is already " + idleTimeoutMinutes + " minutes.");
            return;
          }
          saveSessionIdleTimeoutButton.disabled = true;
          saveSessionIdleTimeoutButton.setAttribute("aria-busy", "true");
          sessionIdleTimeoutInput.disabled = true;
          try {
            const result = await postAction("/__auvrynt/dashboard/session-idle-timeout", { idleTimeoutMinutes });
            state.sessionIdleTimeoutMinutes = result.idleTimeoutMinutes;
            renderAgentPresence();
            showToast(result.message || "MCP idle timeout changed.");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            saveSessionIdleTimeoutButton.disabled = false;
            saveSessionIdleTimeoutButton.setAttribute("aria-busy", "false");
            sessionIdleTimeoutInput.disabled = false;
          }
        });

        toolDisplayForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const widgets = toolDisplaySelect.value;
          if (widgets === state.widgets) {
            showToast("Tool Call Display is already " + widgets + ".");
            return;
          }
          saveToolDisplayButton.disabled = true;
          saveToolDisplayButton.setAttribute("aria-busy", "true");
          toolDisplaySelect.disabled = true;
          try {
            const result = await postAction("/__auvrynt/dashboard/widgets", { widgets });
            state.widgets = result.widgets;
            if (result.restarting) {
              showLifecycleOverlay(
                "restarting",
                result.message || "Restarting Auvrynt with the new Tool Call Display mode.",
                "The custom MCP domain remains the same; reconnecting sessions will receive the new compact tool metadata.",
              );
              return;
            }
            showToast(result.message || "Tool Call Display changed.");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            if (!document.body.classList.contains("lifecycle-active")) {
              saveToolDisplayButton.disabled = false;
              saveToolDisplayButton.setAttribute("aria-busy", "false");
              toolDisplaySelect.disabled = false;
            }
          }
        });

        async function copyText(text, button, successMessage) {
          try {
            await navigator.clipboard.writeText(text);
            button.textContent = "✓";
            button.classList.add("copied");
            showToast(successMessage);
            return true;
          } catch (error) {
            showToast("Failed to copy: " + error.message, "error");
            return false;
          }
        }

        document.querySelectorAll("[data-copy-url]").forEach((button) => button.addEventListener("click", () => {
          void copyText(button.dataset.copyUrl === "local" ? state.localMcpUrl : state.publicMcpUrl, button, "URL copied.");
        }));

        document.getElementById("command-search").addEventListener("input", (event) => {
          const query = event.target.value.trim().toLowerCase();
          document.querySelectorAll("[data-command-search]").forEach((row) => { row.hidden = Boolean(query && !row.dataset.commandSearch.includes(query)); });
          document.querySelectorAll("[data-command-group]").forEach((group) => { group.hidden = !group.querySelector("[data-command-search]:not([hidden])"); });
        });
        document.querySelectorAll("[data-log-filter]").forEach((button) => button.addEventListener("click", () => {
          activeFilter = button.dataset.logFilter;
          document.querySelectorAll("[data-log-filter]").forEach((item) => item.classList.toggle("active", item === button));
          renderLogs();
        }));
        logSearch.addEventListener("input", renderLogs);
        logs.addEventListener("scroll", () => { if (logs.scrollTop <= 4) unseenLogs = 0; updateNewLogButton(); });
        newLogs.addEventListener("click", () => { logs.scrollTop = 0; unseenLogs = 0; updateNewLogButton(); });

        setActiveView(activeView, false);
        renderState(state);
        refreshTimer = window.setInterval(refresh, 2000);
      })();
    </script>
  </body>
</html>`;
}

function commandMarkup(): string {
  const groups = groupCommands();
  const columns: Array<Array<[string, typeof AUVRYNT_COMMANDS[number][]]>> = [[], []];
  const weights = [0, 0];
  for (const entry of groups.entries()) {
    const index = weights[0] <= weights[1] ? 0 : 1;
    columns[index].push(entry);
    weights[index] += entry[1].length + 1;
  }
  return columns.map((column) => `<div class="command-column">${column.map(([group, items]) => `<section class="command-group" data-command-group><h3>${escapeHtml(group)}</h3>${items.map(commandRowMarkup).join("")}</section>`).join("")}</div>`).join("");
}

function commandRowMarkup(item: typeof AUVRYNT_COMMANDS[number]): string {
  return `<div class="command-row" data-command-search="${escapeHtml(`${item.command} ${item.description}`.toLowerCase())}"><code>${escapeHtml(item.command)}</code><span>${escapeHtml(item.description)}</span></div>`;
}

function groupCommands(): Map<string, typeof AUVRYNT_COMMANDS[number][]> {
  const groups = new Map<string, typeof AUVRYNT_COMMANDS[number][]>();
  for (const item of AUVRYNT_COMMANDS) {
    const command = item.command.toLowerCase();
    const group = command.includes("token") || command.includes("connected")
      ? "Authentication"
      : command.includes("config") || command.includes("init") || command.includes("setup")
        ? "Configuration"
        : command.includes("doctor") || command.includes("status")
          ? "Diagnostics"
          : command.includes("enable") || command.includes("disable") || command.includes(" add ")
            ? "Integrations"
            : command.includes("uninstall")
              ? "Cleanup"
              : "Server lifecycle";
    const items = groups.get(group) ?? [];
    items.push(item);
    groups.set(group, items);
  }
  return groups;
}

function agentStateLabel(view: DashboardView): string {
  const provider = view.agentProvider ?? "AI agent";
  if (view.agentState === "working") return `${provider} working`;
  if (view.agentState === "connected") return `${provider} connected`;
  if (view.agentState === "stopping") return "Server stopping";
  return "Waiting for AI";
}

function agentStateDetail(view: DashboardView): string {
  if (view.agentState === "working") return `${view.activeToolCalls} active tool call${view.activeToolCalls === 1 ? "" : "s"}.`;
  if (view.agentState === "connected") return `${view.sessions} authenticated MCP session${view.sessions === 1 ? "" : "s"}.`;
  if (view.agentState === "stopping") return "Closing local services and sessions.";
  return "No authenticated MCP session is connected.";
}

function agentHeadline(view: DashboardView): string {
  const provider = view.agentProvider ?? "An AI client";
  if (view.agentState === "working") return `${provider} is actively using Auvrynt.`;
  if (view.agentState === "connected") return `${provider} is connected and ready.`;
  if (view.agentState === "stopping") return "Auvrynt is closing active connections.";
  return "Auvrynt is online and ready.";
}

function agentCaption(view: DashboardView): string {
  if (view.agentState === "working") return `${view.activeToolCalls} tool call${view.activeToolCalls === 1 ? " is" : "s are"} executing now.`;
  if (view.agentState === "connected") return `${view.sessions} authenticated MCP session${view.sessions === 1 ? " is" : "s are"} currently open.`;
  if (view.agentState === "stopping") return "The dashboard will stop refreshing when shutdown completes.";
  return "Connect ChatGPT, Claude, Gemini, or another MCP-compatible AI client.";
}

function lastSeenLabel(value: string | undefined): string {
  if (!value) return "No agent activity yet";
  return "Active just now";
}

function agentChangeLabel(workspaceRoot: string | undefined, value: string): string {
  return workspaceRoot && value ? "Auvrynt · updated now" : "No agent changes yet";
}

function formatMetricNumber(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (normalized < 100_000) return normalized.toLocaleString();
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(normalized);
}

function formatUptime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
