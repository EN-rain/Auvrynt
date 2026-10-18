import { AUVRYNT_THEME_CSS } from "../ui/brand-theme.js";
import { DASHBOARD_SHELL_CSS } from "./dashboard-shell-styles.js";

export const JOBS_DASHBOARD_CSS = `
${AUVRYNT_THEME_CSS}
${DASHBOARD_SHELL_CSS}
*, *::before, *::after { box-sizing: border-box; }
html { min-height: 100%; background: var(--auvrynt-bg-deep); }
body { margin: 0; min-width: 320px; min-height: 100vh; color: var(--auvrynt-text); background: radial-gradient(circle at 72% -18%, rgba(192,132,252,.20), transparent 36%), radial-gradient(circle at -10% 86%, rgba(126,34,206,.14), transparent 34%), var(--auvrynt-bg-deep); font-family: var(--auvrynt-font-sans); }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--auvrynt-accent); outline-offset: 3px; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }
.jobs-shell { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 100vh; }
.jobs-rail { position: sticky; top: 0; display: flex; height: 100vh; min-width: 0; flex-direction: column; padding: 22px 16px 16px; border-right: 1px solid var(--auvrynt-border-soft); background: linear-gradient(180deg, rgba(30,11,54,.84), rgba(11,7,20,.92)); backdrop-filter: blur(24px); }
.jobs-brand { display: flex; min-width: 0; align-items: center; gap: 12px; }
.jobs-brand img { width: 38px; height: 38px; border-radius: 11px; box-shadow: 0 12px 28px rgba(5,2,12,.36); }
.jobs-brand-name { display: block; font-size: 17px; font-weight: 780; letter-spacing: -.025em; }
.jobs-brand-version { display: block; margin-top: 2px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); }
.jobs-rail-title { margin: 0 8px 12px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); letter-spacing: .12em; text-transform: uppercase; }
.jobs-nav { display: grid; gap: 5px; }
.jobs-nav a { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 8px 11px; border: 1px solid transparent; border-radius: 10px; color: var(--auvrynt-text-muted); font-size: 13px; font-weight: 650; text-decoration: none; }
.jobs-nav a:hover, .jobs-nav a.active { color: var(--auvrynt-text); border-color: var(--auvrynt-border-soft); background: rgba(192,132,252,.10); }
.jobs-nav-icon { display: inline-grid; width: 20px; place-items: center; color: var(--auvrynt-accent-soft); }
.jobs-nav-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
.jobs-rail-spacer { flex: 1; }
.jobs-rail-meta { margin: 16px 8px 0; color: var(--auvrynt-text-muted); font: 10px/1.6 var(--auvrynt-font-mono); }
.jobs-workspace { min-width: 0; padding: 0 clamp(18px, 4vw, 56px) 56px; }
.jobs-header { display: flex; align-items: end; justify-content: space-between; gap: 20px; max-width: 1440px; margin: 0 auto; padding: 42px 0 30px; border-bottom: 1px solid var(--auvrynt-border-soft); }
.jobs-kicker { margin: 0 0 8px; color: var(--auvrynt-accent-soft); font: 11px var(--auvrynt-font-mono); letter-spacing: .13em; text-transform: uppercase; }
.jobs-title { margin: 0; font-size: clamp(28px, 4vw, 44px); letter-spacing: -.05em; }
.jobs-description { max-width: 620px; margin: 10px 0 0; color: var(--auvrynt-text-secondary); }
.jobs-pid { color: var(--auvrynt-text-muted); font: 11px var(--auvrynt-font-mono); white-space: nowrap; }
.jobs-content { max-width: 1440px; margin: 0 auto; padding-top: 28px; }
.jobs-view { display: grid; gap: 20px; }
.summary-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.metric-card, .jobs-panel, .integration-card, .job-card { border: 1px solid var(--auvrynt-border-soft); background: rgba(15,8,28,.62); }
.metric-card { min-height: 108px; padding: 15px; border-radius: 13px; }
.metric-card span { display: block; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); text-transform: uppercase; letter-spacing: .08em; }
.metric-card strong { display: block; margin-top: 14px; font-size: 28px; letter-spacing: -.04em; }
.jobs-grid-two { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(300px, .75fr); gap: 20px; }
.jobs-panel { min-width: 0; padding: 20px; border-radius: 16px; }
.panel-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.panel-head h2 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
.panel-head p { margin: 5px 0 0; color: var(--auvrynt-text-muted); font-size: 12px; }
.button { min-height: 36px; padding: 8px 13px; border: 1px solid var(--auvrynt-border); border-radius: 9px; color: var(--auvrynt-text); background: rgba(255,255,255,.04); font-size: 12px; font-weight: 700; }
.button:hover { background: rgba(192,132,252,.12); }
.button.primary { border-color: rgba(192,132,252,.55); background: rgba(126,34,206,.38); }
.button.danger { color: #fecaca; border-color: rgba(248,113,113,.4); }
.job-list { display: grid; gap: 8px; }
.job-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 16px; padding: 13px; border-radius: 11px; }
.job-card h3 { margin: 0; font-size: 14px; }
.job-card p { margin: 5px 0 0; color: var(--auvrynt-text-secondary); font-size: 12px; }
.job-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.badge { display: inline-flex; align-items: center; min-height: 22px; padding: 3px 7px; border: 1px solid var(--auvrynt-border-soft); border-radius: 999px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); }
.badge.match { color: #ddd6fe; border-color: rgba(167,139,250,.42); background: rgba(126,34,206,.2); }
.badge.risk { color: #fed7aa; border-color: rgba(251,146,60,.44); background: rgba(154,52,18,.18); }
.badge.status { color: var(--auvrynt-accent-soft); }
.job-score { align-self: start; color: var(--auvrynt-accent-soft); font: 700 16px var(--auvrynt-font-mono); }
.activity-list, .source-list { display: grid; gap: 0; }
.activity-item, .source-item { display: flex; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--auvrynt-border-soft); font-size: 12px; }
.activity-item:last-child, .source-item:last-child { border-bottom: 0; }
.muted { color: var(--auvrynt-text-muted); }
.empty-state { padding: 32px 18px; border: 1px dashed var(--auvrynt-border); border-radius: 12px; color: var(--auvrynt-text-muted); text-align: center; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.toolbar input, .toolbar select, .form-grid input, .form-grid select, .form-grid textarea, .profile-form input, .profile-form textarea { width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid var(--auvrynt-border); border-radius: 8px; color: var(--auvrynt-text); background: rgba(6,3,14,.72); }
.toolbar input { flex: 1 1 240px; }
.toolbar select { width: auto; min-width: 130px; }
.job-table-wrap { overflow-x: auto; }
.job-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.job-table th { padding: 10px 9px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); text-align: left; text-transform: uppercase; letter-spacing: .08em; }
.job-table td { padding: 12px 9px; border-top: 1px solid var(--auvrynt-border-soft); vertical-align: top; }
.job-table tr:hover td { background: rgba(192,132,252,.05); }
.job-table button.link-button { padding: 0; border: 0; color: var(--auvrynt-accent-soft); background: transparent; font-weight: 700; text-align: left; }
.link-button { padding: 0; border: 0; color: var(--auvrynt-accent-soft); background: transparent; font-weight: 700; text-align: left; }
.pagination { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; color: var(--auvrynt-text-muted); font-size: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.form-field { display: grid; gap: 6px; }
.form-field.full { grid-column: 1 / -1; }
.form-field label { color: var(--auvrynt-text-secondary); font-size: 11px; font-weight: 700; }
.form-field textarea { min-height: 110px; resize: vertical; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.preference-fieldset { display: flex; flex-wrap: wrap; gap: 14px; margin: 0; padding: 12px; border: 1px solid var(--auvrynt-border-soft); border-radius: 10px; color: var(--auvrynt-text-secondary); font-size: 12px; }
.preference-fieldset legend { padding: 0 5px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); text-transform: uppercase; letter-spacing: .08em; }
.preference-fieldset label { display: inline-flex; align-items: center; gap: 6px; }
.preference-fieldset input { width: auto; min-height: auto; }
.form-actions.full { grid-column: 1 / -1; }
.tracker-board { display: grid; grid-template-columns: repeat(4, minmax(210px, 1fr)); gap: 10px; overflow-x: auto; padding-bottom: 4px; }
.tracker-column { min-height: 220px; padding: 12px; border: 1px solid var(--auvrynt-border-soft); border-radius: 12px; background: rgba(10,5,20,.5); }
.tracker-column h3 { margin: 0 0 10px; font-size: 12px; }
.tracker-column .job-card { display: block; margin-top: 8px; padding: 10px; }
.tracker-column .job-card p { font-size: 11px; }
.tracker-table-wrap { overflow-x: auto; }
.tracker-table { min-width: 600px; }
.integration-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.integration-card { display: flex; min-height: 252px; flex-direction: column; padding: 18px; border-radius: 14px; }
.integration-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.integration-card h2 { margin: 0; font-size: 16px; }
.integration-eyebrow { margin: 0 0 5px !important; color: var(--auvrynt-text-muted) !important; font: 10px var(--auvrynt-font-mono); letter-spacing: .1em; text-transform: uppercase; }
.integration-status { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 24px; margin: 0; padding: 3px 8px; border: 1px solid var(--auvrynt-border-soft); border-radius: 999px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); text-transform: uppercase; letter-spacing: .04em; }
.integration-status.status-connected { color: #bbf7d0; border-color: rgba(74,222,128,.36); background: rgba(22,101,52,.2); }
.integration-status.status-available { color: #ddd6fe; border-color: rgba(167,139,250,.42); background: rgba(126,34,206,.2); }
.integration-status.status-needs_login { color: #fed7aa; border-color: rgba(251,146,60,.42); background: rgba(154,52,18,.18); }
.integration-card p { color: var(--auvrynt-text-secondary); font-size: 12px; line-height: 1.55; }
.integration-callout { display: grid; gap: 5px; margin-top: 4px; padding: 10px 11px; border: 1px solid rgba(251,146,60,.3); border-radius: 10px; color: #fed7aa; background: rgba(154,52,18,.12); font-size: 11px; line-height: 1.45; }
.integration-callout strong { color: #ffedd5; font-size: 11px; }
.integration-callout code { color: #fef3c7; font: 10px var(--auvrynt-font-mono); }
.integration-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: auto; padding-top: 16px; }
.integration-footnote { margin: 16px 0 0; color: var(--auvrynt-text-muted); font-size: 11px !important; }
.integration-notice { margin: 0 0 14px; padding: 10px 12px; border: 1px solid rgba(192,132,252,.32); border-radius: 10px; background: rgba(126,34,206,.12); }
.button:disabled { cursor: not-allowed; opacity: .5; }
.profile-form { display: grid; gap: 16px; }
.profile-form textarea { min-height: 74px; }
.notice { min-height: 20px; color: var(--auvrynt-accent-soft); font-size: 12px; }
dialog { max-width: min(680px, calc(100vw - 28px)); color: var(--auvrynt-text); border: 1px solid var(--auvrynt-border); border-radius: 14px; background: var(--auvrynt-surface); }
dialog::backdrop { background: rgba(3,1,8,.72); backdrop-filter: blur(4px); }
.detail-copy { white-space: pre-wrap; color: var(--auvrynt-text-secondary); font-size: 13px; line-height: 1.65; }
@media (max-width: 1180px) { .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .jobs-grid-two { grid-template-columns: 1fr; } }
@media (max-width: 940px) { .jobs-shell { grid-template-columns: 1fr; } .jobs-rail { position: static; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; height: auto; padding: 12px 16px; border-right: 0; border-bottom: 1px solid var(--auvrynt-border-soft); } .jobs-brand-row { grid-column: 1 / -1; width: 100%; padding: 0; } .jobs-brand-version, .jobs-rail-title, .jobs-rail-meta { display: none; } .jobs-nav { grid-column: 1 / -1; display: flex; overflow-x: auto; padding-top: 10px; } .jobs-nav a { flex: 0 0 auto; } .jobs-rail-spacer { display: none; } .jobs-workspace { padding-inline: 22px; } }
@media (max-width: 680px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .jobs-header { display: block; padding-top: 26px; } .jobs-pid { display: block; margin-top: 14px; } .jobs-workspace { padding-inline: 14px; } .jobs-content { padding-top: 18px; } .jobs-panel { padding: 16px; } .form-grid, .integration-grid { grid-template-columns: 1fr; } .form-field.full { grid-column: auto; } .tracker-board { margin-inline: -4px; } .job-table { min-width: 720px; } .mode-switch { margin-bottom: 0; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;
