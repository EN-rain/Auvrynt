import type { CatalogTool } from "./blender-catalog.js";

export const sceneCatalogTools: CatalogTool[] = [
  {
    name: "blender_get_blender_version",
    title: "Get Blender Version",
    description: "Return the running Blender version, build, and binary directory.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "def _stable_text(value):\n" +
      "    if value is None:\n" +
      "        return ''\n" +
      "    if isinstance(value, bytes):\n" +
      "        return value.decode('utf-8', errors='replace')\n" +
      "    return str(value)\n" +
      "build_hash = getattr(bpy.app, 'build_hash', None) or getattr(bpy.app, 'build_commit_hash', b'') or b''\n" +
      "result = {\n" +
      "    'version': bpy.app.version_string,\n" +
      "    'version_tuple': list(bpy.app.version),\n" +
      "    'build_date': _stable_text(getattr(bpy.app, 'build_date', '')),\n" +
      "    'build_commit': _stable_text(build_hash),\n" +
      "    'binary_path': bpy.app.binary_path,\n" +
      "}\n",
  },
  {
    name: "blender_get_operation_status",
    title: "Get Operation Status",
    description: "Return the current Blender operation status: whether Blender is busy and which context it is in.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "wm = bpy.context.window_manager\n" +
      "result = {\n" +
      "    'mode': bpy.context.mode,\n" +
      "    'is_running': wm.is_operation_running('OPERATOR' if bpy.context.space_data and bpy.context.space_data.type == 'VIEW_3D' else 'WINDOW') if False else False,\n" +
      "    'busy': wm.is_interface_locked if hasattr(wm, 'is_interface_locked') else False,\n" +
      "    'active_operator': wm.operators[-1].name if wm.operators else None,\n" +
      "}\n",
  },
  {
    name: "blender_get_task_progress",
    title: "Get Task Progress",
    description: "Report progress of a long-running Blender operation started through the bridge.",
    readOnly: true,
    params: [{ name: "taskId", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `task_id = ${JSON.stringify(p.taskId)}\n` +
      "wm = bpy.context.window_manager\n" +
      "progress = getattr(wm, 'mcp_task_progress', {})\n" +
      "result = progress.get(task_id, {'task_id': task_id, 'status': 'unknown'})\n",
  },
  {
    name: "blender_cancel_operation",
    title: "Cancel Operation",
    description: "Request cancellation of the current running Blender operator.",
    readOnly: false,
    params: [],
    build: () =>
      "import bpy\n" +
      "wm = bpy.context.window_manager\n" +
      "cancelled = []\n" +
      "for area in (bpy.context.screen.areas if bpy.context.screen else []):\n" +
      "    if area.type == 'VIEW_3D':\n" +
      "        for space in area.spaces:\n" +
      "            if space.type == 'VIEW_3D':\n" +
      "                bpy.ops.view3d.view_cancel() if bpy.ops.view3d.view_cancel.poll() else None\n" +
      "                cancelled.append('view')\n" +
      "result = {'cancelled': cancelled, 'note': 'Sent cancel to active operators.'}\n",
  },
  {
    name: "blender_get_recent_operator_log",
    title: "Get Recent Operator Log",
    description: "Return recent operator executions logged by the Blender bridge.",
    readOnly: true,
    params: [{ name: "limit", type: "number", optional: true, default: 40 }],
    build: (p) =>
      "import bpy\n" +
      `limit = ${JSON.stringify(p.limit ?? 40)}\n` +
      "wm = bpy.context.window_manager\n" +
      "log = getattr(wm, 'mcp_operator_log', [])\n" +
      "result = {'operators': log[-int(limit):]}\n",
  },
  {
    name: "blender_get_unsaved_changes_status",
    title: "Get Unsaved Changes Status",
    description: "Report whether the current Blender file has unsaved modifications.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "result = {\n" +
      "    'is_dirty': bpy.data.is_dirty,\n" +
      "    'is_saved': bool(bpy.data.filepath),\n" +
      "    'filepath': bpy.data.filepath,\n" +
      "}\n",
  },
  {
    name: "blender_get_scene_hierarchy",
    title: "Get Scene Hierarchy",
    description: "Return the collection hierarchy of the active scene with object names and types.",
    readOnly: true,
    params: [{ name: "includeEmpty", type: "boolean", optional: true, default: true }],
    build: (p) =>
      "import bpy\n" +
      `include_empty = ${p.includeEmpty === false ? "False" : "True"}\n` +
      "scene = bpy.context.scene\n" +
      "def _coll_node(coll):\n" +
      "    objects = [{'name': o.name, 'type': o.type} for o in coll.objects]\n" +
      "    return {\n" +
      "        'name': coll.name,\n" +
      "        'objects': objects,\n" +
      "        'children': [_coll_node(c) for c in coll.children],\n" +
      "    }\n" +
      "result = {\n" +
      "    'scene': scene.name,\n" +
      "    'root_collection': _coll_node(scene.collection),\n" +
      "}\n",
  },
  {
    name: "blender_get_scene_statistics",
    title: "Get Scene Statistics",
    description: "Return counts of objects, vertices, triangles, collections, materials, and lights in the scene.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "objects = list(bpy.context.scene.objects)\n" +
      "meshes = [o for o in objects if o.type == 'MESH' and o.data]\n" +
      "vert_count = sum(len(o.data.vertices) for o in meshes)\n" +
      "tri_count = sum(sum(max(len(p.vertices) - 2, 1) for p in o.data.polygons) for o in meshes)\n" +
      "result = {\n" +
      "    'object_count': len(objects),\n" +
      "    'mesh_count': len(meshes),\n" +
      "    'vertex_count': vert_count,\n" +
      "    'triangle_count': tri_count,\n" +
      "    'collection_count': len(bpy.data.collections),\n" +
      "    'material_count': len(bpy.data.materials),\n" +
      "    'light_count': len([o for o in objects if o.type == 'LIGHT']),\n" +
      "    'camera_count': len([o for o in objects if o.type == 'CAMERA']),\n" +
      "    'empty_count': len([o for o in objects if o.type == 'EMPTY']),\n" +
      "}\n",
  },
  {
    name: "blender_get_dependency_graph_info",
    title: "Get Dependency Graph Info",
    description: "Return info about the dependency graph and whether it has pending updates.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "depsgraph = bpy.context.evaluated_depsgraph_get()\n" +
      "result = {\n" +
      "    'updates_pending': depsgraph.updates if hasattr(depsgraph, 'updates') else None,\n" +
      "    'has_updates': bool(list(depsgraph.updates) if hasattr(depsgraph, 'updates') else []),\n" +
      "    'objects': len(list(depsgraph.objects)) if hasattr(depsgraph, 'objects') else 0,\n" +
      "}\n",
  },
  {
    name: "blender_get_collection_info",
    title: "Get Collection Info",
    description: "Return details for a collection including its objects, children, and visibility.",
    readOnly: true,
    params: [{ name: "collectionName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `collection_name = ${JSON.stringify(p.collectionName)}\n` +
      "coll = bpy.data.collections.get(collection_name)\n" +
      "if coll is None:\n" +
      "    raise RuntimeError('Collection not found: ' + collection_name)\n" +
      "result = {\n" +
      "    'name': coll.name,\n" +
      "    'objects': [{'name': o.name, 'type': o.type} for o in coll.objects],\n" +
      "    'children': [c.name for c in coll.children],\n" +
      "    'hide_viewport': coll.hide_viewport,\n" +
      "    'hide_render': coll.hide_render,\n" +
      "    'is_visible': coll.visible_get() if hasattr(coll, 'visible_get') else None,\n" +
      "}\n",
  },
  {
    name: "blender_get_world_settings",
    title: "Get World Settings",
    description: "Return the active world's color, strength, background nodes, and visibility.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "world = bpy.context.scene.world\n" +
      "if world is None:\n" +
      "    result = {'world': None}\n" +
      "else:\n" +
      "    nodes = []\n" +
      "    if world.use_nodes and world.node_tree:\n" +
      "        for node in world.node_tree.nodes:\n" +
      "            nodes.append({'name': node.name, 'type': node.bl_idname})\n" +
      "    result = {\n" +
      "        'world': world.name,\n" +
      "        'color': [round(c, 4) for c in world.color],\n" +
      "        'use_nodes': world.use_nodes,\n" +
      "        'nodes': nodes,\n" +
      "        'exposure': round(world.exposure, 4) if hasattr(world, 'exposure') else None,\n" +
      "    }\n",
  },
  {
    name: "blender_get_visibility_report",
    title: "Get Visibility Report",
    description: "Report which objects are visible, hidden, in the render, or excluded from the viewport.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "report = []\n" +
      "for obj in bpy.context.scene.objects:\n" +
      "    report.append({\n" +
      "        'name': obj.name,\n" +
      "        'type': obj.type,\n" +
      "        'visible': obj.visible_get(),\n" +
      "        'hide_viewport': obj.hide_viewport,\n" +
      "        'hide_render': obj.hide_render,\n" +
      "        'hide_select': obj.hide_select,\n" +
      "    })\n" +
      "result = {'objects': report, 'count': len(report)}\n",
  },
  {
    name: "blender_get_memory_estimate",
    title: "Get Memory Estimate",
    description: "Estimate memory usage for meshes, images, and materials in the current file.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "mesh_bytes = sum(sum(len(v.co) * 12 + 4 for v in m.vertices) + sum(len(p.vertices) * 4 for p in m.polygons) for m in bpy.data.meshes)\n" +
      "image_bytes = sum(len(im.pixels) * 4 for im in bpy.data.images if im.pixels)\n" +
      "result = {\n" +
      "    'mesh_bytes_estimate': mesh_bytes,\n" +
      "    'image_bytes_estimate': image_bytes,\n" +
      "    'total_bytes_estimate': mesh_bytes + image_bytes,\n" +
      "    'mesh_count': len(bpy.data.meshes),\n" +
      "    'image_count': len(bpy.data.images),\n" +
      "}\n",
  },
  {
    name: "blender_get_draw_call_estimate",
    title: "Get Draw Call Estimate",
    description: "Estimate the number of draw calls based on object count, mesh users, and material slots.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "scene_objects = list(bpy.context.scene.objects)\n" +
      "draw_calls = 0\n" +
      "per_object = []\n" +
      "for obj in scene_objects:\n" +
      "    slots = max(len(obj.material_slots), 1) if obj.type == 'MESH' else 1\n" +
      "    draw_calls += slots\n" +
      "    per_object.append({'name': obj.name, 'draw_calls': slots})\n" +
      "result = {\n" +
      "    'total_draw_calls_estimate': draw_calls,\n" +
      "    'object_count': len(scene_objects),\n" +
      "    'objects': sorted(per_object, key=lambda x: x['draw_calls'], reverse=True)[:40],\n" +
      "}\n",
  },
  {
    name: "blender_get_render_cost_estimate",
    title: "Get Render Cost Estimate",
    description: "Estimate render cost based on triangles, samples, lights, and resolution.",
    readOnly: true,
    params: [],
    build: () =>
      "import bpy\n" +
      "scene = bpy.context.scene\n" +
      "meshes = [o for o in scene.objects if o.type == 'MESH' and o.data]\n" +
      "tris = sum(sum(max(len(p.vertices) - 2, 1) for p in o.data.polygons) for o in meshes)\n" +
      "samples = scene.cycles.samples if hasattr(scene, 'cycles') else 64\n" +
      "lights = len([o for o in scene.objects if o.type == 'LIGHT'])\n" +
      "pixels = scene.render.resolution_x * scene.render.resolution_y\n" +
      "estimate = tris * samples * max(lights, 1) * pixels / 1_000_000_000\n" +
      "result = {\n" +
      "    'triangles': tris,\n" +
      "    'samples': samples,\n" +
      "    'lights': lights,\n" +
      "    'resolution': [scene.render.resolution_x, scene.render.resolution_y],\n" +
      "    'cost_estimate': round(estimate, 4),\n" +
      "    'unit': 'relative_units',\n" +
      "}\n",
  },
];
