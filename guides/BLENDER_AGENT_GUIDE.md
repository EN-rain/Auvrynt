# BLENDER_AGENT_GUIDE.md

## Scope

This guide applies to 3D modeling, asset creation, material configuration, rigging, animation, rendering, optimization, and exporting tasks using Blender.

Load this guide when `.blend` files or `bpy` python scripts are present, or when the task involves editing, optimizing, rendering, or validating 3D game/web assets.

---

## ⚡ Quick Start for Web Agents

> **If Blender tools are not responding, the local server may not be running.**
> The user must run: `auvrynt start blender`

Do not assume a fixed public MCP URL. Use the MCP connection already provided by the current host. If connection diagnostics are needed, use the current Auvrynt connection/profile status or managed-instance information rather than a historical tunnel/domain.

### First thing: ping the current workspace

```json
// Tool: blender_ping
{ "workspaceId": "<workspaceId returned by open_workspace>" }
```

Never invent or reuse a placeholder workspace ID.

If `blender_ping` fails, do not mutate Blender. Use the returned error plus current Auvrynt connection/profile status to distinguish Blender not running, Blender profile disabled, stale connector/tool inventory, workspace/session errors, or a bridge/socket failure. Report the narrowest supported diagnosis and ask the user to act only when the remaining blocker actually requires user-side intervention.
If it succeeds → proceed.

---

## 🔑 Executing Custom Python: `blender_execute_python`

The registered catalog and dedicated tools are executable operations. For any operation not exposed by the registry, use:

```json
{
  "workspaceId": "<workspaceId returned by open_workspace>",
  "code": "import bpy\nresult = {'active': bpy.context.active_object.name}"
}
```

**Security model:** `blender_execute_python` is a privileged host-level escape hatch. It requires both `auvrynt:blender` and the explicit `auvrynt:blender-python` scope; the latter is intentionally excluded from the default OAuth scope set. The supplied Python runs inside the local Blender process and is not a strong sandbox.

**Rules:**
- Always end your script with `result = { ... }` — that is what gets returned.
- Prefer dedicated Blender tools whenever they cover the operation.
- Use standard Blender APIs (`bpy`, `bmesh`, `mathutils`) for modeling work.
- Do not call `os.system()`, `subprocess`, process-launch APIs, or network/socket APIs. These are behavioral restrictions for trusted agents, not a claimed technical sandbox.
- Keep scripts short and targeted — one operation per call.
- Inspect Blender state after a mutation before claiming success.

If a registered tool returns an error, treat the operation as failed and do not claim that Blender changed. Verify successful mutations with an inspection tool. A successful `blender_execute_python` call must set an explicit `result` value when the caller needs structured output.

---

## 🚨 Decision Tree

```
Need to do something in Blender?
  ├─ Is there a dedicated tool in the lists below?
  │     └─ Use it directly ✅
  └─ Need custom logic, inspection, or anything not listed?
        └─ blender_execute_python ✅

Not sure if Blender is connected?
  └─ blender_ping first. If it fails, inspect the current Auvrynt connection/profile status and report the supported blocker; do not assume the cause ✅
```

---

## 🛠️ Complete Tool Reference

### Tool Tiers at a Glance

| Tier | Count | Status |
|---|---|---|
| Handwritten implementations | ~108 | Executable dedicated operations |
| Catalog implementations | ~120 | Executable grouped operations |
| Unimplemented operations | Not registered | Use `blender_execute_python` when appropriate |

---

### 📡 Connection & Status

| Tool | What it does |
|---|---|
| `blender_ping` | Check if Blender MCP socket is alive |
| `blender_get_active_mode_and_status` | Get current mode (OBJECT/EDIT/SCULPT etc.) |

---

### 🔍 Scene Inspection

| Tool | What it does |
|---|---|
| `blender_get_scene_info` | Full scene summary: objects, materials, cameras, lights, frame |
| `blender_get_scene_audit` | Mesh stats, non-manifold, duplicates, textures |
| `blender_get_selection` | Currently selected/active objects |
| `blender_inspect_object` | Detailed object info: verts, polys, materials, modifiers |
| `blender_inspect_material` | Material node tree details |
| `blender_inspect_geometry_nodes` | Geometry node group details |
| `blender_get_current_file` | Active `.blend` file path |
| `blender_get_scene_hierarchy` | Scene collection/object hierarchy tree |
| `blender_get_scene_statistics` | Poly/vert/object counts |
| `blender_get_unsaved_changes_status` | Whether there are unsaved changes |
| `blender_get_recent_operator_log` | Last executed operators |

---

### ➕ Create Objects

| Tool | Key Params | What it does |
|---|---|---|
| `blender_create_cube` | `name, size, location` | Add a cube mesh |
| `blender_create_plane` | `name, size, location` | Add a plane mesh |
| `blender_create_circle` | `vertices, radius, fillType, location` | Add a circle |
| `blender_create_cylinder` | `vertices, radius, depth, location` | Add a cylinder |
| `blender_create_cone` | `vertices, radius1, radius2, depth, location` | Add a cone |
| `blender_create_sphere` | `segments, ringCount, radius, location` | Add a UV sphere |
| `blender_create_icosphere` | `subdivisions, radius, location` | Add an icosphere |
| `blender_create_torus` | `majorRadius, minorRadius, location` | Add a torus |
| `blender_create_grid` | `xSegments, ySegments, size, location` | Add a grid mesh |
| `blender_create_monkey` | `size, location` | Add Suzanne (Blender mascot) |
| `blender_create_camera` | `name, location, rotation, lens` | Add a camera |
| `blender_create_light` | `name, lightType, energy, color, location` | Add a light (POINT/SUN/SPOT/AREA) |
| `blender_create_empty` | `name, emptyType, location` | Add an empty object |
| `blender_create_text` | `name, content, size, location` | Add a 3D text object |
| `blender_create_curve` | `name, location` | Add a Bezier curve |
| `blender_create_armature` | `name, location` | Add an armature with one bone |
| `blender_create_metaball` | `name, radius, location` | Add a metaball |

---

### 🎯 Selection (Object Mode)

| Tool | Key Params | What it does |
|---|---|---|
| `blender_select_object` | `objectName` | Select one object |
| `blender_select_objects` | `objectNames, addToSelection` | Select multiple objects |
| `blender_select_all` | — | Select everything |
| `blender_deselect_all` | — | Clear selection |
| `blender_invert_selection` | — | Invert selection |
| `blender_select_by_type` | `objectType` | Select by type (MESH/CURVE/CAMERA...) |
| `blender_select_linked` | `objectName` | Select objects sharing same data |
| `blender_select_by_collection` | `collectionName` | Select all in a collection |
| `blender_select_by_material` | `materialName` | Select all using a material |
| `blender_select_by_polycount` | `minTriangles, maxTriangles` | Select by poly range |
| `blender_select_by_wildcard` | `pattern` | Select by name pattern |
| `blender_select_by_property` | `property, value` | Select by object property |
| `blender_select_hierarchy` | `objectName` | Select object + all descendants |
| `blender_select_visible` | — | Select only visible objects |

---

### 🎯 Selection (Edit Mode — Sub-element)

| Tool | What it does |
|---|---|
| `blender_select_vertices` | Select vertices by condition |
| `blender_select_edges` | Select all edges |
| `blender_select_faces` | Select all faces |
| `blender_select_edge_loops` | Select edge loops from selection |
| `blender_select_edge_rings` | Select edge rings from selection |
| `blender_select_boundary` | Select boundary edges |
| `blender_select_sharp_edges` | Select edges above angle threshold |
| `blender_select_non_manifold` | Select non-manifold geometry |
| `blender_select_loose_geometry` | Select unconnected verts/edges |
| `blender_select_similar` | Select similar geometry |
| `blender_select_by_normal` | Select faces by normal direction |
| `blender_select_by_material_slot` | Select faces by material slot index |
| `blender_select_by_face_area` | Select faces by area range |
| `blender_select_linked_geometry` | Select connected geometry |

---

### 🔄 Object Transforms & Operations

| Tool | Key Params | What it does |
|---|---|---|
| `blender_transform_object` | `objectName, location, rotation, scale` | Move/rotate/scale |
| `blender_move_object` | `objectName, offset` | Relative move |
| `blender_rotate_object` | `objectName, rotation` | Relative rotate (degrees) |
| `blender_scale_object` | `objectName, factor` | Scale by factor |
| `blender_apply_transforms` | `objectNames, location, rotation, scale` | Apply transforms to mesh |
| `blender_clear_transforms` | `objectNames, location, rotation, scale` | Reset transforms |
| `blender_mirror_objects` | `objectNames, axis` | Mirror along axis |
| `blender_set_origin` | `objectNames, origin, location` | Move object origin |
| `blender_set_origin_to_geometry` | `objectName` | Origin → geometry center |
| `blender_set_origin_to_cursor` | `objectName` | Origin → 3D cursor |
| `blender_set_cursor_location` | `location` | Move 3D cursor |
| `blender_align_objects` | `axis` | Align objects by axis |
| `blender_distribute_objects` | `axis, spacing` | Evenly space objects |
| `blender_randomize_transforms` | `objectNames` | Randomize transforms |
| `blender_snap_objects_to_grid` | `objectNames, gridSize` | Snap to grid |
| `blender_snap_objects_to_surface` | `objectNames` | Snap down to surface below |
| `blender_freeze_transforms` | `objectNames` | Apply all transforms |
| `blender_normalize_asset_scale` | `objectName, targetSize` | Normalize to unit scale |
| `blender_validate_scale` | `objectName` | Check for uniform scale |

---

### 🗂️ Object Management

| Tool | Key Params | What it does |
|---|---|---|
| `blender_rename_object` | `objectName, newName` | Rename one object |
| `blender_rename_objects` | `objectNames` | Rename multiple (with pattern) |
| `blender_duplicate_object` | `objectNames, duplicateType, offset` | Duplicate |
| `blender_duplicate_linked` | `objectName` | Linked duplicate (shared mesh) |
| `blender_delete_objects` | `objectNames` | Delete objects |
| `blender_parent_object` | `childNames, parentName, keepTransform` | Parent objects |
| `blender_unparent_object` | `objectNames, keepTransform` | Unparent |
| `blender_hide_objects` | `objectNames, hide` | Hide/unhide |
| `blender_show_all_objects` | — | Show everything |
| `blender_set_object_visibility` | `objectNames` | Set viewport/render visibility |
| `blender_join_objects` | `objectNames` | Join into one mesh |
| `blender_separate_object` | `objectName` | Separate loose parts |
| `blender_make_single_user` | `objectNames` | Unlink shared data |
| `blender_make_instances` | `objectNames` | Convert to instances |
| `blender_create_collection` | `name` | Create a collection |
| `blender_move_to_collection` | `objectNames, collectionName` | Move into collection |
| `blender_link_to_collection` | `objectNames, collectionName` | Link to collection |
| `blender_purge_unused_data` | — | Remove orphaned data blocks |
| `blender_set_custom_property` | `objectName, key, value` | Set custom prop |
| `blender_remove_custom_property` | `objectName, key` | Remove custom prop |
| `blender_measure_distance` | `object1, object2` | Distance between objects |
| `blender_measure_area` | `objectName` | Surface area of mesh |
| `blender_measure_volume` | `objectName` | Volume of closed mesh |

---

### ✏️ Edit Mode — Mesh Editing

Enter edit mode first: `blender_enter_edit_mode` → do edits → `blender_exit_edit_mode`

| Tool | Key Params | What it does |
|---|---|---|
| `blender_enter_edit_mode` | `objectName` | Enter edit mode |
| `blender_exit_edit_mode` | — | Return to object mode |
| `blender_set_mesh_selection_mode` | `mode` (VERT/EDGE/FACE) | Set sub-element mode |
| `blender_extrude_selection` | `objectName, amount` | Extrude selected |
| `blender_extrude_vertices` | `objectName, vector` | Extrude verts along vector |
| `blender_extrude_edges` | `objectName, vector` | Extrude edges |
| `blender_extrude_faces` | `objectName, vector` | Extrude faces |
| `blender_extrude_along_normals` | `objectName, amount` | Extrude along normals |
| `blender_bevel_selection` | `objectName, amount, segments` | Bevel selected |
| `blender_bevel_vertices` | `objectName, width, segments` | Bevel vertices |
| `blender_loop_cut` | `objectName, cuts` | Add loop cut |
| `blender_subdivide` | `objectName, cuts, smooth` | Subdivide faces |
| `blender_inset_faces` | `objectName, thickness, depth` | Inset faces |
| `blender_knife_cut` | `objectName, start, end` | Knife cut |
| `blender_bisect_mesh` | `objectName, plane` | Bisect mesh by plane |
| `blender_bridge_edge_loops` | `objectName` | Bridge between edge loops |
| `blender_fill_faces` | `objectName` | Fill selected boundary |
| `blender_fill_holes` | `objectName` | Fill boundary loops |
| `blender_grid_fill` | `objectName` | Grid fill between two loops |
| `blender_poke_faces` | `objectName` | Poke faces (center vert) |
| `blender_quadrangulate_faces` | `objectName` | Tris → quads |
| `blender_spin_geometry` | `objectName, angle, steps` | Spin around axis |
| `blender_screw_geometry` | `objectName, angle, steps` | Screw extrude |
| `blender_rip_vertices` | `objectName` | Rip vertices |
| `blender_split_edges` | `objectName` | Split selected edges |
| `blender_edge_slide` | `objectName, factor` | Slide edges |
| `blender_vertex_slide` | `objectName, factor` | Slide vertex |
| `blender_offset_edge_loop` | `objectName, offset` | Offset edge loop |
| `blender_shrink_fatten` | `objectName, amount` | Move along normals |
| `blender_merge_by_distance` | `objectName, distance` | Remove doubles |
| `blender_merge_vertices` | `objectName` | Merge at center/cursor |
| `blender_collapse_edges` | `objectName` | Collapse edges |
| `blender_dissolve_vertices` | `objectName` | Dissolve verts |
| `blender_dissolve_edges` | `objectName` | Dissolve edges |
| `blender_dissolve_faces` | `objectName` | Dissolve faces |
| `blender_limited_dissolve` | `objectName, angle` | Dissolve under angle |
| `blender_recalculate_normals` | `objectName` | Fix outward normals |
| `blender_flip_normals` | `objectName` | Flip all normals |
| `blender_triangulate_faces` | `objectName` | All faces → triangles |
| `blender_delete_loose_geometry` | `objectName` | Delete unconnected verts/edges |
| `blender_fix_non_manifold` | `objectName` | Select non-manifold geometry |
| `blender_set_face_smoothing` | `objectName, smooth` | Smooth/flat shading |
| `blender_mark_sharp` | `objectName` | Mark edges as sharp |
| `blender_clear_sharp` | `objectName` | Clear sharp edges |
| `blender_mark_seam` | `objectName` | Mark UV seams |
| `blender_clear_seam` | `objectName` | Clear UV seams |
| `blender_crease_edges` | `objectName, crease` | Set subdivision crease |
| `blender_remove_internal_faces` | `objectName` | Delete enclosed faces |
| `blender_remove_degenerate_geometry` | `objectName` | Delete degenerate geometry |
| `blender_snap_selection` | `objectName` | Snap geometry to target |
| `blender_delete_vertices` | `objectName` | Delete verts |
| `blender_delete_edges` | `objectName` | Delete edges |
| `blender_delete_faces` | `objectName` | Delete faces |

---

### 🔧 Modifiers

| Tool | Key Params | What it does |
|---|---|---|
| `blender_add_modifier` | `objectName, modifierType, name` | Add a modifier |
| `blender_remove_modifier` | `objectName, modifierName` | Remove a modifier |
| `blender_apply_modifier` | `objectName, modifierName` | Apply (bake) modifier |
| `blender_edit_modifier` | `objectName, modifierName, properties` | Change modifier settings |

> For specialized modifier config (subdivision, mirror, solidify, decimate, etc.) use `blender_execute_python`.

---

### 🎨 Materials & Shading

| Tool | Key Params | What it does |
|---|---|---|
| `blender_create_material` | `name, color, roughness, metallic` | Create Principled BSDF material |
| `blender_assign_material` | `objectNames, materialName` | Assign material to objects |
| `blender_list_materials` | — | List all materials |
| `blender_rename_material` | `materialName, newName` | Rename material |
| `blender_duplicate_material` | `materialName, newName` | Duplicate material |
| `blender_remove_unused_materials` | — | Delete orphaned materials |

> For node-level operations (create shader nodes, connect nodes, set values) use `blender_execute_python`.

---

### 🎬 Rendering

| Tool | Key Params | What it does |
|---|---|---|
| `blender_render_camera` | `cameraName, width, height, samples` | Render from camera |
| `blender_render_viewport` | `width, height` | Screenshot of Blender window |
| `blender_render_object_isolation` | `objectName, width, height` | Render one object isolated |
| `blender_set_render_settings` | `engine, width, height, samples, denoise` | Configure render settings |

---

### 🎞️ Animation

| Tool | Key Params | What it does |
|---|---|---|
| `blender_set_frame` | `frame` | Jump to a frame |
| `blender_play_animation` | — | Start playback |
| `blender_stop_animation` | — | Stop playback |
| `blender_insert_keyframe` | `objectName, properties, frame` | Insert a keyframe |

---

### 🗺️ Viewport

| Tool | Key Params | What it does |
|---|---|---|
| `blender_set_viewport_view` | `view` | Set view (TOP/FRONT/SIDE/CAMERA) |
| `blender_set_viewport_shading` | `shading` | Set shading (WIREFRAME/SOLID/MATERIAL/RENDERED) |
| `blender_frame_all` | — | Zoom to fit all objects |
| `blender_frame_selected` | — | Zoom to fit selection |
| `blender_toggle_xray` | `enabled` | Toggle X-Ray mode |
| `blender_toggle_overlays` | `enabled` | Toggle overlays |
| `blender_toggle_local_view` | `enable` | Local view for selection |
| `blender_orbit_viewport` | `angle` | Orbit the viewport |
| `blender_pan_viewport` | `offset` | Pan the viewport |
| `blender_zoom_viewport` | `factor` | Zoom viewport |

---

### 📦 Export & Files

| Tool | Key Params | What it does |
|---|---|---|
| `blender_export_glb` | `filepath` | Export GLB (GLTF binary) |
| `blender_export_fbx` | `filepath, applyScale, useSelected` | Export FBX |
| `blender_export_obj` | `filepath, useSelected` | Export OBJ |
| `blender_save_file` | — | Save current `.blend` |
| `blender_save_file_as` | `filepath` | Save to new path |
| `blender_open_file` | `filepath` | Open a `.blend` file |
| `blender_get_current_file` | — | Get current file path |

---

### 💾 Checkpoints

| Tool | Key Params | What it does |
|---|---|---|
| `blender_save_checkpoint` | `label` | Save snapshot |
| `blender_list_checkpoints` | — | List all checkpoints |
| `blender_rollback_checkpoint` | `path` | Restore a checkpoint |

---

### ⚗️ Python Escape Hatch

| Tool | Key Params | What it does |
|---|---|---|
| `blender_execute_python` | `code` | Run arbitrary `bpy` Python code |

Use this for: shader nodes, UV unwrapping, geometry nodes, custom modifiers, armature/rigging, advanced animation, anything not in the lists above.

---

## 🔄 Standard Workflow Loop

> **Inspect → Checkpoint → Mutate → Verify**

1. `blender_ping` — confirm connection
2. `blender_get_scene_info` — understand the scene
3. `blender_save_checkpoint` — before risky changes
4. Execute operation (tool or `blender_execute_python`)
5. `blender_inspect_object` or `blender_get_scene_info` — verify result
6. `blender_render_viewport` — optional visual confirmation

---

## Core Anti-Hallucination Rules

- **Never invent** objects, materials, renders, file paths, or tool results.
- Treat a tool error as a failed operation; do not infer a mutation from a request alone.
- Inspect before mutating. Never assume active object, mode, or selection.
- Reinspect after mutations.
- Use checkpoints before destructive or broad changes.
- Do not claim geometry is manifold/UV-mapped/game-ready without audit evidence.
- Do not claim a render succeeded unless an image path was returned.
- Do not use Blender tools for Godot nodes or web DOM.

---

## Verification Checklist

| Claim | Required Evidence |
|---|---|
| "Blender is connected" | `blender_ping` succeeded |
| "Object created/modified" | Tool returned ok + confirmed in `blender_get_scene_info` |
| "Render produced" | Image file path returned and confirmed |
| "Mesh is manifold" | `blender_get_scene_audit` reports 0 non-manifold edges |
| "Asset is game-ready" | Tris under budget, scale (1,1,1) applied, GLB export succeeded |
| "Python ran successfully" | `blender_execute_python` returned an explicit result; confirm mutations with a Blender inspection tool |

---

## Serena (Semantic Code)

Use Serena **only** for `bpy` addon source code — symbol lookup, operator classes, panel definitions.

Do **not** use Serena for live scene state. Use `blender_get_scene_info` and `blender_inspect_object` instead.

---

## Security Restrictions

- Workspace-bound file tools must resolve paths inside the approved Auvrynt workspace.
- `blender_execute_python` requires explicit `auvrynt:blender-python` authorization in addition to the ordinary Blender scope. Treat it as host-level code execution inside Blender, not as a Python sandbox.
- Trusted agents using the Python escape hatch must avoid shell/process/network APIs and keep code limited to the Blender task. Scope gating is the security boundary; do not rely on a deny-list or regex filter as a sandbox.
- Socket communication to the Blender bridge is loopback-only in the supported local setup.

---

## Response Format

```text
Changes:
- ...

Files affected:
- ...

Scene verification:
- ...

Visual verification (render path if applicable):
- ...

Notes/blockers:
- ...
```
