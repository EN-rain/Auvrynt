export const DASHBOARD_SHELL_CSS = `
.dashboard-brand-row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 0 8px 20px; }
.mode-switch { display: inline-flex; flex: 0 0 auto; gap: 6px; margin: 0; padding: 0; border: 0; background: transparent; }
.mode-switch-button { position: relative; display: inline-flex; width: 32px; min-height: 32px; align-items: center; justify-content: center; padding: 6px; border: 0; border-radius: 6px; color: var(--auvrynt-text-muted); background: transparent; text-decoration: none; transition: color .18s ease, transform .18s ease; }
.mode-switch-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
.mode-switch-label { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.mode-switch-button::after { position: absolute; right: 50%; bottom: 1px; width: 0; height: 2px; border-radius: 2px; background: var(--auvrynt-accent-soft); content: ""; transform: translateX(50%); transition: width .18s ease; }
.mode-switch-button:hover { color: var(--auvrynt-text); }
.mode-switch-button.active { color: var(--auvrynt-text); }
.mode-switch-button.active::after { width: 14px; }
.mode-switch-button:focus-visible { outline: 2px solid var(--auvrynt-accent-soft); outline-offset: 2px; }
@view-transition { navigation: auto; }
::view-transition-old(root) { animation: dashboard-mode-out .2s ease both; }
::view-transition-new(root) { animation: dashboard-mode-in .2s ease both; }
@keyframes dashboard-mode-out { to { opacity: 0; transform: translateX(-8px); } }
@keyframes dashboard-mode-in { from { opacity: 0; transform: translateX(8px); } }
@media (prefers-reduced-motion: reduce) {
  .mode-switch-button, .mode-switch-button::after { transition: none; }
  ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
}
`;
