---
name: drawing-agent-core
description: Shared support workflow for drawing-app control: deterministic commands, calibration, expected-state confidence, and visual review. Load alongside an app-specific drawing skill such as Krita or CSP, or use directly only when no app-specific skill exists.
---

# Drawing Agent Core

Use deterministic operations for software control and vision for artistic judgment.

Do not assume a drawing application exposes semantic runtime state. When state cannot be queried reliably, track what the agent established and label it as expected rather than authoritative.

## Tool Selection Priority

For every operation, use the first safe option available:

1. known deterministic command or validated keyboard shortcut
2. known trusted macro / Auto Action
3. stable calibrated UI target
4. direct calibrated canvas mouse/stylus input
5. arbitrary GUI searching only as a last resort

Do not add or depend on an application plugin merely to make routine drawing control easier unless the user explicitly requests a plugin architecture.

Do not repeatedly search the full UI for a control whose shortcut, macro, or calibrated position is already known.

## Application State Confidence

Every tracked state value should be one of:

- `known`: local metadata that is directly known by Auvrynt
- `expected`: a value the agent believes it established through a deterministic action
- `visually_verified`: an expected value confirmed with a calibrated UI crop
- `unknown`: not safely known

`expected` is not the same as application truth. Never report an expected value as authoritative without its confidence label.

If the user changes the application, a dialog interrupts an action, or geometry becomes uncertain, mark affected state unknown and recover before continuing.

## Vision Use

Use vision for artistic decisions such as:

- anatomy and proportion
- silhouette
- composition
- values and color balance
- shadow/highlight placement
- local shape correctness
- reference comparison

Use small calibrated UI crops only when software state must be visually confirmed, for example a layer row, brush-size field, or color indicator.

Use full-window/full-screen capture primarily for locating the app, calibration, recovery, or unexpected dialogs.

## Drawing Workflow

Unless the task requires another order:

1. analyze references
2. block large shapes
3. review globally
4. add flats
5. review globally
6. add shadows
7. add highlights
8. add detail
9. perform final global review

Fix structure before detail. Prioritize composition, proportions, silhouette, face placement, missing large regions, values/colors, shadows, then small details.

## Observation Budget

Default loop:

1. check target window and calibration validity
2. inspect the expected-state model only for software values that matter
3. batch deterministic shortcut/macro actions when safe
4. capture the calibrated canvas
5. make an organic canvas edit only when needed
6. capture again after a meaningful change
7. evaluate and continue

Do not consume continuous desktop frames when nothing changed.

## Coordinates and Calibration

Plan canvas actions in normalized coordinates:

- `0.0 <= x <= 1.0`
- `0.0 <= y <= 1.0`

Convert normalized canvas coordinates through the current calibration into display-relative coordinates immediately before input.

Treat calibration as stale when window position/size, display, DPI/scale, workspace layout, canvas zoom/pan/rotation, or mirror assumptions change. Recalibrate rather than guessing.

## Safety and Editability

- Preserve editable layers unless flattening is explicitly requested.
- Prefer reversible actions and small action groups.
- Save only when the target document and resulting dialog state are understood.
- Do not silently enable unrestricted desktop control through a normal web/browser profile.
- Keep desktop input bounded to the intended display/window.
- Treat unexpected dialogs and unknown windows as recovery states.
- Stop desktop input if the target app or calibrated canvas can no longer be confirmed.
