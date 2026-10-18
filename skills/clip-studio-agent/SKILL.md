---
name: clip-studio-agent
description: Experimental Clip Studio Paint workflow conventions for a future Auvrynt CSP integration. Use as design/reference guidance only when explicitly working on CSP integration; current builds may not expose csp_* MCP tools.
---

# Clip Studio Paint Agent

> **Current implementation status:** reference/experimental. The present Auvrynt build may not expose `csp_*` MCP tools. Do not invent those tools or claim this workflow is executable unless the live tool inventory confirms them.

Read `drawing-agent-core` first when available.

CSP does not have the same rich semantic Python bridge used for Krita, so the intended reliability model uses a fixed workspace, stable shortcuts, safe Auto Actions, and calibrated canvas geometry.

## Workspace Contract

Use the registered workspace named:

`Auvrynt Astra Drawing`

Keep these areas stable:

- Canvas
- Layers
- Quick Access
- Color
- Tool Property
- Sub View / reference
- Auto Actions

Do not rearrange the workspace while drawing. If layout damage is detected, restore the registered Auvrynt workspace before continuing.

## Shortcut Contract

Default Auvrynt shortcut scheme:

- `Ctrl+Alt+1` — ink brush
- `Ctrl+Alt+2` — paint brush
- `Ctrl+Alt+3` — soft shade
- `Ctrl+Alt+4` — eraser
- `Ctrl+Alt+5` — fill
- `Ctrl+Alt+Shift+1` — new raster layer
- `Ctrl+Alt+Shift+2` — create shadow layer Auto Action
- `Ctrl+Alt+Shift+3` — create highlight layer Auto Action
- `Ctrl+Alt+Shift+4` — clip current layer to below Auto Action

Use Auvrynt CSP semantic wrappers for these shortcuts instead of manually pressing keys when a wrapper exists.

## Auvrynt Auto Actions

Known-safe actions should be recorded in CSP and assigned stable shortcuts:

- `AUVRYNT_CREATE_LINEART_STRUCTURE`
- `AUVRYNT_CREATE_COLOR_STRUCTURE`
- `AUVRYNT_CREATE_SHADOW_LAYER`
- `AUVRYNT_CREATE_HIGHLIGHT_LAYER`
- `AUVRYNT_CLIP_CURRENT_LAYER`
- `AUVRYNT_FLATTEN_COPY`
- `AUVRYNT_EXPORT_PREVIEW`
- `AUVRYNT_RESET_DRAWING_STATE`

Do not assume arbitrary downloaded community Auto Actions are safe. Use community actions only as references for recreating known Auvrynt-specific actions.

## Calibration

Before normal work:

1. detect the CSP window
2. restore the Auvrynt workspace if required
3. calibrate the canvas rectangle
4. confirm stable workspace anchors
5. use canvas-only capture for artwork review

The important calibration target is the canvas, not every toolbar control.

Recalibrate after window movement/resizing, display or DPI changes, or any workspace/layout change.

## Normal Loop

Use this loop only when the live Auvrynt tool inventory confirms the required CSP wrappers exist. Otherwise treat it as future integration design guidance and do not invent `csp_*` calls.

1. call `csp_get_state` when available
2. invoke known tool/layer/action wrappers
3. capture the calibrated canvas
4. judge the artwork visually
5. use desktop input for organic strokes only
6. capture the canvas again after meaningful visual changes

Vision should answer "where should I draw?" rather than "where is the brush button?"

## Failure Recovery

If a known shortcut does not produce the expected state:

1. stop issuing additional drawing input
2. capture the app/window for recovery
3. verify the Auvrynt workspace is active
4. restore workspace/shortcuts if necessary
5. recalibrate canvas geometry
6. resume with known semantic wrappers

Do not visually search through arbitrary menus unless the fixed shortcut/Auto Action path is unavailable and recovery has confirmed the current UI state.
