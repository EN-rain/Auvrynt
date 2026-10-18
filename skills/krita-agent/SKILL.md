---
name: krita-agent
description: Operate Krita through Auvrynt without a Krita plugin, using validated shortcuts, calibrated desktop input, expected-state tracking, and canvas-only visual review.
---

# Krita Agent — No Plugin

Read `drawing-agent-core` first when available.

Do not install, enable, require, probe for, or depend on a Krita Python plugin, pykrita extension, Krita-local HTTP server, loopback bridge, or arbitrary Python execution inside Krita.

## Default Routing

Use this order:

1. validated Krita shortcut command
2. trusted configured macro or stable workspace action
3. calibrated stable UI target
4. normalized direct canvas input
5. arbitrary GUI searching only for recovery or one-time calibration

The active no-plugin tools include:

- `krita_web_agent_signal`
- `krita_status`
- `krita_get_state`
- `krita_list_actions`
- `krita_search_actions`
- `krita_get_canvas_info`
- `krita_auto_calibrate_canvas`
- `krita_calibrate_canvas`
- `krita_get_calibration`
- `krita_check_calibration`
- `krita_clear_calibration`
- `krita_confirm_calibration`
- `krita_get_canvas`
- `krita_get_shortcuts`
- `krita_set_shortcut`
- `krita_reset_shortcut`
- `krita_confirm_shortcuts`
- `krita_unvalidate_shortcuts`
- `krita_command`
- `krita_trigger_action`
- `krita_create_layer`
- `krita_select_layer`
- `krita_set_layer`
- `krita_delete_layer`
- `krita_set_brush`
- `krita_set_brush_size`
- `krita_set_color`
- `krita_export`
- `krita_fill`
- `krita_select`
- `krita_transform_selection`
- `krita_batch`
- `krita_undo`
- `krita_redo`
- `krita_save`
- `krita_set_expected_state`
- `krita_mark_state_unknown`
- `krita_confirm_state`
- `krita_reset_expected_state`
- `krita_canvas_click`
- `krita_stroke`
- `krita_path_stroke`
- `krita_pan`
- `krita_zoom_in`
- `krita_zoom_out`
- `krita_fit_canvas`

The action catalog is deterministic and no-plugin: `krita_list_actions` and `krita_search_actions` expose supported shortcut-backed operations and explicit unsupported reasons. `krita_trigger_action` and the layer/export/fill/selection/batch tools require configured, live-validated shortcuts and calibrated input where applicable.

Named-layer and brush-preset selection are conditionally supported only when the verified Layers/Brush Presets docker exposes one exact visible UI Automation match and the selected state can be confirmed after input. Brush-size and foreground-color editing require verified control targets and exact post-input verification. Selection transforms remain fail-closed when exact controls are unavailable. None of these paths guess coordinates or invoke Krita-side code.

## Web-Agent Try-All Signal

Call `krita_web_agent_signal` once with the current `workspaceId` before trying the Krita action inventory. It returns the `auvrynt.krita.web-agent/v1` signal with:

- the complete no-plugin action manifest
- an ordered safe-smoke sequence; automatic calibration changes only local geometry metadata and never Krita
- preconditions for calibration, shortcut validation, state review, and canvas input
- the explicit-confirmation list for shortcuts, undo/redo, save, state changes, clicks, and strokes

The signal is an inventory and execution contract; it does not execute the listed actions. Run safe-smoke tools in order, including automatic calibration, and report failures without guessing. Never automatically execute the explicit-confirmation list. The web-agent trigger is:

```text
krita_web_agent_signal({ workspaceId: "<workspace id from open_workspace>" })
```

The transport is Auvrynt's calibrated desktop capture/input path. It does not require Krita to be fullscreen, maximized, or in front. Read-only status, calibration, and canvas capture use a target-only Krita window renderer and may inspect a visible, non-minimized Krita window while another application covers it. The status result reports `occluded` and meaningful foreign windows for diagnostics; it never substitutes desktop pixels. Do not substitute a Krita plugin, Krita-local HTTP server, loopback bridge, or arbitrary code execution.

## Shortcut Discipline

A configured shortcut is not automatically trusted. `krita_command` refuses missing or unvalidated bindings.

For a new installation or changed shortcut profile:

1. inspect `krita_get_shortcuts` and `krita_list_actions`
2. test the required binding against live Krita using a reversible/manual probe
3. verify the result visually or from an unmistakable dialog/state change
4. record that check with `krita_confirm_shortcuts`
5. use the command autonomously only after validation

If Krita preferences change, mark affected bindings unvalidated and test them again.

## Expected State

Without a plugin, exact active layer, brush preset, brush size, foreground color, zoom, pan, rotation, and other values may not be queryable reliably.

Use the expected-state model:

- record values the agent intentionally establishes as `expected`
- confirm a value with a small calibrated UI crop before marking it `visually_verified`
- mark affected fields `unknown` after an uncertain action, user intervention, or unexpected dialog
- never describe `expected` values as authoritative application state

If a value matters and cannot be verified cheaply, restore a known deterministic state instead of guessing.

## Calibration

Before direct canvas input:

1. locate the live Krita window with `krita_status`
2. call `krita_auto_calibrate_canvas`; it captures only the Krita window, detects a high-confidence `{ x, y, width, height }` rectangle relative to that window, performs visual confirmation, and runs the geometry check
3. call `krita_check_calibration` immediately before canvas capture or normalized input after any geometry change
4. if automatic detection fails closed, obtain a reviewed rectangle from the user, call `krita_calibrate_canvas`, visually check it, call `krita_confirm_calibration`, and then call `krita_check_calibration`

The geometry is relative to the current Krita window, so a fullscreen layout is not required. Recalibrate after window movement/resizing, display or DPI changes, workspace/layout changes, or any canvas/view change that invalidates the screen mapping. Canvas actions also attempt a bounded automatic refresh when the stored geometry reports a display or window change; if refresh cannot produce trustworthy target-only pixels, they fail closed.

The calibration is fail-closed: stale geometry must not be used for drawing.

## Canvas Review

Use `krita_get_canvas` for normal artwork review. It captures only the calibrated canvas and supports normalized subregions for detail inspection.

Do not use full-desktop capture. The implementation captures the target Krita window only; a full-window Krita capture is used only to locate the canvas during calibration or recover from a Krita dialog/layout issue:

- locate Krita
- find the canvas during calibration
- recover from dialogs
- recover from workspace/layout damage

Do not repeatedly send the entire desktop just to judge the artwork. If Krita is covered but not minimized, continue only when the target-only renderer returns a trustworthy frame; otherwise report the fail-closed reason.

## Canvas Input

Read-only observation never changes focus. Input is an explicit Windows foreground interaction because background `SendInput` is not a reliable or honest contract. Use the optional `focusPolicy: "foreground-restore"` when an explicit action should return focus to the previously active window after completion; never claim that canvas input occurred in the background.

Plan points in normalized canvas coordinates.

`krita_canvas_click` is suitable for a bounded point action. `krita_stroke` represents one straight bounded stroke; `krita_path_stroke` accepts 2–512 normalized points for curve-like paths.

The path primitive is still a sequence of bounded desktop segments, not pressure-sensitive stylus input. Stop rather than guessing when pressure or continuous stylus semantics matter.

## Layers, Brush, Color, and Tool State

Prefer a validated shortcut or a stable calibrated UI target.

For controls without a reliable shortcut:

1. use the fixed Auvrynt Krita workspace layout
2. capture only the relevant docker/control area
3. operate the calibrated target
4. update expected state
5. visually verify only when the exact value matters

Do not visually rediscover the Layers docker, brush controls, or color controls on every operation.

Preserve editable layers and use clear layer names when interacting through the UI.

## Recovery

If `krita_status` cannot find Krita, stop input and ask the user to open/restore the application or fix the desktop session. A covered-but-not-minimized window is not itself a failure; rely on the returned `occluded` flag and target-only capture result. Do not fall back to a plugin.

If a shortcut opens an unexpected dialog:

1. stop further drawing input
2. inspect the bounded Krita window/dialog
3. resolve or cancel the dialog deterministically
4. mark affected expected-state fields unknown
5. re-check calibration and shortcut validity as needed

If the window, canvas, or target control cannot be confirmed, do not continue sending coordinates.
