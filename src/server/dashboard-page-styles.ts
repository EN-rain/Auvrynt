import { AUVRYNT_THEME_CSS } from "../ui/brand-theme.js";

export const DASHBOARD_PAGE_CSS = `
${AUVRYNT_THEME_CSS}
*, *::before, *::after { box-sizing: border-box; }
html { min-height: 100%; background: var(--auvrynt-bg-deep); }
body { margin: 0; min-width: 320px; min-height: 100vh; color: var(--auvrynt-text); background: radial-gradient(circle at 72% -18%, rgba(192,132,252,.20), transparent 36%), radial-gradient(circle at -10% 86%, rgba(126,34,206,.14), transparent 34%), var(--auvrynt-bg-deep); font-family: var(--auvrynt-font-sans); }
button, input { font: inherit; }
button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--auvrynt-accent); outline-offset: 3px; }
button:disabled { cursor: not-allowed; opacity: .58; }
[hidden] { display: none !important; }
.app-shell { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 100vh; }
.control-rail { position: sticky; top: 0; display: flex; height: 100vh; min-width: 0; flex-direction: column; padding: 22px 16px 16px; border-right: 1px solid var(--auvrynt-border-soft); background: linear-gradient(180deg, rgba(30,11,54,.84), rgba(11,7,20,.92)); backdrop-filter: blur(24px); }
.brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 20px; }
.brand img { width: 38px; height: 38px; border-radius: 11px; box-shadow: 0 12px 28px rgba(5,2,12,.36); }
.brand-name { display: block; font-size: 17px; font-weight: 780; letter-spacing: -.025em; }
.brand-version { display: block; margin-top: 2px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); }
.agent-presence { position: relative; margin: 0 2px 24px; padding: 15px 14px 14px; border: 1px solid var(--auvrynt-border-soft); border-radius: 14px; background: rgba(12,6,24,.42); overflow: hidden; }
.agent-presence::after { position: absolute; inset: auto -30px -46px auto; width: 110px; height: 110px; border-radius: 50%; background: rgba(192,132,252,.12); filter: blur(18px); content: ""; }
.presence-head { position: relative; z-index: 1; display: flex; align-items: center; gap: 9px; }
.presence-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: var(--auvrynt-text-muted); box-shadow: 0 0 0 4px rgba(167,139,250,.08); }
.agent-presence[data-state="working"] .presence-dot { background: var(--auvrynt-accent); animation: status-heartbeat 1.7s ease-in-out infinite; box-shadow: 0 0 18px rgba(192,132,252,.82); }
.agent-presence[data-state="connected"] .presence-dot { background: var(--auvrynt-accent-soft); box-shadow: 0 0 14px rgba(216,180,254,.64); }
.agent-presence[data-state="waiting"] .presence-dot { background: transparent; border: 1px solid var(--auvrynt-text-muted); }
.agent-presence[data-state="stopping"] .presence-dot { background: var(--auvrynt-warning); box-shadow: 0 0 12px rgba(253,230,138,.38); }
.presence-title { position: relative; z-index: 1; font-size: 12px; font-weight: 760; }
.presence-detail { position: relative; z-index: 1; margin: 7px 0 0; color: var(--auvrynt-text-secondary); font-size: 10px; line-height: 1.45; }
.rail-label { margin: 0 10px 8px; color: var(--auvrynt-text-muted); font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.dashboard-nav { display: grid; gap: 4px; }
.nav-tab { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 10px; border: 0; border-radius: 10px; color: var(--auvrynt-text-secondary); background: transparent; cursor: pointer; text-align: left; transition: color 140ms ease-out, background 140ms ease-out, transform 140ms ease-out; }
.nav-tab:hover { color: var(--auvrynt-text); background: rgba(192,132,252,.08); transform: translateX(2px); }
.nav-tab[aria-selected="true"] { color: var(--auvrynt-text); background: rgba(192,132,252,.14); box-shadow: inset 0 0 0 1px rgba(216,180,254,.13); }
.nav-icon { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 8px; color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.08); font: 11px var(--auvrynt-font-mono); }
.nav-label { font-size: 12px; font-weight: 720; }
.nav-count { color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
.rail-spacer { flex: 1; min-height: 24px; }
.lifecycle { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 14px; border-top: 1px solid var(--auvrynt-border-soft); }
.button { position: relative; display: inline-flex; min-height: 38px; align-items: center; justify-content: center; gap: 7px; padding: 8px 12px; border: 1px solid var(--auvrynt-border); border-radius: 10px; color: var(--auvrynt-accent-soft); background: rgba(12,6,24,.36); cursor: pointer; font-size: 11px; font-weight: 760; transition: transform 130ms ease-out, background 130ms ease-out, border-color 130ms ease-out, box-shadow 130ms ease-out; }
.button:hover:not(:disabled) { border-color: rgba(216,180,254,.56); background: rgba(192,132,252,.12); transform: translateY(-1px); }
.button.primary { border-color: rgba(216,180,254,.58); color: var(--auvrynt-bg-deep); background: var(--auvrynt-accent-soft); box-shadow: 0 10px 24px rgba(192,132,252,.16); }
.button.primary:hover:not(:disabled) { color: var(--auvrynt-bg-deep); background: #f3e8ff; }
.button.stop { color: var(--auvrynt-danger); }
.button.stop:hover:not(:disabled) { border-color: rgba(240,171,252,.62); background: rgba(240,171,252,.09); }
.button[aria-busy="true"] { pointer-events: none; }
.button[aria-busy="true"]::before { width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: button-spin .72s linear infinite; content: ""; }
.rail-meta { margin: 10px 2px 0; color: var(--auvrynt-text-muted); font: 9px/1.5 var(--auvrynt-font-mono); text-align: center; }
.workspace { --workspace-gutter: 36px; min-width: 0; padding: 0 var(--workspace-gutter) 48px; }
.workspace-header { position: sticky; z-index: 8; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 108px; margin-inline: calc(var(--workspace-gutter) * -1); padding: 22px var(--workspace-gutter) 18px; border-bottom: 1px solid var(--auvrynt-border-soft); background: linear-gradient(180deg, rgba(11,7,20,.98) 68%, rgba(11,7,20,.76)); backdrop-filter: blur(18px); }
.page-kicker { margin: 0 0 5px; color: var(--auvrynt-accent); font-size: 10px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
.page-title { margin: 0; font-size: clamp(28px, 3vw, 40px); line-height: 1; letter-spacing: -.04em; }
.page-description { max-width: 62ch; margin: 8px 0 0; color: var(--auvrynt-text-secondary); font-size: 12px; line-height: 1.5; }
.server-state { display: flex; align-items: center; gap: 10px; padding: 8px 0; border: 0; background: transparent; }
.server-state-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--auvrynt-accent); box-shadow: 0 0 12px rgba(192,132,252,.62); }
.server-state-copy strong { display: block; font-size: 10px; }
.server-state-copy small { display: block; margin-top: 2px; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
.tunnel-alert { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; margin: 24px 0 0; padding: 14px 16px; border: 1px solid rgba(253,230,138,.35); border-radius: 13px; background: rgba(74,50,10,.25); box-shadow: 0 16px 44px rgba(5,2,12,.18); }
.tunnel-alert.error { border-color: rgba(240,171,252,.46); background: rgba(68,14,57,.28); }
.tunnel-alert-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; color: var(--auvrynt-warning); background: rgba(253,230,138,.09); font: 700 15px var(--auvrynt-font-mono); }
.tunnel-alert.error .tunnel-alert-icon { color: var(--auvrynt-danger); background: rgba(240,171,252,.09); }
.tunnel-alert-copy strong { display: block; font-size: 12px; }
.tunnel-alert-copy p { margin: 4px 0 0; color: var(--auvrynt-text-secondary); font-size: 10px; line-height: 1.5; }
.toast-region { position: fixed; z-index: 100; inset: auto 16px 24px; display: grid; place-items: center; pointer-events: none; }
.toast { width: max-content; max-width: min(520px, calc(100vw - 32px)); padding: 11px 15px; border: 1px solid rgba(216,180,254,.28); border-radius: 12px; color: var(--auvrynt-text); background: rgba(24,10,43,.96); box-shadow: 0 18px 52px rgba(5,2,12,.46); opacity: 0; transform: translateY(14px) scale(.98); transition: opacity 180ms ease-out, transform 220ms cubic-bezier(.2,.8,.2,1); pointer-events: auto; font-size: 11px; line-height: 1.45; text-align: center; }
.toast.visible { opacity: 1; transform: translateY(0) scale(1); }
.toast.error { border-color: rgba(240,171,252,.48); color: var(--auvrynt-danger); background: rgba(42,12,50,.97); }
.lifecycle-overlay { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(5,2,12,.82); backdrop-filter: blur(14px); opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 180ms ease-out, visibility 180ms ease-out; }
.lifecycle-overlay.active { opacity: 1; visibility: visible; pointer-events: auto; }
.lifecycle-panel { position: relative; display: grid; width: min(360px, calc(100vw - 40px)); justify-items: center; gap: 14px; padding: 28px 24px 24px; overflow: hidden; border: 1px solid rgba(216,180,254,.26); border-radius: 18px; background: linear-gradient(155deg, rgba(30,11,54,.98), rgba(11,7,20,.99)); box-shadow: 0 28px 90px rgba(5,2,12,.68); text-align: center; animation: lifecycle-panel-in .34s cubic-bezier(.2,.8,.2,1) both, lifecycle-panel-breathe 2.8s ease-in-out .34s infinite; }
.lifecycle-panel::before { position: absolute; inset: -35% -10% auto; height: 120px; background: radial-gradient(circle, rgba(192,132,252,.18), transparent 68%); filter: blur(10px); animation: lifecycle-glow 2.4s ease-in-out infinite; content: ""; pointer-events: none; }
.lifecycle-spinner { position: relative; width: 46px; height: 46px; border: 3px solid rgba(216,180,254,.16); border-top-color: var(--auvrynt-accent-soft); border-radius: 50%; animation: button-spin .8s linear infinite, lifecycle-spinner-pulse 1.6s ease-in-out infinite; }
.lifecycle-spinner::before { position: absolute; inset: -8px; border: 1px solid rgba(216,180,254,.12); border-radius: 50%; animation: lifecycle-ring 1.8s ease-out infinite; content: ""; }
.lifecycle-spinner::after { position: absolute; inset: 8px; border: 2px solid rgba(192,132,252,.16); border-bottom-color: var(--auvrynt-accent); border-radius: 50%; animation: button-spin 1.15s linear infinite reverse; content: ""; }
.lifecycle-title { position: relative; margin: 2px 0 0; font-size: 19px; letter-spacing: -.025em; animation: lifecycle-title-pulse 1.8s ease-in-out infinite; }
.lifecycle-message { position: relative; margin: 0; color: var(--auvrynt-text-secondary); font-size: 11px; line-height: 1.55; animation: lifecycle-message-fade 2s ease-in-out infinite; }
.lifecycle-progress { position: relative; width: 100%; height: 3px; overflow: hidden; border-radius: 999px; background: rgba(216,180,254,.08); }
.lifecycle-progress::before { display: block; width: 42%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, transparent, var(--auvrynt-accent-soft), transparent); animation: lifecycle-scan 1.15s ease-in-out infinite; content: ""; }
.lifecycle-overlay.complete .lifecycle-panel::before, .lifecycle-overlay.complete .lifecycle-title, .lifecycle-overlay.complete .lifecycle-message { animation: none; }
.lifecycle-overlay.complete .lifecycle-spinner { display: grid; place-items: center; border-color: rgba(216,180,254,.22); animation: none; }
.lifecycle-overlay.complete .lifecycle-spinner::before { display: none; }
.lifecycle-overlay.complete .lifecycle-spinner::after { position: static; display: block; border: 0; color: var(--auvrynt-accent-soft); font: 800 21px var(--auvrynt-font-sans); animation: none; content: "✓"; }
.lifecycle-overlay.complete .lifecycle-progress { display: none; }
.confirm-dialog { width: min(440px, calc(100vw - 32px)); padding: 0; border: 1px solid rgba(216,180,254,.28); border-radius: 16px; color: var(--auvrynt-text); background: linear-gradient(160deg, rgba(30,11,54,.98), rgba(11,7,20,.99)); box-shadow: 0 30px 90px rgba(5,2,12,.72); }
.confirm-dialog::backdrop { background: rgba(5,2,12,.74); backdrop-filter: blur(8px); }
.confirm-body { padding: 24px 24px 18px; }
.confirm-kicker { margin: 0 0 8px; color: var(--auvrynt-accent); font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.confirm-title { margin: 0; font-size: 20px; letter-spacing: -.025em; }
.confirm-message { margin: 12px 0 0; color: var(--auvrynt-text-secondary); font-size: 12px; line-height: 1.6; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 9px; padding: 14px 18px 18px; border-top: 1px solid rgba(216,180,254,.10); }
.dashboard-view { min-width: 0; padding-top: 24px; }
.analytics-lead { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .55fr); gap: 18px; }
.activity-surface, .change-surface { min-width: 0; border: 1px solid var(--auvrynt-border-soft); border-radius: 16px; background: rgba(18,8,34,.56); box-shadow: 0 22px 60px rgba(5,2,12,.22); }
.activity-surface { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 236px; overflow: hidden; }
.activity-copy { display: flex; min-width: 0; flex-direction: column; justify-content: space-between; padding: 26px 28px; }
.surface-label { margin: 0 0 10px; color: var(--auvrynt-text-muted); font-size: 10px; font-weight: 760; }
.agent-headline { margin: 0; max-width: 16ch; font-size: clamp(24px, 3vw, 38px); line-height: 1.05; letter-spacing: -.035em; }
.agent-headline span { color: var(--auvrynt-accent-soft); }
.agent-caption { max-width: 56ch; margin: 14px 0 0; color: var(--auvrynt-text-secondary); font-size: 12px; line-height: 1.55; }
.activity-foot { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 24px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); }
.change-surface { padding: 24px; background: linear-gradient(145deg, rgba(30,11,54,.82), rgba(12,6,24,.58)); }
.change-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.change-head h2 { margin: 0; font-size: 15px; letter-spacing: -.02em; }
.change-workspace { max-width: 26ch; margin: 6px 0 0; overflow: hidden; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); text-overflow: ellipsis; white-space: nowrap; }
.change-sampled { flex: 0 0 auto; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
.code-delta { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); margin: 30px 0 24px; }
.delta { min-width: 0; overflow: hidden; }
.delta + .delta { padding-left: 18px; border-left: 1px solid var(--auvrynt-border-soft); }
.delta strong { display: block; max-width: 100%; overflow: hidden; font-size: clamp(24px, 2.7vw, 40px); font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: -.035em; text-overflow: ellipsis; white-space: nowrap; }
.delta.add strong { color: var(--auvrynt-accent-soft); }
.delta.remove strong { color: var(--auvrynt-danger); }
.delta span { display: block; margin-top: 7px; color: var(--auvrynt-text-muted); font-size: 9px; }
.file-delta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding-top: 16px; border-top: 1px solid var(--auvrynt-border-soft); }
.file-delta strong { display: block; font-size: 16px; }
.file-delta span { display: block; margin-top: 3px; color: var(--auvrynt-text-muted); font-size: 9px; }
.runtime-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 18px 0 0; border-top: 1px solid var(--auvrynt-border-soft); border-bottom: 1px solid var(--auvrynt-border-soft); }
.runtime-metric { min-width: 0; padding: 18px 16px; }
.runtime-metric + .runtime-metric { border-left: 1px solid var(--auvrynt-border-soft); }
.runtime-metric span { display: block; color: var(--auvrynt-text-muted); font-size: 9px; font-weight: 760; }
.runtime-metric strong { display: block; margin-top: 7px; overflow: hidden; font-size: 20px; letter-spacing: -.03em; text-overflow: ellipsis; white-space: nowrap; }
.operations-grid { display: grid; grid-template-columns: minmax(340px, .9fr) minmax(0, 1.1fr); gap: 18px; }
.section-surface { min-width: 0; padding: 22px; border-top: 1px solid var(--auvrynt-border-soft); border-bottom: 1px solid var(--auvrynt-border-soft); background: rgba(12,6,24,.24); }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.section-head h2 { margin: 0; font-size: 14px; letter-spacing: -.015em; }
.section-head p { margin: 5px 0 0; color: var(--auvrynt-text-muted); font-size: 10px; }
.section-action { min-height: 32px; padding: 6px 10px; }
.connection-list { display: grid; gap: 0; }
.connection-row { display: grid; grid-template-columns: 86px minmax(0, 1fr) 34px; align-items: center; gap: 10px; min-height: 49px; border-top: 1px solid rgba(216,180,254,.10); }
.connection-row:first-child { border-top: 0; }
.connection-label { color: var(--auvrynt-text-muted); font-size: 10px; }
.connection-value { min-width: 0; overflow: hidden; color: var(--auvrynt-text-secondary); font: 10px var(--auvrynt-font-mono); text-overflow: ellipsis; white-space: nowrap; }
.connection-value a { color: inherit; text-decoration: none; }
.connection-value a:hover { color: var(--auvrynt-accent-soft); }
.icon-button { display: grid; width: 31px; height: 31px; place-items: center; border: 1px solid transparent; border-radius: 9px; color: var(--auvrynt-text-muted); background: transparent; cursor: pointer; }
.icon-button:hover { border-color: var(--auvrynt-border-soft); color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.08); }
.icon-button.copied { color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.14); }
.icon-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
.icon-button[aria-busy="true"] svg { display: none; }
.icon-button[aria-busy="true"]::after { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: button-spin .72s linear infinite; content: ""; }
.session-limit-form { display: grid; grid-template-columns: minmax(0, 1fr) 52px 34px; align-items: center; gap: 8px; min-height: 54px; border-top: 1px solid rgba(216,180,254,.10); }
.session-limit-copy strong { display: block; font-size: 11px; }
.session-limit-copy small { display: block; margin-top: 3px; color: var(--auvrynt-text-muted); font-size: 9px; line-height: 1.4; }
.session-limit-input { width: 52px; min-height: 34px; padding: 7px 4px; border: 0; border-radius: 8px; outline: 0; color: var(--auvrynt-text); background: transparent; appearance: textfield; font: 11px var(--auvrynt-font-mono); text-align: center; }
.session-limit-input:hover, .session-limit-input:focus { background: rgba(192,132,252,.08); }
.session-limit-input::-webkit-inner-spin-button, .session-limit-input::-webkit-outer-spin-button { margin: 0; appearance: none; }
.session-idle-timeout-form { grid-template-columns: minmax(0, 1fr) 52px auto 34px; }
.session-time-unit { color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
.integration-list { display: grid; }
.integration-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: center; gap: 10px; min-height: 54px; border-top: 1px solid rgba(216,180,254,.10); }
.integration-row:first-child { border-top: 0; }
.integration-name strong { display: block; font-size: 11px; }
.integration-name small { display: block; margin-top: 3px; color: var(--auvrynt-text-muted); font-size: 9px; line-height: 1.4; }
.tool-count { display: flex; align-items: baseline; gap: 2px; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); white-space: nowrap; }
.tool-count strong { color: var(--auvrynt-accent-soft); font: 11px var(--auvrynt-font-mono); font-weight: 760; }
.tool-count[data-warn="true"] strong { color: var(--auvrynt-warning); }
.state { color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); text-transform: uppercase; }
.state.connected { color: var(--auvrynt-accent-soft); text-shadow: 0 0 12px rgba(192,132,252,.32); }
.state.available { color: var(--auvrynt-text-secondary); }
.state.offline { color: var(--auvrynt-warning); }
.integration-toggle { min-width: 76px; min-height: 32px; padding: 6px 9px; }
.secrets-layout { display: grid; grid-template-columns: minmax(280px, .72fr) minmax(0, 1.28fr); gap: 18px; }
.secret-form { display: grid; gap: 12px; }
.secret-label { color: var(--auvrynt-text-secondary); font-size: 10px; font-weight: 720; }
.secret-input-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.secret-input { width: 100%; min-height: 40px; padding: 9px 11px; border: 1px solid var(--auvrynt-border); border-radius: 10px; color: var(--auvrynt-text); background: var(--auvrynt-code); font: 10px var(--auvrynt-font-mono); }
.secret-help { margin: 0; color: var(--auvrynt-text-muted); font-size: 9px; line-height: 1.55; }
.secret-warning { margin: 14px 0 0; padding: 10px 11px; border: 1px solid rgba(253,230,138,.24); border-radius: 10px; color: var(--auvrynt-warning); background: rgba(74,50,10,.18); font-size: 9px; line-height: 1.5; }
.token-list { display: grid; }
.token-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; min-height: 58px; border-top: 1px solid rgba(216,180,254,.10); }
.token-row:first-child { border-top: 0; }
.token-name strong { display: block; font: 11px var(--auvrynt-font-mono); letter-spacing: .03em; }
.token-name small { display: block; margin-top: 4px; color: var(--auvrynt-text-muted); font-size: 9px; }
.token-status { color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); text-transform: uppercase; }
.token-status.active { color: var(--auvrynt-accent-soft); }
.token-status.exhausted { color: var(--auvrynt-danger); }
.token-actions { display: flex; gap: 6px; }
.token-action { min-height: 31px; padding: 5px 9px; }
.analytics-lower { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(250px, .65fr); gap: 18px; margin-top: 24px; }
.analytics-panel { min-width: 0; padding: 20px 22px; border: 1px solid var(--auvrynt-border-soft); border-radius: 14px; background: rgba(12,6,24,.34); }
.analytics-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.analytics-panel h3 { margin: 0; font-size: 12px; }
.analytics-panel small { color: var(--auvrynt-text-muted); font-size: 9px; }
.activity-chart { display: grid; grid-template-columns: repeat(12, minmax(5px, 1fr)); align-items: end; gap: 7px; height: 150px; margin: 20px 0 8px; padding-top: 8px; border-bottom: 1px solid var(--auvrynt-border-soft); }
.activity-bar { height: 100%; min-height: 3px; border-radius: 5px 5px 0 0; background: linear-gradient(180deg, var(--auvrynt-accent-soft), rgba(192,132,252,.28)); transform-origin: bottom; transition: transform 220ms cubic-bezier(.2,.8,.2,1); }
.activity-bar.level-0 { transform: scaleY(.03); } .activity-bar.level-1 { transform: scaleY(.1); } .activity-bar.level-2 { transform: scaleY(.2); } .activity-bar.level-3 { transform: scaleY(.3); } .activity-bar.level-4 { transform: scaleY(.4); } .activity-bar.level-5 { transform: scaleY(.5); } .activity-bar.level-6 { transform: scaleY(.6); } .activity-bar.level-7 { transform: scaleY(.7); } .activity-bar.level-8 { transform: scaleY(.8); } .activity-bar.level-9 { transform: scaleY(.9); } .activity-bar.level-10 { transform: scaleY(1); }
.chart-axis { display: flex; justify-content: space-between; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
.analytics-stack { display: grid; gap: 18px; }
.mix-list, .top-tools { display: grid; gap: 10px; margin-top: 15px; }
.mix-row { display: grid; grid-template-columns: 62px minmax(0, 1fr) 28px; align-items: center; gap: 9px; }
.mix-label, .mix-count { color: var(--auvrynt-text-secondary); font: 9px var(--auvrynt-font-mono); }
.mix-count { text-align: right; }
.mix-track { height: 5px; overflow: hidden; border-radius: 999px; background: rgba(216,180,254,.08); }
.mix-fill { display: block; width: 100%; height: 100%; min-width: 2px; border-radius: inherit; background: var(--auvrynt-accent); transform-origin: left; transition: transform 220ms cubic-bezier(.2,.8,.2,1); }
.mix-fill.level-0 { transform: scaleX(.02); } .mix-fill.level-1 { transform: scaleX(.1); } .mix-fill.level-2 { transform: scaleX(.2); } .mix-fill.level-3 { transform: scaleX(.3); } .mix-fill.level-4 { transform: scaleX(.4); } .mix-fill.level-5 { transform: scaleX(.5); } .mix-fill.level-6 { transform: scaleX(.6); } .mix-fill.level-7 { transform: scaleX(.7); } .mix-fill.level-8 { transform: scaleX(.8); } .mix-fill.level-9 { transform: scaleX(.9); } .mix-fill.level-10 { transform: scaleX(1); }
.top-tool { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding-top: 9px; border-top: 1px solid rgba(216,180,254,.08); color: var(--auvrynt-text-secondary); font: 9px var(--auvrynt-font-mono); }
.top-tool:first-child { padding-top: 0; border-top: 0; }
.top-tool-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.analytics-empty { color: var(--auvrynt-text-muted); font-size: 10px; }
.view-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.view-toolbar h2 { margin: 0; font-size: 14px; }
.toolbar-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 7px; }
.search { width: min(320px, 100%); min-height: 38px; padding: 8px 11px; border: 1px solid var(--auvrynt-border); border-radius: 10px; color: var(--auvrynt-text); background: var(--auvrynt-code); }
.search::placeholder { color: var(--auvrynt-text-muted); }
.logs-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 320px) auto; gap: 12px; }
.log-filter-row { display: flex; flex-wrap: nowrap; align-items: center; gap: 4px; }
.filter { width: auto; min-height: 34px; padding: 6px 10px; border: 1px solid transparent; border-radius: 9px; color: var(--auvrynt-text-muted); background: transparent; cursor: pointer; font-size: 9px; font-weight: 760; text-align: center; text-transform: uppercase; }
.filter:hover { color: var(--auvrynt-text-secondary); background: rgba(192,132,252,.05); }
.filter.active { border-color: var(--auvrynt-border); color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.09); }
.logs-wrap { position: relative; min-width: 0; border: 1px solid var(--auvrynt-border-soft); border-radius: 14px; overflow: hidden; }
.logs { height: calc(100vh - 220px); min-height: 420px; overflow: auto; background: rgba(8,4,16,.72); font-family: var(--auvrynt-font-mono); scrollbar-width: thin; scrollbar-color: rgba(192,132,252,.45) transparent; }
.log-row { display: grid; grid-template-columns: 82px 54px minmax(150px, 220px) minmax(0, 1fr); gap: 10px; padding: 9px 12px; border-bottom: 1px solid rgba(216,180,254,.07); color: var(--auvrynt-text-secondary); font-size: 10px; line-height: 1.45; }
.log-row:hover { background: rgba(192,132,252,.035); }
.log-row time, .log-level { color: var(--auvrynt-text-muted); }
.log-level.warn { color: var(--auvrynt-warning); }
.log-level.error { color: var(--auvrynt-danger); }
.log-event { color: var(--auvrynt-accent-soft); overflow-wrap: anywhere; }
.log-fields { min-width: 0; color: var(--auvrynt-text-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.new-logs { position: absolute; z-index: 2; top: 10px; right: 12px; display: none; }
.new-logs.visible { display: inline-flex; }
.command-toolbar { margin-top: 4px; }
.tools-toolbar { flex-wrap: wrap; }
.tools-tab-stack { display: grid; gap: 0; min-width: 0; flex: 1 1 auto; }
.tools-integration-tabs, .tools-sub-tabs { display: flex; flex-wrap: wrap; align-items: stretch; gap: 0; border-bottom: 1px solid var(--auvrynt-border-soft); }
.tools-integration-tabs small, .tools-sub-tabs small { margin-left: 6px; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); font-weight: 500; text-transform: none; }
.tools-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 38px;
  padding: 8px 14px;
  border: 0;
  border-radius: 0;
  color: var(--auvrynt-text-muted);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: -.01em;
  text-transform: none;
  transition: color 140ms ease-out, background 140ms ease-out;
}
.tools-tab:hover { color: var(--auvrynt-text-secondary); background: rgba(192,132,252,.05); }
.tools-tab.active {
  color: var(--auvrynt-text);
  background: transparent;
  box-shadow: inset 0 -2px 0 var(--auvrynt-accent);
}
.tools-sub-tabs { margin-top: 0; border-bottom-color: rgba(216,180,254,.08); }
.tools-sub-tabs .tools-tab { min-height: 32px; padding: 6px 12px; font-size: 11px; font-weight: 600; }
.tools-sub-tabs .tools-tab.active { box-shadow: inset 0 -2px 0 rgba(192,132,252,.55); }
.tools-no-tabs { padding: 10px 2px; color: var(--auvrynt-text-muted); font-size: 10px; }
.tools-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.tools-summary { padding: 12px 2px; color: var(--auvrynt-text-muted); font-size: 10px; }
.tools-summary strong { color: var(--auvrynt-accent-soft); font-weight: 760; }
.tools-group { min-width: 0; border-top: 1px solid var(--auvrynt-border-soft); }
.tools-group-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 2px; list-style: none; cursor: pointer; user-select: none; }
.tools-group-head::-webkit-details-marker { display: none; }
.tools-group-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tools-group-title strong { font-size: 12px; letter-spacing: -.01em; }
.tools-group-chevron { display: inline-block; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 6px solid var(--auvrynt-text-muted); transition: transform 140ms ease; }
.tools-group[open] .tools-group-chevron { transform: rotate(90deg); }
.tools-group-count { color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
.tools-group-toggle { flex: 0 0 auto; }
.tools-group-toggle[data-partial="true"] .tool-toggle-track { border-color: var(--auvrynt-accent); background: rgba(192,132,252,.12); }
.tools-group-toggle[data-partial="true"] .tool-toggle-track::after { background: var(--auvrynt-accent-soft); transform: translateX(8px); }
.tools-group-list { display: none; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 6px 18px; padding: 0 2px 12px 22px; }
.tools-group[open] .tools-group-list { display: grid; }
.tool-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 7px 2px; border-top: 1px solid rgba(216,180,254,.06); }
.tool-row:first-child { border-top: 0; }
.tool-row.disabled { opacity: .5; }
.tool-check { position: relative; display: grid; width: 18px; height: 18px; place-items: center; cursor: pointer; }
.tool-check input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.tool-check-box { display: grid; place-items: center; width: 16px; height: 16px; border: 1px solid var(--auvrynt-border); border-radius: 4px; background: rgba(216,180,254,.06); transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease; }
.tool-check-box::after { width: 8px; height: 5px; border-left: 2px solid transparent; border-bottom: 2px solid transparent; transform: rotate(-45deg) translate(0.5px, -1px); content: ""; }
.tool-check input:checked + .tool-check-box { border-color: var(--auvrynt-accent); background: rgba(192,132,252,.28); }
.tool-check input:checked + .tool-check-box::after { border-left-color: var(--auvrynt-accent-soft); border-bottom-color: var(--auvrynt-accent-soft); }
.tool-check input:focus-visible + .tool-check-box { outline: 2px solid var(--auvrynt-accent-soft); outline-offset: 2px; }
.tool-check input:disabled + .tool-check-box { opacity: .4; cursor: not-allowed; }
.tool-toggle { position: relative; display: grid; width: 34px; height: 20px; place-items: center; cursor: pointer; }
.tool-toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.tool-toggle-track { display: block; width: 34px; height: 19px; border: 1px solid var(--auvrynt-border); border-radius: 999px; background: rgba(216,180,254,.07); transition: background 160ms ease, border-color 160ms ease; }
.tool-toggle-track::after { display: block; width: 13px; height: 13px; margin: 2px; border-radius: 50%; background: var(--auvrynt-text-muted); content: ""; transition: transform 160ms ease, background 160ms ease; }
.tool-toggle input:checked + .tool-toggle-track { border-color: var(--auvrynt-accent); background: rgba(192,132,252,.22); }
.tool-toggle input:checked + .tool-toggle-track::after { background: var(--auvrynt-accent-soft); transform: translateX(15px); }
.tool-toggle input:focus-visible + .tool-toggle-track { outline: 2px solid var(--auvrynt-accent-soft); outline-offset: 2px; }
.tool-toggle input:disabled + .tool-toggle-track { opacity: .4; cursor: not-allowed; }
.tool-info { min-width: 0; }
.tool-info strong { display: block; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.tool-info code { display: block; overflow: hidden; margin-top: 2px; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); text-overflow: ellipsis; white-space: nowrap; }
.commands { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 2px 0 28px; }
.command-column { display: flex; min-width: 0; flex-direction: column; gap: 22px; }
.command-group h3 { margin: 0 0 8px; color: var(--auvrynt-accent-soft); font-size: 11px; }
.command-row { display: grid; grid-template-columns: minmax(170px, .8fr) minmax(0, 1.2fr) auto; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid rgba(216,180,254,.09); }
.command-row code { color: var(--auvrynt-accent-soft); font: 10px/1.5 var(--auvrynt-font-mono); overflow-wrap: anywhere; }
.command-row span { color: var(--auvrynt-text-muted); font-size: 10px; line-height: 1.5; }

.empty { padding: 34px 14px; color: var(--auvrynt-text-muted); text-align: center; }
@keyframes status-heartbeat { 0%, 36%, 100% { transform: scale(1); box-shadow: 0 0 10px rgba(192,132,252,.46); } 9% { transform: scale(1.5); box-shadow: 0 0 24px rgba(192,132,252,.94); } 18% { transform: scale(1); } 27% { transform: scale(1.24); box-shadow: 0 0 17px rgba(192,132,252,.72); } }
@keyframes button-spin { to { transform: rotate(360deg); } }
@keyframes lifecycle-scan { 0% { transform: translateX(-120%); } 100% { transform: translateX(340%); } }
@keyframes lifecycle-panel-in { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes lifecycle-panel-breathe { 0%, 100% { box-shadow: 0 28px 90px rgba(5,2,12,.68), 0 0 0 rgba(192,132,252,0); } 50% { box-shadow: 0 30px 100px rgba(5,2,12,.76), 0 0 34px rgba(192,132,252,.12); } }
@keyframes lifecycle-glow { 0%, 100% { opacity: .5; transform: translateX(-8%) scale(.94); } 50% { opacity: 1; transform: translateX(8%) scale(1.08); } }
@keyframes lifecycle-spinner-pulse { 0%, 100% { filter: drop-shadow(0 0 0 rgba(192,132,252,0)); } 50% { filter: drop-shadow(0 0 12px rgba(192,132,252,.42)); } }
@keyframes lifecycle-ring { 0% { opacity: .7; transform: scale(.72); } 75%, 100% { opacity: 0; transform: scale(1.5); } }
@keyframes lifecycle-title-pulse { 0%, 100% { opacity: .86; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-1px); } }
@keyframes lifecycle-message-fade { 0%, 100% { opacity: .68; } 50% { opacity: 1; } }
@media (max-width: 1180px) { .workspace { --workspace-gutter: 26px; } .analytics-lead { grid-template-columns: 1fr; } .change-surface { display: grid; grid-template-columns: minmax(180px, .5fr) minmax(0, 1fr); align-items: center; gap: 20px; } .code-delta { margin: 0; } .file-delta { padding-top: 0; padding-left: 20px; border-top: 0; border-left: 1px solid var(--auvrynt-border-soft); } .runtime-strip { grid-template-columns: repeat(3, 1fr); } .runtime-metric:nth-child(4) { border-left: 0; border-top: 1px solid var(--auvrynt-border-soft); } .runtime-metric:nth-child(5) { border-top: 1px solid var(--auvrynt-border-soft); } }
@media (max-width: 940px) { .app-shell { grid-template-columns: 1fr; } .control-rail { position: static; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; height: auto; padding: 12px 16px; border-right: 0; border-bottom: 1px solid var(--auvrynt-border-soft); } .brand { padding: 0; } .brand-version, .rail-label, .agent-presence, .rail-meta { display: none; } .dashboard-nav { display: flex; justify-content: center; gap: 4px; } .nav-tab { grid-template-columns: 24px auto; width: auto; min-height: 38px; padding: 6px 10px; } .nav-count { display: none; } .lifecycle { grid-template-columns: auto auto; padding: 0; border: 0; } .lifecycle .button { min-height: 36px; } .rail-spacer { display: none; } .workspace { --workspace-gutter: 22px; } .workspace-header { top: 63px; } .operations-grid, .analytics-lower, .secrets-layout { grid-template-columns: 1fr; } .logs-toolbar { grid-template-columns: minmax(0, 1fr) minmax(160px, 1fr) auto; gap: 10px; } }

.skills-toolbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.skills-meta-surface { margin-bottom: 18px; }
.skills-meta { display: grid; }
.skills-span { grid-column: 1 / -1; width: 100%; }
.skill-list { display: grid; gap: 0; width: 100%; }
.skill-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; padding: 8px 0; border-top: 1px solid rgba(216,180,254,.10); }
.skill-row:first-child { border-top: 0; }
.skill-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-name strong { font-size: 14px; font-weight: 600; }
.skill-meta-line { grid-column: 1 / -1; display: grid; gap: 4px; }
.skill-path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--auvrynt-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-access { font-size: 12px; color: var(--auvrynt-muted); line-height: 1.4; }
@media (max-width: 680px) { .control-rail { grid-template-columns: 1fr auto; gap: 10px; } .dashboard-nav { grid-column: 1 / -1; grid-row: 2; justify-content: stretch; overflow-x: auto; padding-top: 10px; } .nav-tab { flex: 1 0 auto; justify-content: center; } .brand-name { font-size: 15px; } .brand img { width: 34px; height: 34px; } .lifecycle .button { width: 36px; padding: 0; font-size: 0; } .lifecycle .button::after { font-size: 13px; } #restart::after { content: "↻"; } #stop::after { content: "■"; } .workspace { --workspace-gutter: 14px; padding-bottom: 32px; } .workspace-header { position: static; min-height: 0; padding-block: 24px 18px; } .server-state { display: none; } .tunnel-alert { grid-template-columns: auto minmax(0, 1fr); } .tunnel-alert .button { grid-column: 1 / -1; } .page-title { font-size: 30px; } .analytics-lead { gap: 12px; } .activity-surface { grid-template-columns: 1fr; min-height: 0; } .activity-copy { padding: 22px; } .change-surface { display: block; padding: 20px; } .code-delta { margin: 24px 0 20px; } .file-delta { padding-top: 16px; padding-left: 0; border-top: 1px solid var(--auvrynt-border-soft); border-left: 0; } .runtime-strip { grid-template-columns: repeat(2, 1fr); } .runtime-metric:nth-child(3), .runtime-metric:nth-child(5) { border-left: 0; } .runtime-metric:nth-child(3), .runtime-metric:nth-child(4), .runtime-metric:nth-child(5) { border-top: 1px solid var(--auvrynt-border-soft); } .section-surface { padding: 18px 0; } .section-head { padding-inline: 2px; } .connection-row { grid-template-columns: 76px minmax(0, 1fr) 32px; } .session-limit-form { grid-template-columns: minmax(0, 1fr) 48px 34px; padding: 10px 0; } .integration-row { grid-template-columns: minmax(0, 1fr) auto auto auto; grid-template-rows: auto auto; padding: 9px 0; } .integration-row .state { grid-column: 1; grid-row: 2; } .integration-toggle { grid-column: 4; grid-row: 1 / span 2; } .tools-toolbar { flex-wrap: wrap; } .tools-layout { grid-template-columns: 1fr; } .tool-row { grid-template-columns: auto minmax(0, 1fr); } .tools-summary { padding-inline: 0; } .secret-input-row { grid-template-columns: 1fr; } .token-row { grid-template-columns: minmax(0, 1fr) auto; padding: 9px 0; } .token-actions { grid-column: 1 / -1; } .analytics-lower { margin-top: 18px; } .view-toolbar { align-items: stretch; flex-direction: column; } .logs-toolbar { grid-template-columns: minmax(0, auto) minmax(140px, 1fr) auto; gap: 6px; } .log-filter-row { overflow-x: auto; padding-bottom: 2px; } .toolbar-actions { justify-content: flex-start; } .search { width: 100%; } .filter { flex: 0 0 auto; padding-inline: 8px; } .logs { height: 62vh; min-height: 360px; } .log-row { grid-template-columns: 68px 46px minmax(0, 1fr); } .log-fields { grid-column: 1 / -1; } .commands { grid-template-columns: 1fr; } .command-row { grid-template-columns: 1fr auto; gap: 4px 10px; } .command-row span { grid-column: 1 / -1; } }
@media (max-width: 680px) { .session-idle-timeout-form { grid-template-columns: minmax(0, 1fr) 48px auto 34px; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  .button[aria-busy="true"]::before,
  .icon-button[aria-busy="true"]::after { animation: button-spin .72s linear infinite !important; }
  .lifecycle-spinner { animation: button-spin 1.15s linear infinite !important; }
  .lifecycle-spinner::after { animation: button-spin 1.6s linear infinite reverse !important; }
  .lifecycle-progress::before { animation: lifecycle-scan 1.8s ease-in-out infinite !important; }
}
`;
