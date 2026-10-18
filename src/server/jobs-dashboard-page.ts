import { JOBS_DASHBOARD_CSS } from "./jobs-dashboard-page-styles.js";
import { dashboardModeSwitcher } from "./dashboard-shell.js";
import type { JobsDashboardView } from "../jobs/types.js";

export function jobsDashboardHtml(view: JobsDashboardView, nonce: string, dashboardControlToken: string, pid: number): string {
  const initialData = safeJson(view);
  const token = safeJson(dashboardControlToken);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Auvrynt Jobs</title>
    <style nonce="${escapeHtml(nonce)}">${JOBS_DASHBOARD_CSS}</style>
  </head>
  <body>
    <div class="jobs-shell">
      <aside class="jobs-rail" aria-label="Auvrynt Jobs navigation">
        <div class="dashboard-brand-row jobs-brand-row">
          <div class="jobs-brand"><img src="/brand-assets/auvrynt-icon.png" alt="" width="38" height="38" /><div><span class="jobs-brand-name">Auvrynt</span><span class="jobs-brand-version">PID ${pid}</span></div></div>
          ${dashboardModeSwitcher("jobs")}
        </div>
        <p class="jobs-rail-title">Jobs workspace</p>
        <nav class="jobs-nav" aria-label="Jobs views">
          ${navLink("overview", "Overview")}
          ${navLink("opportunities", "Opportunities")}
          ${navLink("tracker", "Tracker")}
          ${navLink("integrations", "Integrations")}
          ${navLink("profile", "Profile")}
        </nav>
        <div class="jobs-rail-spacer"></div>
        <p class="jobs-rail-meta">Local Jobs store<br />Facebook linking is configurable</p>
      </aside>
      <main class="jobs-workspace">
        <header class="jobs-header">
          <div><p class="jobs-kicker">Auvrynt Jobs</p><h1 class="jobs-title">Find the right next move.</h1><p class="jobs-description">One local workspace for opportunities, matching, risk review, and the application pipeline.</p></div>
          <span class="jobs-pid">PID ${pid} · source-agnostic</span>
        </header>
        <div class="jobs-content">
          <section class="jobs-view" id="jobs-view-overview" data-jobs-panel="overview"></section>
          <section class="jobs-view" id="jobs-view-opportunities" data-jobs-panel="opportunities" hidden></section>
          <section class="jobs-view" id="jobs-view-tracker" data-jobs-panel="tracker" hidden></section>
          <section class="jobs-view" id="jobs-view-integrations" data-jobs-panel="integrations" hidden></section>
          <section class="jobs-view" id="jobs-view-profile" data-jobs-panel="profile" hidden></section>
        </div>
      </main>
    </div>
    <dialog id="job-detail" aria-labelledby="job-detail-title"><div class="jobs-panel"><div class="panel-head"><div><h2 id="job-detail-title">Job details</h2><p id="job-detail-company"></p></div><div class="form-actions"><button class="button" id="edit-detail" type="button">Edit</button><button class="button" id="close-detail" type="button">Close</button></div></div><div class="detail-copy" id="job-detail-description"></div><div class="job-meta" id="job-detail-meta"></div><form class="form-grid" id="job-edit-form" hidden><div class="form-field"><label for="edit-title">Title</label><input id="edit-title" name="title" maxlength="200" required /></div><div class="form-field"><label for="edit-company">Company</label><input id="edit-company" name="company" maxlength="200" /></div><div class="form-field full"><label for="edit-url">Application URL</label><input id="edit-url" name="url" type="url" maxlength="2048" /></div><div class="form-field full"><label for="edit-description">Description</label><textarea id="edit-description" name="description" maxlength="20000" required></textarea></div><div class="form-field full"><label for="edit-notes">Notes</label><textarea id="edit-notes" name="notes" maxlength="5000"></textarea></div><div class="form-actions full"><button class="button" id="cancel-edit-detail" type="button">Cancel</button><button class="button primary" type="submit">Save changes</button></div></form></div></dialog>
    <script nonce="${escapeHtml(nonce)}">
      (() => {
        const dashboardControlToken = ${token};
        let state = ${initialData};
        let overviewOpportunities = [...state.opportunities.data];
        let activeView = ["overview", "opportunities", "tracker", "integrations", "profile"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "overview";
        let integrationNotice = facebookNoticeFromQuery();
        if (integrationNotice) window.history.replaceState(null, "", window.location.pathname + "#integrations");
        let trackerPresentation = "kanban";
        const trackerStatuses = ["NEW","REVIEW","SHORTLISTED","READY_TO_APPLY","APPLIED","REPLIED","INTERVIEW","OFFER","REJECTED","CLOSED","ARCHIVED"];
        const opportunitySortOptions = [["newest", "Newest"], ["match", "Highest match"], ["deadline", "Deadline"], ["company", "Company"], ["status", "Status"]];
        let opportunityFilters = { query: "", status: "", sortBy: "newest" };
        const panels = [...document.querySelectorAll("[data-jobs-panel]")];
        const nav = [...document.querySelectorAll("[data-jobs-view]")];
        const busy = new Set();
        const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
        const date = (value) => value ? new Date(value).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "—";
        const textList = (value) => Array.isArray(value) ? value.join(", ") : "";
        const post = async (path, body, key) => {
          if (busy.has(key)) return false;
          busy.add(key);
          try {
            const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-auvrynt-dashboard-token": dashboardControlToken }, body: JSON.stringify(body) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result?.error?.message ?? "The Jobs action failed.");
            await refresh();
            return result;
          } catch (error) { window.alert(error instanceof Error ? error.message : "The Jobs action failed."); return false; }
          finally { busy.delete(key); }
        };
        const opportunityParams = (page) => new URLSearchParams({
          page: String(page),
          pageSize: "50",
          query: opportunityFilters.query,
          status: opportunityFilters.status,
          sortBy: opportunityFilters.sortBy,
        });
        const fetchOpportunityPage = async (page) => {
          const response = await fetch("/dashboard/jobs/opportunities?" + opportunityParams(page).toString(), { cache: "no-store" });
          if (!response.ok) throw new Error("Filtered opportunities are unavailable.");
          let result = await response.json();
          if (result.pagination && result.pagination.page > result.pagination.totalPages) {
            const fallback = await fetch("/dashboard/jobs/opportunities?" + opportunityParams(result.pagination.totalPages).toString(), { cache: "no-store" });
            if (!fallback.ok) throw new Error("Filtered opportunities are unavailable.");
            result = await fallback.json();
          }
          return result;
        };
        const refresh = async () => {
          const currentPage = state.opportunities?.pagination?.page || 1;
          const response = await fetch("/dashboard/jobs/data", { cache: "no-store" });
          if (!response.ok) throw new Error("Jobs data is unavailable.");
          state = await response.json();
          overviewOpportunities = [...state.opportunities.data];
          state.opportunities = await fetchOpportunityPage(currentPage);
          render();
        };
        const jobCard = (job) => '<article class="job-card"><div><h3><button class="link-button" data-detail="' + escape(job.id) + '" type="button">' + escape(job.title) + '</button></h3><p>' + escape(job.company || "Company not specified") + ' · ' + escape(job.location || "Location not specified") + '</p><div class="job-meta"><span class="badge match">' + escape(job.matchLevel) + '</span><span class="badge status">' + escape(job.status.replaceAll("_", " ")) + '</span>' + (job.riskScore >= 30 ? '<span class="badge risk">Risk ' + job.riskScore + '</span>' : '') + '</div></div><strong class="job-score">' + job.matchScore + '</strong></article>';
        const empty = (message) => '<div class="empty-state" role="status">' + escape(message) + '</div>';
        function renderOverview() {
          const s = state.summary;
          const attention = overviewOpportunities.filter((job) => job.status === "REVIEW" || job.riskScore >= 60).slice(0, 5);
          document.querySelector("#jobs-view-overview").innerHTML = '<div class="summary-grid">' + [['New opportunities', s.newJobs], ['Excellent matches', s.excellentMatches], ['Strong matches', s.strongMatches], ['Shortlisted', s.shortlisted], ['Applications sent', s.applicationsSent], ['Average match', s.averageMatchScore]].map((item) => '<div class="metric-card"><span>' + escape(item[0]) + '</span><strong>' + escape(item[1]) + '</strong></div>').join('') + '</div><div class="jobs-grid-two"><section class="jobs-panel"><div class="panel-head"><div><h2>Strong new matches</h2><p>Highest-scoring active opportunities.</p></div><a class="button" href="#opportunities">View all</a></div><div class="job-list">' + (overviewOpportunities.filter((job) => job.matchScore >= 80).slice(0, 5).map(jobCard).join('') || empty('No opportunities yet. Add a job manually to start scoring.')) + '</div></section><section class="jobs-panel"><div class="panel-head"><div><h2>Attention items</h2><p>Review high-risk or manually flagged opportunities.</p></div></div><div class="job-list">' + (attention.map(jobCard).join('') || empty('Nothing needs attention right now.')) + '</div><div class="panel-head" style="margin-top:22px"><div><h2>Source health</h2><p>Jobs keeps working with Facebook disconnected.</p></div></div><div class="source-list">' + state.integrations.map((item) => '<div class="source-item"><span>' + escape(item.label) + '</span><span class="muted">' + escape(item.status.replaceAll('_', ' ')) + '</span></div>').join('') + '</div><div class="panel-head" style="margin-top:22px"><div><h2>Recent activity</h2></div></div><div class="activity-list">' + (state.recentActivity.slice(0, 5).map((event) => '<div class="activity-item"><span>' + escape(event.message) + '</span><span class="muted">' + date(event.createdAt) + '</span></div>').join('') || empty('No activity yet.')) + '</div></section></div>';
        }
        function renderOpportunities() {
          const page = state.opportunities;
          const statusFilterOptions = '<option value="">All statuses</option>' + trackerStatuses.map((status) => '<option value="' + status + '"' + (status === opportunityFilters.status ? ' selected' : '') + '>' + status.replaceAll('_', ' ') + '</option>').join('');
          const sortFilterOptions = opportunitySortOptions.map((item) => '<option value="' + item[0] + '"' + (item[0] === opportunityFilters.sortBy ? ' selected' : '') + '>' + item[1] + '</option>').join('');
          document.querySelector("#jobs-view-opportunities").innerHTML = '<section class="jobs-panel"><div class="panel-head"><div><h2>Opportunities</h2><p>Search and review up to 50 jobs at a time.</p></div><button class="button primary" id="show-add-job" type="button">+ Add job</button></div><form class="toolbar" id="job-search-form"><input id="job-query" name="query" type="search" value="' + escape(opportunityFilters.query) + '" placeholder="Search title, company, description…" aria-label="Search jobs" /><select id="job-status" name="status" aria-label="Filter by status">' + statusFilterOptions + '</select><select id="job-sort" name="sort" aria-label="Sort opportunities">' + sortFilterOptions + '</select><button class="button" type="submit">Filter</button></form><div class="job-table-wrap"><table class="job-table"><thead><tr><th>Opportunity</th><th>Match</th><th>Risk</th><th>Status</th><th>Seen</th><th></th></tr></thead><tbody>' + (page.data.length ? page.data.map((job) => '<tr><td><button class="link-button" data-detail="' + escape(job.id) + '" type="button">' + escape(job.title) + '</button><br /><span class="muted">' + escape(job.company || "Company not specified") + '</span></td><td><span class="badge match">' + job.matchScore + ' · ' + escape(job.matchLevel) + '</span></td><td>' + (job.riskScore >= 30 ? '<span class="badge risk">' + job.riskScore + ' · ' + escape(job.riskLevel.replaceAll('_', ' ')) + '</span>' : '<span class="muted">Normal</span>') + '</td><td><select data-status="' + escape(job.id) + '" aria-label="Change status for ' + escape(job.title) + '">' + trackerStatuses.map((status) => '<option value="' + status + '"' + (status === job.status ? ' selected' : '') + '>' + status.replaceAll('_', ' ') + '</option>').join('') + '</select></td><td>' + date(job.firstSeenAt) + '</td><td><button class="button danger" data-archive="' + escape(job.id) + '" type="button">Archive</button></td></tr>').join('') : '<tr><td colspan="6">' + empty('No opportunities match the current filters.') + '</td></tr>') + '</tbody></table></div><div class="pagination"><span>Page ' + page.pagination.page + ' of ' + page.pagination.totalPages + ' · ' + page.pagination.totalItems + ' jobs</span><span><button class="button" id="previous-page" type="button" ' + (page.pagination.page <= 1 ? 'disabled' : '') + '>Previous</button> <button class="button" id="next-page" type="button" ' + (page.pagination.page >= page.pagination.totalPages ? 'disabled' : '') + '>Next</button></span></div></section><section class="jobs-panel" id="add-job-panel" hidden><div class="panel-head"><div><h2>Add a job</h2><p>Manual jobs receive the same match, risk, and deduplication pipeline.</p></div></div><form class="form-grid" id="add-job-form"><div class="form-field"><label for="add-title">Title</label><input id="add-title" name="title" required maxlength="200" /></div><div class="form-field"><label for="add-company">Company</label><input id="add-company" name="company" maxlength="200" /></div><div class="form-field"><label for="add-url">URL</label><input id="add-url" name="url" type="url" maxlength="2048" /></div><div class="form-field"><label for="add-location">Location</label><input id="add-location" name="location" maxlength="200" /></div><div class="form-field"><label for="add-remote">Work arrangement</label><select id="add-remote" name="remoteStatus"><option value="unknown">Unknown</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></div><div class="form-field"><label for="add-employment">Employment type</label><input id="add-employment" name="employmentType" maxlength="100" /></div><div class="form-field"><label for="add-salary">Salary / rate</label><input id="add-salary" name="salary" maxlength="200" /></div><div class="form-field"><label for="add-deadline">Deadline</label><input id="add-deadline" name="deadline" type="date" /></div><div class="form-field full"><label for="add-description">Description</label><textarea id="add-description" name="description" required maxlength="20000"></textarea></div><div class="form-field full"><label for="add-notes">Notes</label><textarea id="add-notes" name="notes" maxlength="5000"></textarea></div><div class="form-actions"><button class="button" id="cancel-add-job" type="button">Cancel</button><button class="button primary" type="submit">Save job</button></div></form></section>';
          document.querySelector("#show-add-job").addEventListener("click", () => { const panel = document.querySelector("#add-job-panel"); panel.hidden = false; document.querySelector("#add-title").focus(); });
          document.querySelector("#cancel-add-job").addEventListener("click", () => { document.querySelector("#add-job-panel").hidden = true; });
          document.querySelector("#add-job-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await post("/__auvrynt/dashboard/jobs/add", Object.fromEntries(form.entries()), "add"); });
          document.querySelector("#job-search-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); opportunityFilters = { query: String(form.get("query") || ""), status: String(form.get("status") || ""), sortBy: String(form.get("sort") || "newest") }; await loadOpportunityPage(1); });
          document.querySelectorAll("#jobs-view-opportunities [data-status]").forEach((element) => element.addEventListener("change", (event) => post("/__auvrynt/dashboard/jobs/" + event.currentTarget.dataset.status + "/status", { status: event.currentTarget.value }, "status-" + event.currentTarget.dataset.status)));
          document.querySelectorAll("[data-archive]").forEach((element) => element.addEventListener("click", (event) => post("/__auvrynt/dashboard/jobs/" + event.currentTarget.dataset.archive + "/archive", {}, "archive-" + event.currentTarget.dataset.archive)));
          document.querySelector("#previous-page").addEventListener("click", () => loadOpportunityPage(page.pagination.page - 1));
          document.querySelector("#next-page").addEventListener("click", () => loadOpportunityPage(page.pagination.page + 1));
        }
        async function loadOpportunityPage(page) { state.opportunities = await fetchOpportunityPage(page); renderOpportunities(); bindDetails(); }
        function renderTrackerV2() {
          const statuses = trackerStatuses;
          const allJobs = statuses.flatMap((status) => state.tracker[status] || []);
          const board = '<div class="tracker-board">' + statuses.map((status) => '<section class="tracker-column"><h3>' + status.replaceAll('_', ' ') + ' / ' + (state.tracker[status] || []).length + '</h3>' + ((state.tracker[status] || []).map(jobCard).join('') || '<p class="muted">No jobs here.</p>') + '</section>').join('') + '</div>';
          const table = '<div class="tracker-table-wrap"><table class="job-table tracker-table"><thead><tr><th>Opportunity</th><th>Match</th><th>Risk</th><th>Status</th></tr></thead><tbody>' + (allJobs.length ? allJobs.map((job) => '<tr><td><button class="link-button" data-detail="' + escape(job.id) + '" type="button">' + escape(job.title) + '</button><br /><span class="muted">' + escape(job.company || "Company not specified") + '</span></td><td>' + job.matchScore + ' / ' + escape(job.matchLevel) + '</td><td>' + job.riskScore + ' / ' + escape(job.riskLevel) + '</td><td><select data-status="' + escape(job.id) + '" aria-label="Change status for ' + escape(job.title) + '">' + statuses.map((status) => '<option value="' + status + '"' + (status === job.status ? ' selected' : '') + '>' + status.replaceAll('_', ' ') + '</option>').join('') + '</select></td></tr>').join('') : '<tr><td colspan="4">' + empty('No jobs in the tracker yet.') + '</td></tr>') + '</tbody></table></div>';
          const selected = trackerPresentation === "table" ? table : board;
          document.querySelector("#jobs-view-tracker").innerHTML = '<section class="jobs-panel"><div class="panel-head"><div><h2>Tracker</h2><p>Move opportunities through the lifecycle when you choose.</p></div><button class="button" id="tracker-table-mode" type="button">' + (trackerPresentation === "table" ? "Kanban view" : "Table view") + '</button></div><div id="tracker-content">' + selected + '</div></section>';
          document.querySelector("#tracker-table-mode").addEventListener("click", () => { trackerPresentation = trackerPresentation === "table" ? "kanban" : "table"; renderTrackerV2(); bindDetails(); });
          document.querySelectorAll("#tracker-content [data-status]").forEach((element) => element.addEventListener("change", (event) => post("/__auvrynt/dashboard/jobs/" + event.currentTarget.dataset.status + "/status", { status: event.currentTarget.value }, "status-" + event.currentTarget.dataset.status)));
        }
        function facebookNoticeFromQuery() { const status = new URLSearchParams(window.location.search).get("facebook"); if (status === "connected") return "Facebook account linked. The access token is stored locally and never shown in the dashboard."; if (status === "denied") return "Facebook linking was cancelled."; if (status === "invalid") return "Facebook returned an invalid login response. Start linking again."; if (status === "profile") return "Facebook login succeeded, but the account profile could not be verified."; if (status === "storage") return "Facebook login succeeded, but the local connection could not be saved."; if (status === "unavailable") return "Facebook linking is not configured. Add the server-side Facebook app settings first."; if (status === "failed") return "Facebook linking failed. No account was connected."; return ""; }
        function humanIntegrationStatus(status) { return ({ connected: "Connected", available: "Ready to connect", needs_login: "Setup required", disabled: "Disabled", error: "Needs attention" }[status] || String(status).replaceAll("_", " ")); }
        function renderIntegrations() {
          const cards = state.integrations.map((item) => {
            const facebook = item.provider === "facebook";
            const connected = facebook && item.status === "connected";
            const configured = item.configuration === "ready";
            const description = facebook
              ? connected
                ? "Your Facebook account is linked for this local Jobs workspace. Scanning remains user-controlled and is not started automatically."
                : configured && item.enabled
                  ? "Link a Facebook account through the official consent screen. Auvrynt keeps the exchanged token on this machine and does not collect credentials in the page."
                  : "Add a Facebook app id and app secret to the Auvrynt server environment before linking an account."
              : "Add opportunities manually and they will be normalized, matched, risk-checked, and deduplicated.";
            const action = !facebook ? "" : connected
              ? '<button class="button danger" data-facebook-disconnect type="button">Disconnect Facebook</button>'
              : configured && item.enabled
                ? '<button class="button primary" data-facebook-connect type="button">Connect Facebook</button>'
                : '<button class="button" type="button" disabled>Configure Facebook first</button>';
            const badges = Object.entries(item.capabilities).filter((entry) => entry[1]).map((entry) => '<span class="badge">' + escape(entry[0].replace(/([A-Z])/g, " $1")) + '</span>').join("");
            return '<article class="integration-card" data-integration-provider="' + escape(item.provider) + '"><div class="integration-card-head"><div><p class="integration-eyebrow">Source</p><h2>' + escape(item.label) + '</h2></div><span class="integration-status status-' + escape(item.status) + '">' + escape(humanIntegrationStatus(item.status)) + '</span></div><p>' + description + '</p>' + (facebook && !configured ? '<div class="integration-callout"><strong>Server setup required</strong><span>Set <code>AUVRYNT_JOBS_FACEBOOK_APP_ID</code> and <code>AUVRYNT_JOBS_FACEBOOK_APP_SECRET</code>, then restart Auvrynt.</span></div>' : '') + '<div class="job-meta">' + badges + '</div><div class="integration-actions">' + action + '</div></article>';
          }).join("");
          document.querySelector("#jobs-view-integrations").innerHTML = '<section class="jobs-panel"><div class="panel-head"><div><h2>Integrations</h2><p>Availability and live bridge state.</p></div></div>' + (integrationNotice ? '<p class="notice integration-notice" role="status">' + escape(integrationNotice) + '</p>' : '') + '<div class="integration-grid">' + cards + '</div><p class="integration-footnote">Facebook linking uses a loopback callback and explicit consent. Disconnecting removes the saved local token.</p></section>';
          document.querySelectorAll("[data-facebook-connect]").forEach((element) => element.addEventListener("click", async () => {
            element.disabled = true;
            const result = await post("/__auvrynt/dashboard/jobs/facebook/connect", {}, "facebook-connect");
            const authorizationUrl = result && result.data && result.data.authorizationUrl;
            if (typeof authorizationUrl !== "string") { element.disabled = false; return; }
            try {
              const parsed = new URL(authorizationUrl);
              if (parsed.origin !== "https://www.facebook.com" || parsed.pathname !== "/dialog/oauth") throw new Error("The Facebook authorization URL was invalid.");
              window.location.assign(parsed.toString());
            } catch (error) { window.alert(error instanceof Error ? error.message : "The Facebook authorization URL was invalid."); }
          }));
          document.querySelectorAll("[data-facebook-disconnect]").forEach((element) => element.addEventListener("click", async () => { element.disabled = true; await post("/__auvrynt/dashboard/jobs/facebook/disconnect", {}, "facebook-disconnect"); }));
        }
        function renderProfileV2() {
          const p = state.profile;
          document.querySelector("#jobs-view-profile").innerHTML = '<section class="jobs-panel"><div class="panel-head"><div><h2>Jobs profile</h2><p>One profile powers every source and every match explanation.</p></div></div><form class="profile-form" id="profile-form"><div class="form-field"><label for="profile-roles">Target roles</label><textarea id="profile-roles" name="targetRoles" placeholder="One role per line">' + escape(p.targetRoles.join("\\n")) + '</textarea></div><div class="form-field"><label for="profile-primary">Primary skills</label><textarea id="profile-primary" name="primarySkills" placeholder="Unity, C#, TypeScript">' + escape(p.primarySkills.join(", ")) + '</textarea></div><div class="form-field"><label for="profile-secondary">Secondary skills</label><textarea id="profile-secondary" name="secondarySkills">' + escape(p.secondarySkills.join(", ")) + '</textarea></div><div class="form-field"><label for="profile-experience">Experience levels</label><input id="profile-experience" name="experienceLevels" value="' + escape(p.experienceLevels.join(", ")) + '" /></div><div class="form-field"><label for="profile-country">Country / location</label><input id="profile-country" name="country" value="' + escape(p.country || "") + '" /></div><div class="form-field"><label for="profile-salary">Salary preference</label><input id="profile-salary" name="salaryPreference" value="' + escape(p.salaryPreference || "") + '" /></div><div class="form-field"><label for="profile-employment">Employment preference</label><input id="profile-employment" name="employmentPreference" value="' + escape(p.employmentPreference || "") + '" /></div><div class="form-field"><label for="profile-negative">Negative keywords</label><input id="profile-negative" name="negativeKeywords" value="' + escape(p.negativeKeywords.join(", ")) + '" /></div><fieldset class="preference-fieldset"><legend>Work preferences</legend><label><input type="checkbox" name="remote"' + (p.remote ? " checked" : "") + ' /> Remote</label><label><input type="checkbox" name="hybridAcceptable"' + (p.hybridAcceptable ? " checked" : "") + ' /> Hybrid acceptable</label><label><input type="checkbox" name="onsiteOptional"' + (p.onsiteOptional ? " checked" : "") + ' /> On-site optional</label></fieldset><div class="form-field"><label for="profile-minimum">Minimum match score</label><input id="profile-minimum" name="minimumMatchScore" type="number" min="0" max="100" value="' + p.minimumMatchScore + '" /></div><div class="form-actions"><button class="button primary" type="submit">Save profile</button></div><p class="notice" id="profile-notice" role="status"></p></form></section>';
          document.querySelector("#profile-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await post("/__auvrynt/dashboard/jobs/profile", { targetRoles: split(String(form.get("targetRoles"))), primarySkills: split(String(form.get("primarySkills"))), secondarySkills: split(String(form.get("secondarySkills"))), experienceLevels: split(String(form.get("experienceLevels"))), country: String(form.get("country") || ""), salaryPreference: String(form.get("salaryPreference") || ""), employmentPreference: String(form.get("employmentPreference") || ""), negativeKeywords: split(String(form.get("negativeKeywords"))), minimumMatchScore: Number(form.get("minimumMatchScore") || 60), remote: form.get("remote") === "on", hybridAcceptable: form.get("hybridAcceptable") === "on", onsiteOptional: form.get("onsiteOptional") === "on" }, "profile"); });
        }
        const split = (value) => value.split(/[\\n,]/).map((item) => item.trim()).filter(Boolean);
        function bindDetails() { document.querySelectorAll("[data-detail]").forEach((element) => element.addEventListener("click", () => openDetailV2(element.dataset.detail))); }
        async function openDetailV2(id) { const response = await fetch("/dashboard/jobs/opportunities/" + encodeURIComponent(id), { cache: "no-store" }); if (!response.ok) return; const job = await response.json(); const detail = document.querySelector("#job-detail"); document.querySelector("#job-detail-title").textContent = job.title; document.querySelector("#job-detail-company").textContent = (job.company || "Company not specified") + " / " + job.matchScore + " match / " + job.riskScore + " risk"; document.querySelector("#job-detail-description").textContent = job.description; document.querySelector("#job-detail-meta").innerHTML = '<span class="badge status">' + escape(job.status.replaceAll('_', ' ')) + '</span><span class="badge match">' + escape(job.matchLevel) + '</span><span class="badge">' + escape(job.remoteStatus) + '</span>'; document.querySelector("#edit-title").value = job.title || ""; document.querySelector("#edit-company").value = job.company || ""; document.querySelector("#edit-url").value = job.applicationUrl || ""; document.querySelector("#edit-description").value = job.description || ""; document.querySelector("#edit-notes").value = job.notes || ""; detail.dataset.jobId = job.id; document.querySelector("#job-edit-form").hidden = true; document.querySelector("#job-detail-description").hidden = false; document.querySelector("#job-detail-meta").hidden = false; detail.showModal(); }
        document.querySelector("#close-detail").addEventListener("click", () => document.querySelector("#job-detail").close());
        document.querySelector("#edit-detail").addEventListener("click", () => { document.querySelector("#job-edit-form").hidden = false; document.querySelector("#job-detail-description").hidden = true; document.querySelector("#job-detail-meta").hidden = true; document.querySelector("#edit-title").focus(); });
        document.querySelector("#cancel-edit-detail").addEventListener("click", () => { document.querySelector("#job-edit-form").hidden = true; document.querySelector("#job-detail-description").hidden = false; document.querySelector("#job-detail-meta").hidden = false; });
        document.querySelector("#job-edit-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const detail = document.querySelector("#job-detail"); const saved = await post("/__auvrynt/dashboard/jobs/" + detail.dataset.jobId + "/update", Object.fromEntries(form.entries()), "edit-" + detail.dataset.jobId); if (saved) detail.close(); });
        function render() { panels.forEach((panel) => { panel.hidden = panel.dataset.jobsPanel !== activeView; }); nav.forEach((link) => { link.classList.toggle("active", link.dataset.jobsView === activeView); link.setAttribute("aria-current", link.dataset.jobsView === activeView ? "page" : "false"); }); if (activeView === 'overview') renderOverview(); if (activeView === 'opportunities') renderOpportunities(); if (activeView === 'tracker') renderTrackerV2(); if (activeView === 'integrations') renderIntegrations(); if (activeView === 'profile') renderProfileV2(); bindDetails(); }
        nav.forEach((link) => link.addEventListener("click", () => { activeView = link.dataset.jobsView; }));
        window.addEventListener("hashchange", () => { const next = window.location.hash.slice(1); if (["overview", "opportunities", "tracker", "integrations", "profile"].includes(next)) { activeView = next; render(); } });
        render();
      })();
    </script>
  </body>
</html>`;
}

function navLink(view: string, label: string): string {
  const icons: Record<string, string> = {
    overview: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
    opportunities: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>',
    tracker: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 5h12M6 12h12M6 19h12"/><circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/></svg>',
    integrations: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 12h8M12 8v8"/><circle cx="12" cy="12" r="8"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3"/><path d="M5 20c.8-3.2 3.2-5 7-5s6.2 1.8 7 5"/></svg>',
  };
  return `<a href="#${view}" data-jobs-view="${view}" aria-current="${view === "overview" ? "page" : "false"}"><span class="jobs-nav-icon">${icons[view] ?? ""}</span><span>${label}</span></a>`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
