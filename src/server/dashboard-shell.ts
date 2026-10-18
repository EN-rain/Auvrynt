export type DashboardMode = "code" | "jobs";

export function dashboardModeSwitcher(active: DashboardMode): string {
  const codeCurrent = active === "code" ? "page" : "false";
  const jobsCurrent = active === "jobs" ? "page" : "false";
  return `<nav class="mode-switch" aria-label="Auvrynt product modes">
    <a class="mode-switch-button${active === "code" ? " active" : ""}" href="/dashboard" aria-current="${codeCurrent}" aria-label="Code dashboard" title="Code dashboard"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/></svg><span class="mode-switch-label">Code</span></a>
    <a class="mode-switch-button${active === "jobs" ? " active" : ""}" href="/dashboard/jobs" aria-current="${jobsCurrent}" aria-label="Jobs dashboard" title="Jobs dashboard"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5h14a2 2 0 0 1 2 2v7.75a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10.5a2 2 0 0 1 2-2Z"/><path d="M8 8.5V6.75A1.75 1.75 0 0 1 9.75 5h4.5A1.75 1.75 0 0 1 16 6.75V8.5M3 13h18M10 13v2h4v-2"/></svg><span class="mode-switch-label">Jobs</span></a>
  </nav>`;
}
