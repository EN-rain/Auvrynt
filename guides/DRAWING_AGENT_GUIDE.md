# Astra Drawing Agent Guide

Use this guide for Krita drawing and artwork review through Auvrynt.

## Start the safe Krita profile

```powershell
auvrynt start krita --replace
```

The canonical repository skill path is persisted in `C:\Users\LENOVO\.auvrynt\config.json`. Set `AUVRYNT_SKILL_PATHS` only when testing a different skill directory.

Use `desktop` only when generic display/window capture or generic desktop input is explicitly needed:

```powershell
$env:AUVRYNT_OAUTH_SCOPES = 'auvrynt:read,auvrynt:write,auvrynt:process,auvrynt:krita,auvrynt:desktop'
auvrynt start desktop,krita --replace
```

The generic desktop scope is opt-in because display capture can expose unrelated applications. The Krita-specific tools are constrained to the visible, non-minimized `krita.exe` target window. They do not require fullscreen or foreground placement: read-only target-window capture can inspect Krita while it is covered, reports occlusion metadata, and fails closed rather than sampling another application's pixels. Window movement, resize, display, or DPI changes trigger bounded recalibration instead of assuming fixed screen coordinates.

## Required web-agent order

1. Open the workspace and keep the returned `workspaceId`.
2. Call `krita_web_agent_signal({ workspaceId })` first.
3. Run the returned safe-smoke tools in order. `krita_auto_calibrate_canvas` may update only local calibration metadata; it never mutates Krita or sends canvas input.
4. If Krita is minimized, restore it manually; a covered but non-minimized Krita window may be observed without being raised.
5. Let `krita_auto_calibrate_canvas` capture only the Krita window, detect a high-confidence `{ x, y, width, height }` rectangle relative to that window, perform visual confirmation, and run `krita_check_calibration`. If detection fails closed, use `krita_calibrate_canvas` only with a reviewed rectangle supplied by the user.
6. Run `krita_check_calibration` again before `krita_get_canvas` or any click/stroke. Read-only calls never focus Krita or its popups; input uses foreground interaction and may request `focusPolicy: "foreground-restore"` to return focus afterward.
7. Never execute a confirmation-required app or canvas-input tool without the user's explicit confirmation.

The implementation is intentionally no-plugin. Do not install, import, register, probe, or depend on a Krita plugin, PyKrita script, loopback bridge, or arbitrary Krita-side code.

Use `krita_list_actions` or `krita_search_actions` before selecting an operation. Use `krita_get_canvas` for artwork review after calibration. Layer creation/deletion, export, fill, selection, and bounded batches use validated shortcuts and calibrated input. Named-layer lookup, brush preset/size/color setting, and selection transforms return a fail-closed no-plugin limitation until a verified UI target exists; do not substitute guessed coordinates. Use expected-state tools for values that cannot be queried authoritatively without a plugin, and label those values as expected or visually verified rather than claiming them as live Krita state.

## Scope of this guide

Krita's no-plugin desktop path and deterministic action catalog are implemented and testable. CSP workspace/shortcut conventions are documented in `skills/clip-studio-agent/SKILL.md`, but CSP-specific MCP tools are not exposed by this build yet.
