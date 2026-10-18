---
name: astra-krita-agent
description: Safe, no-plugin Krita observation and editing through Auvrynt's target-only desktop tools, calibrated canvas coordinates, verified UI targets, owned-dialog recovery, visual checks, checkpoints, and bounded transactions. Use when working on Krita drawings, layers, brushes, colors, selections, transforms, saves, exports, or recovery.
---

# Astra Krita Agent

Use this skill to treat Krita as a controlled creative application rather than a generic mouse target. The integration never installs or calls a Krita plugin, executes arbitrary Krita code, captures the whole desktop, or sends input to an unverified window.

## Editing loop

1. Inspect `krita_status`, `krita_readiness_report`, and `krita_get_state`.
2. Confirm the process/title/handle is Krita and the window is visible and not minimized. A covered window is acceptable for read-only capture when the strict application-window renderer reports `occlusionSafe`.
3. Run `krita_auto_calibrate_canvas` when calibration is missing or stale. Check `valid=true` before using normalized canvas coordinates.
4. Refresh and inspect verified UI targets before using toolbar, color, brush-preset, layer-docker, or dialog controls. Never derive a control from a fixed pixel coordinate.
5. Choose the smallest deterministic action. Prefer validated shortcuts and bounded canvas input. Use `foreground-restore` for mutations when another application was active.
6. Capture or inspect the result. Update state as `visually_verified` only after evidence; otherwise mark affected fields `unknown` and report recovery.
7. Create a checkpoint when a reversible milestone is requested. Compare with `krita_compare_canvas` to answer whether anything changed and where.

## Shortcut readiness

- Call `krita_prepare_shortcuts` after startup. Persisted validation survives a normal Auvrynt restart only when the Krita executable/version, keyboard layout, binding keys, and schema fingerprint still match.
- `needs_probe` commands require `krita_probe_shortcut` with explicit reversible confirmation, visual inspection, then `krita_confirm_shortcuts` with the returned `probeId`.
- `krita_recommended_shortcuts` is advisory. Recommendations never change Krita preferences and are never treated as validated.

## Safe control rules

- Canvas actions require current verified calibration and normalized points in `[0,1]`.
- UI and dialog actions require a current Krita-owned target. Unknown or foreign popups fail closed.
- Exact brush size/color and approved preset operations must return observed values with `visually_verified` confidence. An input event without post-capture evidence is `unknown`, not success.
- Layer rename/pick/reorder/visibility/lock and constrained transform operations must preserve the same evidence rule. Semantic layer identity is never inferred from an icon alone.
- Save, Save As, export, and overwrite decisions return explicit recovery states until the dialog/document state is visually confirmed.
- Read-only inspection should not focus Krita. Mutations may use `foreground` or `foreground-restore`; `background` is invalid.

## Transaction pattern

For multi-step work use `krita_execute_transaction` with only the allowlisted steps:

`check_window`, `check_dialogs`, `ensure_calibration_if_needed`, `foreground_restore`, `execute`, `capture_result`, `verify`.

Supply an allowlisted operation (`capture`, `save`, `undo`, `redo`, `create_layer`, `delete_layer`, or `duplicate_layer`). Stop on the first failed step and use `recoveryRequired`, `failedStep`, and confidence metadata to decide the next inspection.

## Never do

- Never use whole-desktop screenshots or coordinates outside a verified Krita target.
- Never focus or raise Krita for read-only observation.
- Never assume a shortcut, brush, color, layer, save, export, or transform succeeded because a key/click was sent.
- Never retry a mutation automatically; inspect the returned state first.
- Never continue after stale calibration, unknown popup ownership, failed target verification, or an emergency stop.
