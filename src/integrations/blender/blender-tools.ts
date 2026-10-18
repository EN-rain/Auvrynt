import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { getBlenderClient } from "./blender-client.js";
import type { ToolResponse } from "../../pi-tools.js";
import { isPathInsideRoot } from "../../roots.js";
import { inlineImageOrNotice } from "../../tool-result-budget.js";

// Helper to return clean text tool response
function textResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text", text }],
  };
}

// Helper to return error tool response
function errorResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

async function currentBlenderFilePath(workspaceId: string): Promise<string> {
  const client = getBlenderClient(workspaceId);
  const result = await client.sendExecute(
    "import bpy\nresult = {'filepath': bpy.data.filepath or ''}\n",
  ) as { filepath?: unknown };
  return typeof result.filepath === "string" ? result.filepath : "";
}

export async function assertBlenderWorkspaceBound(
  registry: WorkspaceRegistry,
  workspaceId: string,
  options: { allowUntitled?: boolean } = {},
): Promise<string | undefined> {
  const workspace = registry.getWorkspace(workspaceId);
  const filepath = await currentBlenderFilePath(workspaceId);
  if (!filepath) {
    if (options.allowUntitled) return undefined;
    throw new Error("Blender has no saved file bound to this workspace. Open a workspace .blend file or use blender_save_file_as first.");
  }
  registry.resolvePath(workspace, filepath);
  return filepath;
}

function checkpointDirectory(registry: WorkspaceRegistry, workspaceId: string): string {
  const workspace = registry.getWorkspace(workspaceId);
  return registry.resolveArtifactPath(workspace, "checkpoints", "blender");
}

function artifactTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Helper to read a persisted render and return image + text response.
async function imageResponse(workspaceRoot: string, outputPath: string, text: string): Promise<ToolResponse> {
  if (!existsSync(outputPath)) {
    return errorResponse(`Render succeeded but output file not found: ${outputPath}`);
  }
  const buffer = await readFile(outputPath);
  const relativePath = relative(workspaceRoot, outputPath).replace(/\\/g, "/");

  return {
    content: [
      ...inlineImageOrNotice(buffer, `Blender render ${relativePath}`, "image/png"),
      {
        type: "text",
        text: `${text}\nSaved to ${relativePath}`,
      },
    ],
  };
}

// ─── Connection and State ────────────────────────────────────────────────────

export async function blenderPing(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "result = {'connected': True, 'version': bpy.app.version_string}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Blender ping failed: ${err.message}`);
  }
}

export async function blenderGetSceneInfo(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "objects = []\n" +
      "for obj in bpy.context.scene.objects:\n" +
      "    objects.append({\n" +
      "        'name': obj.name,\n" +
      "        'type': obj.type,\n" +
      "        'location': [round(v, 4) for v in obj.location],\n" +
      "        'visible': obj.visible_get(),\n" +
      "    })\n" +
      "result = {\n" +
      "    'scene': bpy.context.scene.name,\n" +
      "    'object_count': len(objects),\n" +
      "    'objects': objects,\n" +
      "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Get scene info failed: ${err.message}`);
  }
}

export async function blenderGetSceneAudit(
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    includeHidden?: boolean;
    includeInstances?: boolean;
    includeMaterials?: boolean;
    includeImages?: boolean;
    includeModifiers?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const includeHidden = input.includeHidden ?? true;
    const includeInstances = input.includeInstances ?? true;
    const includeMaterials = input.includeMaterials ?? true;
    const includeImages = input.includeImages ?? true;
    const includeModifiers = input.includeModifiers ?? true;

    const res = await client.sendExecute(
      "import bpy, os, bmesh\n" +
      `include_hidden = ${includeHidden ? "True" : "False"}\n` +
      `include_instances = ${includeInstances ? "True" : "False"}\n` +
      `include_materials = ${includeMaterials ? "True" : "False"}\n` +
      `include_images = ${includeImages ? "True" : "False"}\n` +
      `include_modifiers = ${includeModifiers ? "True" : "False"}\n` +
      "objects = [obj for obj in bpy.data.objects if include_hidden or not obj.hide_get()]\n" +
      "mesh_objects = [obj for obj in objects if obj.type == 'MESH' and obj.data]\n" +
      "mesh_users = {}\n" +
      "material_users = {}\n" +
      "heavy_objects = []\n" +
      "unapplied_transforms = []\n" +
      "non_manifold_objects = []\n" +
      "vertex_count = 0\n" +
      "triangle_count = 0\n" +
      "for obj in mesh_objects:\n" +
      "    mesh = obj.data\n" +
      "    tris = sum(max(len(poly.vertices) - 2, 1) for poly in mesh.polygons)\n" +
      "    vertex_count += len(mesh.vertices)\n" +
      "    triangle_count += tris\n" +
      "    mesh_users.setdefault(mesh.name, []).append(obj.name)\n" +
      "    if tris > 1500:\n" +
      "        heavy_objects.append({'object': obj.name, 'triangles': tris, 'vertices': len(mesh.vertices), 'mesh': mesh.name})\n" +
      "    if any(abs(v - 1.0) > 0.001 for v in obj.scale) or any(abs(v) > 0.001 for v in obj.rotation_euler):\n" +
      "        unapplied_transforms.append({'object': obj.name, 'location': list(obj.location), 'rotation_euler': list(obj.rotation_euler), 'scale': list(obj.scale)})\n" +
      "    if include_materials:\n" +
      "        for slot in obj.material_slots:\n" +
      "            if slot.material:\n" +
      "                material_users.setdefault(slot.material.name, []).append(obj.name)\n" +
      "    try:\n" +
      "        bm = bmesh.new(); bm.from_mesh(mesh)\n" +
      "        bad = [edge for edge in bm.edges if not edge.is_manifold]\n" +
      "        if bad:\n" +
      "            non_manifold_objects.append({'object': obj.name, 'edge_count': len(bad)})\n" +
      "        bm.free()\n" +
      "    except Exception:\n" +
      "        pass\n" +
      "unused_datablocks = []\n" +
      "for label, collection in {'meshes': bpy.data.meshes, 'materials': bpy.data.materials, 'images': bpy.data.images, 'node_groups': bpy.data.node_groups}.items():\n" +
      "    for block in collection:\n" +
      "        if getattr(block, 'users', 0) == 0:\n" +
      "            unused_datablocks.append({'type': label, 'name': block.name})\n" +
      "missing_images = []\n" +
      "if include_images:\n" +
      "    for image in bpy.data.images:\n" +
      "        path = bpy.path.abspath(image.filepath) if image.filepath else ''\n" +
      "        if image.source == 'FILE' and path and not os.path.exists(path):\n" +
      "            missing_images.append({'name': image.name, 'path': path})\n" +
      "warnings = []\n" +
      "if len(objects) > 250:\n" +
      "    warnings.append('High object count for a low-poly game scene')\n" +
      "if triangle_count > 100000:\n" +
      "    warnings.append('High total triangle count')\n" +
      "if len(bpy.data.materials) > 64:\n" +
      "    warnings.append('High material count; consider shared atlased materials')\n" +
      "if len([light for light in bpy.data.lights if getattr(light, 'use_shadow', False)]) > 4:\n" +
      "    warnings.append('Many shadow-casting lights')\n" +
      "result = {\n" +
      "    'object_count': len(objects),\n" +
      "    'mesh_count': len(mesh_objects),\n" +
      "    'unique_mesh_datablocks': len({obj.data.name for obj in mesh_objects}),\n" +
      "    'instance_count': sum(max(len(users) - 1, 0) for users in mesh_users.values()) if include_instances else 0,\n" +
      "    'vertex_count': vertex_count,\n" +
      "    'triangle_count': triangle_count,\n" +
      "    'material_count': len(bpy.data.materials) if include_materials else 0,\n" +
      "    'image_count': len(bpy.data.images) if include_images else 0,\n" +
      "    'light_count': len(bpy.data.lights),\n" +
      "    'collection_count': len(bpy.data.collections),\n" +
      "    'duplicate_meshes': [{'mesh': k, 'objects': v} for k, v in mesh_users.items() if len(v) > 1],\n" +
      "    'duplicate_materials': [{'material': k, 'objects': v} for k, v in material_users.items() if len(v) > 1],\n" +
      "    'unapplied_transforms': unapplied_transforms,\n" +
      "    'non_manifold_objects': non_manifold_objects,\n" +
      "    'heavy_objects': sorted(heavy_objects, key=lambda x: x['triangles'], reverse=True)[:30],\n" +
      "    'unused_datablocks': unused_datablocks,\n" +
      "    'missing_images': missing_images,\n" +
      "    'optimization_warnings': warnings,\n" +
      "}\n",
    ) as Record<string, unknown>;
    if (Array.isArray(res.missing_images)) {
      res.missing_images = res.missing_images.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const image = entry as { name?: unknown; path?: unknown };
        if (typeof image.path !== "string") return entry;
        try {
          const allowedPath = registry.resolvePath(workspace, image.path);
          return { ...image, path: relative(workspace.root, allowedPath).replace(/\\/g, "/") };
        } catch {
          return { name: image.name, path: "[outside workspace]" };
        }
      });
    }
    return textResponse(JSON.stringify(res, null, 2));
  } catch (error) {
    return errorResponse(`Scene audit failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function blenderGetSelection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "active = bpy.context.view_layer.objects.active\n" +
      "result = {\n" +
      "    'active': active.name if active else None,\n" +
      "    'selected': [obj.name for obj in bpy.context.selected_objects],\n" +
      "    'mode': bpy.context.mode,\n" +
      "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Get selection failed: ${err.message}`);
  }
}

export async function blenderGetActiveModeAndStatus(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "active = bpy.context.view_layer.objects.active\n" +
      "result = {\n" +
      "    'mode': bpy.context.mode,\n" +
      "    'active_object': active.name if active else None,\n" +
      "    'frame': bpy.context.scene.frame_current,\n" +
      "    'render_engine': bpy.context.scene.render.engine,\n" +
      "    'is_animation_playing': bpy.context.screen.is_animation_playing if bpy.context.screen else False,\n" +
      "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Get active mode and status failed: ${err.message}`);
  }
}

// ─── Object Inspection and Editing ───────────────────────────────────────────

export async function blenderInspectObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `obj = bpy.data.objects.get(${JSON.stringify(input.objectName)})\n` +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found')\n" +
      "mesh = obj.data if obj.type == 'MESH' else None\n" +
      "result = {\n" +
      "    'name': obj.name,\n" +
      "    'type': obj.type,\n" +
      "    'location': list(obj.location),\n" +
      "    'rotation_euler': list(obj.rotation_euler),\n" +
      "    'scale': list(obj.scale),\n" +
      "    'parent': obj.parent.name if obj.parent else None,\n" +
      "    'children': [child.name for child in obj.children],\n" +
      "    'modifiers': [{'name': m.name, 'type': m.type, 'show_viewport': m.show_viewport, 'show_render': m.show_render} for m in obj.modifiers],\n" +
      "    'constraints': [{'name': c.name, 'type': c.type, 'influence': c.influence} for c in obj.constraints],\n" +
      "    'materials': [slot.material.name if slot.material else None for slot in obj.material_slots],\n" +
      "    'mesh': {'name': mesh.name, 'vertices': len(mesh.vertices), 'edges': len(mesh.edges), 'polygons': len(mesh.polygons)} if mesh else None,\n" +
      "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Inspect object failed: ${err.message}`);
  }
}

export async function blenderCreateCube(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; x?: number; y?: number; z?: number; size?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const name = input.name || "MCP Cube";
    const x = input.x ?? 0;
    const y = input.y ?? 0;
    const z = input.z ?? 1;
    const size = input.size ?? 2;

    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.mesh.primitive_cube_add(size=${size}, location=(${x}, ${y}, ${z}))\n` +
      "obj = bpy.context.object\n" +
      `obj.name = ${JSON.stringify(name)}\n` +
      "result = {'name': obj.name, 'type': obj.type, 'location': [round(v, 4) for v in obj.location]}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create cube failed: ${err.message}`);
  }
}

export async function blenderSelectObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; mode?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const mode = input.mode || "OBJECT";
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `mode = ${JSON.stringify(mode)}.upper()\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "obj.select_set(True)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "if mode != 'OBJECT':\n" +
      "    bpy.ops.object.mode_set(mode=mode)\n" +
      "result = {'selected': obj.name, 'mode': bpy.context.mode}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select object failed: ${err.message}`);
  }
}

export async function blenderSelectObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; pattern?: string; objectType?: string; collection?: string; material?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const pattern = input.pattern || "*";
    const objectType = input.objectType || "";
    const collection = input.collection || "";
    const material = input.material || "";

    const res = await client.sendExecute(
      "import bpy, fnmatch\n" +
      `pattern = ${JSON.stringify(pattern)}\n` +
      `object_type = ${JSON.stringify(objectType)}.upper()\n` +
      `collection = ${JSON.stringify(collection)}\n` +
      `material = ${JSON.stringify(material)}\n` +
      "objects = list(bpy.context.scene.objects)\n" +
      "if collection:\n" +
      "    coll = bpy.data.collections.get(collection)\n" +
      "    objects = list(coll.objects) if coll else []\n" +
      "matches = []\n" +
      "for obj in objects:\n" +
      "    if pattern and not fnmatch.fnmatch(obj.name, pattern):\n" +
      "        continue\n" +
      "    if object_type and obj.type != object_type:\n" +
      "        continue\n" +
      "    if material and material not in [slot.material.name for slot in obj.material_slots if slot.material]:\n" +
      "        continue\n" +
      "    matches.append(obj)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "for obj in matches:\n" +
      "    obj.select_set(True)\n" +
      "if matches:\n" +
      "    bpy.context.view_layer.objects.active = matches[0]\n" +
      "result = {'selected': [obj.name for obj in matches], 'count': len(matches)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select objects failed: ${err.message}`);
  }
}

export async function blenderTransformObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; location?: number[]; rotationEuler?: number[]; scale?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const loc = input.location ? JSON.stringify(input.location) : "None";
    const rot = input.rotationEuler ? JSON.stringify(input.rotationEuler) : "None";
    const scl = input.scale ? JSON.stringify(input.scale) : "None";

    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `location = ${loc}\n` +
      `rotation_euler = ${rot}\n` +
      `scale = ${scl}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if location is not None:\n" +
      "    obj.location = location\n" +
      "if rotation_euler is not None:\n" +
      "    obj.rotation_euler = rotation_euler\n" +
      "if scale is not None:\n" +
      "    obj.scale = scale\n" +
      "result = {'name': obj.name, 'location': list(obj.location), 'rotation_euler': list(obj.rotation_euler), 'scale': list(obj.scale)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Transform object failed: ${err.message}`);
  }
}

export async function blenderDuplicateLinked(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; offset?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const offset = input.offset ? JSON.stringify(input.offset) : "None";
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `offset = ${offset} or [0, 0, 0]\n` +
      "created = []\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj is None:\n" +
      "        continue\n" +
      "    dup = obj.copy()\n" +
      "    dup.data = obj.data\n" +
      "    dup.location = obj.location\n" +
      "    dup.location.x += float(offset[0]); dup.location.y += float(offset[1]); dup.location.z += float(offset[2])\n" +
      "    obj.users_collection[0].objects.link(dup) if obj.users_collection else bpy.context.scene.collection.objects.link(dup)\n" +
      "    created.append(dup.name)\n" +
      "result = {'created': created, 'count': len(created)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Duplicate linked failed: ${err.message}`);
  }
}

export async function blenderJoinObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; resultName?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const resultName = input.resultName || "";
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `result_name = ${JSON.stringify(resultName)}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "objects = [bpy.data.objects.get(n) for n in object_names]\n" +
      "objects = [o for o in objects if o and o.type == 'MESH']\n" +
      "if len(objects) < 2:\n" +
      "    raise RuntimeError('Need at least two mesh objects to join')\n" +
      "for obj in objects:\n" +
      "    obj.select_set(True)\n" +
      "bpy.context.view_layer.objects.active = objects[0]\n" +
      "bpy.ops.object.join()\n" +
      "joined = bpy.context.object\n" +
      "if result_name:\n" +
      "    joined.name = result_name\n" +
      "result = {'joined': joined.name, 'source_count': len(objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Join objects failed: ${err.message}`);
  }
}

export async function blenderDeleteObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      "deleted = []\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        deleted.append(obj.name)\n" +
      "        bpy.data.objects.remove(obj, do_unlink=True)\n" +
      "result = {'deleted': deleted, 'count': len(deleted)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Delete objects failed: ${err.message}`);
  }
}

export async function blenderCreateCollection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name: string; parent?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const parent = input.parent || "";
    const res = await client.sendExecute(
      "import bpy\n" +
      `name = ${JSON.stringify(input.name)}\n` +
      `parent = ${JSON.stringify(parent)}\n` +
      "coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)\n" +
      "parent_coll = bpy.data.collections.get(parent) if parent else bpy.context.scene.collection\n" +
      "if coll.name not in parent_coll.children:\n" +
      "    try:\n" +
      "        parent_coll.children.link(coll)\n" +
      "    except RuntimeError:\n" +
      "        pass\n" +
      "result = {'collection': coll.name, 'parent': parent_coll.name}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create collection failed: ${err.message}`);
  }
}

export async function blenderMoveToCollection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; collectionName: string; unlinkFromOthers?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const unlinkFromOthers = input.unlinkFromOthers ?? false;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `collection_name = ${JSON.stringify(input.collectionName)}\n` +
      `unlink_from_others = ${unlinkFromOthers ? "True" : "False"}\n` +
      "coll = bpy.data.collections.get(collection_name) or bpy.data.collections.new(collection_name)\n" +
      "if coll.name not in bpy.context.scene.collection.children:\n" +
      "    try:\n" +
      "        bpy.context.scene.collection.children.link(coll)\n" +
      "    except RuntimeError:\n" +
      "        pass\n" +
      "moved = []\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if not obj:\n" +
      "        continue\n" +
      "    if obj.name not in coll.objects:\n" +
      "        coll.objects.link(obj)\n" +
      "    if unlink_from_others:\n" +
      "        for old in list(obj.users_collection):\n" +
      "            if old != coll:\n" +
      "                old.objects.unlink(obj)\n" +
      "    moved.append(obj.name)\n" +
      "result = {'collection': coll.name, 'objects': moved, 'count': len(moved)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Move to collection failed: ${err.message}`);
  }
}

// ─── Viewport Operations ─────────────────────────────────────────────────────

const VIEW3D_HELPER =
  "def _view3d_context():\n" +
  "    wm = bpy.context.window_manager\n" +
  "    for window in wm.windows:\n" +
  "        screen = window.screen\n" +
  "        for area in screen.areas:\n" +
  "            if area.type == 'VIEW_3D':\n" +
  "                region = next((r for r in area.regions if r.type == 'WINDOW'), None)\n" +
  "                space = next((s for s in area.spaces if s.type == 'VIEW_3D'), None)\n" +
  "                if region and space:\n" +
  "                    return window, screen, area, region, space\n" +
  "    raise RuntimeError('No active VIEW_3D area found')\n";

export async function blenderSetViewportView(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; view?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const view = input.view || "front";
    const res = await client.sendExecute(
      "import bpy\n" +
      `view = ${JSON.stringify(view)}.lower()\n` +
      VIEW3D_HELPER +
      "mapping = {'front': 'FRONT', 'rear': 'BACK', 'back': 'BACK', 'left': 'LEFT', 'right': 'RIGHT', 'top': 'TOP', 'bottom': 'BOTTOM'}\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    if view in mapping:\n" +
      "        bpy.ops.view3d.view_axis(type=mapping[view], align_active=False)\n" +
      "    elif view == 'camera':\n" +
      "        bpy.ops.view3d.view_camera()\n" +
      "    elif view in {'iso', 'isometric'}:\n" +
      "        rv3d = space.region_3d\n" +
      "        rv3d.view_perspective = 'PERSP'\n" +
      "        bpy.ops.view3d.view_axis(type='FRONT', align_active=False)\n" +
      "        bpy.ops.view3d.view_orbit(type='ORBITLEFT')\n" +
      "        bpy.ops.view3d.view_orbit(type='ORBITUP')\n" +
      "    else:\n" +
      "        raise RuntimeError('Unsupported view: ' + view)\n" +
      "result = {'view': view}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set viewport view failed: ${err.message}`);
  }
}

export async function blenderOrbitViewport(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; direction?: string; steps?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const direction = input.direction || "left";
    const steps = Math.max(1, Math.min(input.steps ?? 1, 24));

    const res = await client.sendExecute(
      "import bpy\n" +
      `direction = ${JSON.stringify(direction)}.lower()\n` +
      `steps = ${steps}\n` +
      VIEW3D_HELPER +
      "mapping = {'left': 'ORBITLEFT', 'right': 'ORBITRIGHT', 'up': 'ORBITUP', 'down': 'ORBITDOWN'}\n" +
      "if direction not in mapping:\n" +
      "    raise RuntimeError('Unsupported orbit direction: ' + direction)\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    for _ in range(steps):\n" +
      "        bpy.ops.view3d.view_orbit(type=mapping[direction])\n" +
      "result = {'direction': direction, 'steps': steps}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Orbit viewport failed: ${err.message}`);
  }
}

export async function blenderPanViewport(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; direction?: string; steps?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const direction = input.direction || "left";
    const steps = Math.max(1, Math.min(input.steps ?? 1, 24));

    const res = await client.sendExecute(
      "import bpy\n" +
      `direction = ${JSON.stringify(direction)}.lower()\n` +
      `steps = ${steps}\n` +
      VIEW3D_HELPER +
      "mapping = {'left': 'PANLEFT', 'right': 'PANRIGHT', 'up': 'PANUP', 'down': 'PANDOWN'}\n" +
      "if direction not in mapping:\n" +
      "    raise RuntimeError('Unsupported pan direction: ' + direction)\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    for _ in range(steps):\n" +
      "        bpy.ops.view3d.view_pan(type=mapping[direction])\n" +
      "result = {'direction': direction, 'steps': steps}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Pan viewport failed: ${err.message}`);
  }
}

export async function blenderZoomViewport(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; direction?: string; steps?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const direction = input.direction || "in";
    const steps = Math.max(1, Math.min(input.steps ?? 1, 24));

    const res = await client.sendExecute(
      "import bpy\n" +
      `direction = ${JSON.stringify(direction)}.lower()\n` +
      `steps = ${steps}\n` +
      VIEW3D_HELPER +
      "op = 'IN' if direction in {'in', 'zoom_in'} else 'OUT' if direction in {'out', 'zoom_out'} else None\n" +
      "if op is None:\n" +
      "    raise RuntimeError('Unsupported zoom direction: ' + direction)\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    for _ in range(steps):\n" +
      "        bpy.ops.view3d.zoom(delta=1 if op == 'IN' else -1)\n" +
      "result = {'direction': direction, 'steps': steps}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Zoom viewport failed: ${err.message}`);
  }
}

export async function blenderFrameSelected(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      VIEW3D_HELPER +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    bpy.ops.view3d.view_selected(use_all_regions=False)\n" +
      "result = {'framed': [obj.name for obj in bpy.context.selected_objects]}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Frame selected failed: ${err.message}`);
  }
}

export async function blenderSetViewportShading(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; mode?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const mode = input.mode || "solid";
    const res = await client.sendExecute(
      "import bpy\n" +
      `mode = ${JSON.stringify(mode)}.lower()\n` +
      VIEW3D_HELPER +
      "mapping = {'wireframe': 'WIREFRAME', 'solid': 'SOLID', 'material_preview': 'MATERIAL', 'material': 'MATERIAL', 'rendered': 'RENDERED'}\n" +
      "if mode not in mapping:\n" +
      "    raise RuntimeError('Unsupported shading mode: ' + mode)\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "space.shading.type = mapping[mode]\n" +
      "result = {'shading': space.shading.type}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set viewport shading failed: ${err.message}`);
  }
}

// ─── Materials, Nodes, and Modifiers ─────────────────────────────────────────

export async function blenderInspectMaterial(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; materialName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `material_name = ${JSON.stringify(input.materialName)}\n` +
      "mat = bpy.data.materials.get(material_name)\n" +
      "if mat is None:\n" +
      "    raise RuntimeError('Material not found: ' + material_name)\n" +
      "nodes = []\n" +
      "links = []\n" +
      "if mat.use_nodes and mat.node_tree:\n" +
      "    for node in mat.node_tree.nodes:\n" +
      "        nodes.append({'name': node.name, 'type': node.bl_idname, 'label': node.label, 'inputs': [i.name for i in node.inputs], 'outputs': [o.name for o in node.outputs]})\n" +
      "    for link in mat.node_tree.links:\n" +
      "        links.append({'from_node': link.from_node.name, 'from_socket': link.from_socket.name, 'to_node': link.to_node.name, 'to_socket': link.to_socket.name})\n" +
      "result = {'name': mat.name, 'use_nodes': mat.use_nodes, 'diffuse_color': list(mat.diffuse_color), 'users': mat.users, 'nodes': nodes, 'links': links}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Inspect material failed: ${err.message}`);
  }
}

export async function blenderInspectGeometryNodes(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "mods = []\n" +
      "for mod in obj.modifiers:\n" +
      "    if mod.type == 'NODES':\n" +
      "        group = mod.node_group\n" +
      "        mods.append({'modifier': mod.name, 'node_group': group.name if group else None, 'nodes': [{'name': n.name, 'type': n.bl_idname} for n in group.nodes] if group else [], 'links': [{'from_node': l.from_node.name, 'to_node': l.to_node.name} for l in group.links] if group else []})\n" +
      "result = {'object': obj.name, 'geometry_nodes': mods}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Inspect geometry nodes failed: ${err.message}`);
  }
}

export async function blenderEditModifier(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; modifierName: string; properties: Record<string, unknown> },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const propertiesJson = JSON.stringify(input.properties);
    const res = await client.sendExecute(
      "import bpy, json\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `modifier_name = ${JSON.stringify(input.modifierName)}\n` +
      `properties = json.loads(${JSON.stringify(propertiesJson)})\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "mod = obj.modifiers.get(modifier_name)\n" +
      "if mod is None:\n" +
      "    raise RuntimeError('Modifier not found: ' + modifier_name)\n" +
      "changed = {}\n" +
      "for key, value in properties.items():\n" +
      "    if not hasattr(mod, key):\n" +
      "        raise RuntimeError('Modifier property not found: ' + key)\n" +
      "    setattr(mod, key, value)\n" +
      "    changed[key] = getattr(mod, key)\n" +
      "result = {'object': obj.name, 'modifier': mod.name, 'changed': changed}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Edit modifier failed: ${err.message}`);
  }
}

// ─── Rendering Operations ────────────────────────────────────────────────────

export async function blenderSetRenderSettings(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; engine?: string; width?: number; height?: number; samples?: number; denoise?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const engine = input.engine || "BLENDER_EEVEE_NEXT";
    const width = Math.max(64, Math.min(input.width ?? 1280, 8192));
    const height = Math.max(64, Math.min(input.height ?? 720, 8192));
    const samples = Math.max(1, Math.min(input.samples ?? 64, 4096));
    const denoise = input.denoise ?? true;

    const res = await client.sendExecute(
      "import bpy\n" +
      `engine = ${JSON.stringify(engine)}\n` +
      "scene = bpy.context.scene\n" +
      "available = {'BLENDER_EEVEE_NEXT', 'CYCLES', 'BLENDER_WORKBENCH'}\n" +
      "if engine not in available:\n" +
      "    raise RuntimeError('Unsupported render engine: ' + engine)\n" +
      "scene.render.engine = engine\n" +
      `scene.render.resolution_x = ${width}\n` +
      `scene.render.resolution_y = ${height}\n` +
      "if engine == 'CYCLES' and hasattr(scene, 'cycles'):\n" +
      `    scene.cycles.samples = ${samples}\n` +
      `    scene.cycles.use_denoising = ${denoise ? "True" : "False"}\n` +
      "elif hasattr(scene, 'eevee'):\n" +
      `    scene.eevee.taa_render_samples = ${samples}\n` +
      "result = {'engine': scene.render.engine, 'width': scene.render.resolution_x, 'height': scene.render.resolution_y}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set render settings failed: ${err.message}`);
  }
}

export async function blenderRenderCamera(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; cameraName?: string; width?: number; height?: number; samples?: number },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const cameraName = input.cameraName || "";
    const width = Math.max(64, Math.min(input.width ?? 1280, 4096));
    const height = Math.max(64, Math.min(input.height ?? 720, 4096));
    const samples = Math.max(1, Math.min(input.samples ?? 64, 512));
    const outputPath = registry.resolveArtifactPath(
      workspace,
      `renders/camera-${artifactTimestamp()}.png`,
      "blender",
    );
    await mkdir(dirname(outputPath), { recursive: true });

    await client.sendExecute(
      "import bpy\n" +
      `camera_name = ${JSON.stringify(cameraName)}\n` +
      `output_path = ${JSON.stringify(outputPath)}\n` +
      "scene = bpy.context.scene\n" +
      "old_camera = scene.camera\n" +
      "old_filepath = scene.render.filepath\n" +
      "old_width = scene.render.resolution_x\n" +
      "old_height = scene.render.resolution_y\n" +
      "camera = bpy.data.objects.get(camera_name) if camera_name else scene.camera\n" +
      "if camera is None or camera.type != 'CAMERA':\n" +
      "    raise RuntimeError('Camera not found: ' + (camera_name or '<active scene camera>'))\n" +
      "try:\n" +
      "    scene.camera = camera\n" +
      `    scene.render.resolution_x = ${width}\n` +
      `    scene.render.resolution_y = ${height}\n` +
      "    scene.render.image_settings.file_format = 'PNG'\n" +
      "    scene.render.filepath = output_path\n" +
      "    if hasattr(scene, 'cycles'):\n" +
      `        scene.cycles.samples = ${samples}\n` +
      "    bpy.ops.render.render(write_still=True)\n" +
      "finally:\n" +
      "    scene.camera = old_camera\n" +
      "    scene.render.filepath = old_filepath\n" +
      "    scene.render.resolution_x = old_width\n" +
      "    scene.render.resolution_y = old_height\n" +
      "result = {'path': output_path, 'camera': camera.name}\n",
    );

    return imageResponse(workspace.root, outputPath, `Rendered camera view using ${cameraName || "active scene camera"}.`);
  } catch (err: any) {
    return errorResponse(`Render camera failed: ${err.message}`);
  }
}

export async function blenderRenderObjectIsolation(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; width?: number; height?: number; samples?: number },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const width = Math.max(64, Math.min(input.width ?? 1024, 4096));
    const height = Math.max(64, Math.min(input.height ?? 1024, 4096));
    const samples = Math.max(1, Math.min(input.samples ?? 32, 512));
    const label = input.objectName.replace(/[^a-zA-Z0-9_-]/g, "_") || "object";
    const outputPath = registry.resolveArtifactPath(
      workspace,
      `renders/isolate-${label}-${artifactTimestamp()}.png`,
      "blender",
    );
    await mkdir(dirname(outputPath), { recursive: true });

    await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `output_path = ${JSON.stringify(outputPath)}\n` +
      "target = bpy.data.objects.get(object_name)\n" +
      "if target is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "scene = bpy.context.scene\n" +
      "old_hide = {obj.name: obj.hide_render for obj in scene.objects}\n" +
      "old_camera = scene.camera\n" +
      "try:\n" +
      "    for obj in scene.objects:\n" +
      "        obj.hide_render = obj != target and obj.type not in {'CAMERA', 'LIGHT'}\n" +
      `    scene.render.resolution_x = ${width}\n` +
      `    scene.render.resolution_y = ${height}\n` +
      "    scene.render.image_settings.file_format = 'PNG'\n" +
      "    scene.render.filepath = output_path\n" +
      "    if hasattr(scene, 'cycles'):\n" +
      `        scene.cycles.samples = ${samples}\n` +
      "    bpy.ops.render.render(write_still=True)\n" +
      "finally:\n" +
      "    for obj in scene.objects:\n" +
      "        if obj.name in old_hide:\n" +
      "            obj.hide_render = old_hide[obj.name]\n" +
      "    scene.camera = old_camera\n" +
      "result = {'path': output_path, 'object': target.name}\n",
    );

    return imageResponse(workspace.root, outputPath, `Rendered isolated object: ${input.objectName}.`);
  } catch (err: any) {
    return errorResponse(`Render object isolation failed: ${err.message}`);
  }
}

export async function blenderRenderViewport(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; width?: number; height?: number },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const width = Math.max(64, Math.min(input.width ?? 1280, 4096));
    const height = Math.max(64, Math.min(input.height ?? 720, 4096));
    const outputPath = registry.resolveArtifactPath(
      workspace,
      `captures/viewport-${artifactTimestamp()}.png`,
      "blender",
    );
    await mkdir(dirname(outputPath), { recursive: true });

    await client.sendExecute(
      "import bpy\n" +
      `output_path = ${JSON.stringify(outputPath)}\n` +
      `bpy.context.scene.render.resolution_x = ${width}\n` +
      `bpy.context.scene.render.resolution_y = ${height}\n` +
      "bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)\n" +
      "bpy.ops.screen.screenshot(filepath=output_path)\n" +
      "result = {'path': output_path}\n",
    );

    return imageResponse(workspace.root, outputPath, "Captured viewport screenshot.");
  } catch (err: any) {
    return errorResponse(`Render viewport failed: ${err.message}`);
  }
}

// ─── Checkpoints and Recovery ────────────────────────────────────────────────

export async function blenderSaveCheckpoint(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; label?: string },
): Promise<ToolResponse> {
  try {
    await assertBlenderWorkspaceBound(registry, input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const label = (input.label || "checkpoint").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "checkpoint";
    const checkpointDir = checkpointDirectory(registry, input.workspaceId);
    await mkdir(checkpointDir, { recursive: true });
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.blend`;
    const checkpointPath = join(checkpointDir, filename);

    const res = await client.sendExecute(
      "import bpy\n" +
      `checkpoint_path = ${JSON.stringify(checkpointPath)}\n` +
      "bpy.ops.wm.save_as_mainfile(filepath=checkpoint_path, copy=True)\n" +
      "result = {'path': checkpoint_path}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (error) {
    return errorResponse(`Save checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function blenderListCheckpoints(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    registry.getWorkspace(input.workspaceId);
    const checkpointDir = checkpointDirectory(registry, input.workspaceId);
    if (!existsSync(checkpointDir)) return textResponse(JSON.stringify({ checkpoints: [] }, null, 2));

    const entries = await readdir(checkpointDir, { withFileTypes: true });
    const checkpoints = [] as Array<{ path: string; name: string; size: number; modifiedAt: string }>;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".blend")) continue;
      const path = join(checkpointDir, entry.name);
      const info = await stat(path);
      checkpoints.push({ path, name: entry.name, size: info.size, modifiedAt: info.mtime.toISOString() });
    }
    checkpoints.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
    return textResponse(JSON.stringify({ checkpoints }, null, 2));
  } catch (error) {
    return errorResponse(`List checkpoints failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function blenderRollbackCheckpoint(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; path: string },
): Promise<ToolResponse> {
  try {
    registry.getWorkspace(input.workspaceId);
    const originalPath = await assertBlenderWorkspaceBound(registry, input.workspaceId);
    if (!originalPath) throw new Error("Blender workspace binding is missing.");
    const checkpointDir = checkpointDirectory(registry, input.workspaceId);
    const checkpointPath = resolve(input.path);
    if (!isPathInsideRoot(checkpointPath, checkpointDir) || !checkpointPath.toLowerCase().endsWith(".blend")) {
      throw new Error("Checkpoint path is outside this workspace's managed Blender checkpoint directory.");
    }
    const info = await stat(checkpointPath);
    if (!info.isFile()) throw new Error("Checkpoint path is not a file.");

    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `checkpoint_path = ${JSON.stringify(checkpointPath)}\n` +
      `original_path = ${JSON.stringify(originalPath)}\n` +
      "bpy.ops.wm.open_mainfile(filepath=checkpoint_path)\n" +
      "bpy.ops.wm.save_as_mainfile(filepath=original_path)\n" +
      "result = {'restored': original_path, 'checkpoint': checkpoint_path}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (error) {
    return errorResponse(`Rollback checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── Python Escape Hatches ───────────────────────────────────────────────────

export async function blenderExecutePython(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; code: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(input.code);
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Python execution failed: ${err.message}`);
  }
}

// ─── File Management & Export ────────────────────────────────────────────────

export async function blenderGetCurrentFile(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const filepath = await currentBlenderFilePath(input.workspaceId);
    if (!filepath) return textResponse(JSON.stringify({ filepath: null, withinWorkspace: false }, null, 2));
    try {
      registry.resolvePath(workspace, filepath);
      return textResponse(JSON.stringify({ filepath, withinWorkspace: true }, null, 2));
    } catch {
      return textResponse(JSON.stringify({ filepath: null, withinWorkspace: false, detail: "Active Blender file is outside this workspace." }, null, 2));
    }
  } catch (error) {
    return errorResponse(`Get current file failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function blenderOpenFile(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filepath: string },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const absPath = registry.resolvePath(workspace, input.filepath);
    const client = getBlenderClient(input.workspaceId);

    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(absPath)})\n` +
      `result = {'opened': ${JSON.stringify(absPath)}}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Open file failed: ${err.message}`);
  }
}

export async function blenderSaveFile(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    await assertBlenderWorkspaceBound(registry, input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "if not bpy.data.filepath:\n" +
      "    raise RuntimeError('No active file path. Use save_file_as first.')\n" +
      "bpy.ops.wm.save_mainfile()\n" +
      "result = {'saved': bpy.data.filepath}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Save file failed: ${err.message}`);
  }
}

export async function blenderSaveFileAs(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filepath: string },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const absPath = registry.resolvePath(workspace, input.filepath);
    await assertBlenderWorkspaceBound(registry, input.workspaceId, { allowUntitled: true });
    const client = getBlenderClient(input.workspaceId);

    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(absPath)})\n` +
      `result = {'saved': ${JSON.stringify(absPath)}}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Save file as failed: ${err.message}`);
  }
}

export async function blenderExportGlb(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filepath: string },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const absPath = registry.resolveArtifactPath(workspace, input.filepath, "blender");
    await mkdir(dirname(absPath), { recursive: true });
    const client = getBlenderClient(input.workspaceId);

    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.export_scene.gltf(filepath=${JSON.stringify(absPath)}, export_format='GLB')\n` +
      `result = {'exported': ${JSON.stringify(absPath)}}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Export GLB failed: ${err.message}`);
  }
}

// ─── Extended Toolset ───────────────────────────────────────────────────────

// Helper to build the standard enter-edit-mode prologue for mesh edit tools.
function meshEditPrologue(objectName: string, mode = "EDIT"): string {
  return (
    "import bpy, bmesh\n" +
    `object_name = ${JSON.stringify(objectName)}\n` +
    "obj = bpy.data.objects.get(object_name)\n" +
    "if obj is None or obj.type != 'MESH':\n" +
    "    raise RuntimeError('Object not found or not a mesh: ' + object_name)\n" +
    "if bpy.ops.object.mode_set.poll():\n" +
    "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
    "bpy.context.view_layer.objects.active = obj\n" +
    "bpy.ops.object.mode_set(mode='EDIT')\n" +
    "bm = bmesh.from_edit_mesh(obj.data)\n"
  );
}

// ─── Primitives ─────────────────────────────────────────────────────────────

async function createPrimitive(
  registry: WorkspaceRegistry,
  workspaceId: string,
  opName: string,
  args: string,
  kwargs: string,
  resultKeys: string,
  objectName?: string,
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(workspaceId);
    const rename = objectName ? `obj = bpy.context.object\nobj.name = ${JSON.stringify(objectName)}\n` : "";
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.mesh.${opName}(${args}${args && kwargs ? ", " : ""}${kwargs})\n` +
      rename +
      "obj = bpy.context.object\n" +
      `result = ${resultKeys}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`${opName} failed: ${err.message}`);
  }
}

export async function blenderCreatePlane(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; size?: number; location?: number[] },
): Promise<ToolResponse> {
  const size = input.size ?? 2;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  const res = await createPrimitive(registry, input.workspaceId, "primitive_plane_add",
    `size=${size}`, `location=${loc}`, "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}", input.name);
  return res;
}

export async function blenderCreateCircle(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; vertices?: number; radius?: number; fillType?: string; location?: number[] },
): Promise<ToolResponse> {
  const vertices = input.vertices ?? 32;
  const radius = input.radius ?? 1;
  const fillType = input.fillType ?? "NGON";
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "primitive_circle_add",
    `vertices=${vertices}, radius=${radius}`, `fill_type=${JSON.stringify(fillType)}, location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

export async function blenderCreateCylinder(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; vertices?: number; radius?: number; depth?: number; location?: number[] },
): Promise<ToolResponse> {
  const vertices = input.vertices ?? 32;
  const radius = input.radius ?? 1;
  const depth = input.depth ?? 2;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "primitive_cylinder_add",
    `vertices=${vertices}, radius=${radius}, depth=${depth}`, `location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

export async function blenderCreateCone(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; vertices?: number; radius1?: number; radius2?: number; depth?: number; location?: number[] },
): Promise<ToolResponse> {
  const vertices = input.vertices ?? 32;
  const radius1 = input.radius1 ?? 1;
  const radius2 = input.radius2 ?? 0;
  const depth = input.depth ?? 2;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "primitive_cone_add",
    `vertices=${vertices}, radius1=${radius1}, radius2=${radius2}, depth=${depth}`, `location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

export async function blenderCreateSphere(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; segments?: number; ringCount?: number; radius?: number; location?: number[] },
): Promise<ToolResponse> {
  const segments = input.segments ?? 32;
  const ringCount = input.ringCount ?? 16;
  const radius = input.radius ?? 1;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "primitive_uv_sphere_add",
    `segments=${segments}, ring_count=${ringCount}, radius=${radius}`, `location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

export async function blenderCreateIcosphere(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; subdivisions?: number; radius?: number; location?: number[] },
): Promise<ToolResponse> {
  const subdivisions = input.subdivisions ?? 2;
  const radius = input.radius ?? 1;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "primitive_ico_sphere_add",
    `subdivisions=${subdivisions}, radius=${radius}`, `location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

export async function blenderCreateTorus(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; majorRadius?: number; minorRadius?: number; location?: number[] },
): Promise<ToolResponse> {
  const majorRadius = input.majorRadius ?? 1;
  const minorRadius = input.minorRadius ?? 0.25;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "primitive_torus_add",
    `major_radius=${majorRadius}, minor_radius=${minorRadius}`, `location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

export async function blenderCreateGrid(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; xSegments?: number; ySegments?: number; size?: number; location?: number[] },
): Promise<ToolResponse> {
  const xSegments = input.xSegments ?? 10;
  const ySegments = input.ySegments ?? 10;
  const size = input.size ?? 2;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "primitive_grid_add",
    `x_subdivisions=${xSegments}, y_subdivisions=${ySegments}, size=${size}`, `location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

export async function blenderCreateMonkey(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; size?: number; location?: number[] },
): Promise<ToolResponse> {
  const size = input.size ?? 2;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "primitive_monkey_add",
    `size=${size}`, `location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

export async function blenderCreateCamera(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; location?: number[]; rotation?: number[]; lens?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const lens = input.lens ?? 50;
    const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, -6, 3)";
    const rot = input.rotation ? `(${input.rotation.map((v) => v ?? 0).join(", ")})` : "(1.107, 0, 0)";
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.object.camera_add(location=${loc}, rotation=${rot})\n` +
      "obj = bpy.context.object\n" +
      `obj.data.lens = ${lens}\n` +
      `if ${JSON.stringify(input.name ?? "")}:\n    obj.name = ${JSON.stringify(input.name ?? "")}\n` +
      "result = {'name': obj.name, 'type': obj.type, 'location': list(obj.location), 'lens': obj.data.lens}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create camera failed: ${err.message}`);
  }
}

export async function blenderCreateLight(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; lightType?: string; energy?: number; color?: number[]; location?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const lightType = input.lightType ?? "POINT";
    const energy = input.energy ?? 100;
    const color = input.color ? `(${input.color.slice(0, 3).map((v) => v ?? 1).join(", ")})` : "(1, 1, 1)";
    const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(4, 4, 6)";
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.object.light_add(type=${JSON.stringify(lightType)}, location=${loc})\n` +
      "obj = bpy.context.object\n" +
      `obj.data.energy = ${energy}\n` +
      `obj.data.color = ${color}\n` +
      `if ${JSON.stringify(input.name ?? "")}:\n    obj.name = ${JSON.stringify(input.name ?? "")}\n` +
      "result = {'name': obj.name, 'type': obj.type, 'light_type': obj.data.type, 'energy': obj.data.energy, 'color': list(obj.data.color), 'location': list(obj.location)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create light failed: ${err.message}`);
  }
}

export async function blenderCreateEmpty(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; emptyType?: string; location?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const emptyType = input.emptyType ?? "PLAIN_AXES";
    const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.object.empty_add(type=${JSON.stringify(emptyType)}, location=${loc})\n` +
      "obj = bpy.context.object\n" +
      `if ${JSON.stringify(input.name ?? "")}:\n    obj.name = ${JSON.stringify(input.name ?? "")}\n` +
      "result = {'name': obj.name, 'type': obj.type, 'location': list(obj.location)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create empty failed: ${err.message}`);
  }
}

export async function blenderCreateText(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; content?: string; size?: number; location?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const size = input.size ?? 1;
    const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.object.text_add(location=${loc})\n` +
      "obj = bpy.context.object\n" +
      `obj.data.body = ${JSON.stringify(input.content ?? "Text")}\n` +
      `obj.data.size = ${size}\n` +
      `if ${JSON.stringify(input.name ?? "")}:\n    obj.name = ${JSON.stringify(input.name ?? "")}\n` +
      "result = {'name': obj.name, 'type': obj.type, 'content': obj.data.body, 'location': list(obj.location)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create text failed: ${err.message}`);
  }
}

export async function blenderCreateCurve(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; curveType?: string; location?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const curveType = input.curveType ?? "BEZIER";
    const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.curve.primitive_bezier_curve_add(location=${loc})\n` +
      "obj = bpy.context.object\n" +
      `if ${JSON.stringify(input.name ?? "")}:\n    obj.name = ${JSON.stringify(input.name ?? "")}\n` +
      "result = {'name': obj.name, 'type': obj.type, 'curve_type': obj.data.splines[0].type, 'location': list(obj.location)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create curve failed: ${err.message}`);
  }
}

export async function blenderCreateArmature(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; location?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.object.armature_add(location=${loc})\n` +
      "obj = bpy.context.object\n" +
      `if ${JSON.stringify(input.name ?? "")}:\n    obj.name = ${JSON.stringify(input.name ?? "")}\n` +
      "result = {'name': obj.name, 'type': obj.type, 'bone_count': len(obj.data.bones), 'location': list(obj.location)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create armature failed: ${err.message}`);
  }
}

export async function blenderCreateMetaball(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; radius?: number; location?: number[] },
): Promise<ToolResponse> {
  const radius = input.radius ?? 1;
  const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : "(0, 0, 0)";
  return createPrimitive(registry, input.workspaceId, "metaball_primitive_add",
    `type='BALL'`, `radius=${radius}, location=${loc}`,
    "{'name': obj.name, 'type': obj.type, 'location': list(obj.location)}");
}

// ─── Object Operations ──────────────────────────────────────────────────────

export async function blenderRenameObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; newName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `new_name = ${JSON.stringify(input.newName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "obj.name = new_name\n" +
      "result = {'old_name': object_name, 'new_name': obj.name}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Rename object failed: ${err.message}`);
  }
}

export async function blenderDuplicateObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; duplicateType?: string; offset?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const duplicateType = input.duplicateType || "LINKED";
    const offset = input.offset ? JSON.stringify(input.offset) : "[0, 0, 0]";
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `duplicate_type = ${JSON.stringify(duplicateType)}.upper()\n` +
      `offset = ${offset}\n` +
      "if duplicate_type not in {'LINKED', 'NORMAL', 'INSTANCE'}:\n" +
      "    raise RuntimeError('Unsupported duplicate type: ' + duplicate_type)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "created = []\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj is None:\n" +
      "        continue\n" +
      "    obj.select_set(True)\n" +
      "    bpy.context.view_layer.objects.active = obj\n" +
      "    if duplicate_type == 'LINKED':\n" +
      "        bpy.ops.object.duplicate_move_linked()\n" +
      "    else:\n" +
      "        bpy.ops.object.duplicate_move()\n" +
      "    dup = bpy.context.object\n" +
      "    dup.location.x += float(offset[0]); dup.location.y += float(offset[1]); dup.location.z += float(offset[2])\n" +
      "    created.append(dup.name)\n" +
      "    obj.select_set(False)\n" +
      "result = {'created': created, 'count': len(created)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Duplicate object failed: ${err.message}`);
  }
}

export async function blenderParentObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; childNames: string[]; parentName: string; keepTransform?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const keepTransform = input.keepTransform ?? false;
    const res = await client.sendExecute(
      "import bpy\n" +
      `child_names = ${JSON.stringify(input.childNames)}\n` +
      `parent_name = ${JSON.stringify(input.parentName)}\n` +
      `keep_transform = ${keepTransform ? "True" : "False"}\n` +
      "parent = bpy.data.objects.get(parent_name)\n" +
      "if parent is None:\n" +
      "    raise RuntimeError('Parent object not found: ' + parent_name)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "children = [bpy.data.objects.get(n) for n in child_names]\n" +
      "children = [c for c in children if c]\n" +
      "for child in children:\n" +
      "    child.select_set(True)\n" +
      "parent.select_set(True)\n" +
      "bpy.context.view_layer.objects.active = parent\n" +
      "bpy.ops.object.parent_set(type='OBJECT', keep_transform=keep_transform)\n" +
      "result = {'parent': parent.name, 'children': [c.name for c in children], 'count': len(children)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Parent object failed: ${err.message}`);
  }
}

export async function blenderUnparentObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; keepTransform?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const keepTransform = input.keepTransform ?? true;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `keep_transform = ${keepTransform ? "True" : "False"}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "objects = [bpy.data.objects.get(n) for n in object_names]\n" +
      "objects = [o for o in objects if o and o.parent]\n" +
      "for obj in objects:\n" +
      "    obj.select_set(True)\n" +
      "if objects:\n" +
      "    bpy.context.view_layer.objects.active = objects[0]\n" +
      "    bpy.ops.object.parent_clear(type='CLEAR' if keep_transform else 'CLEAR_KEEP_TRANSFORM')\n" +
      "result = {'unparented': [obj.name for obj in objects], 'count': len(objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Unparent object failed: ${err.message}`);
  }
}

export async function blenderHideObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; hide?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const hide = input.hide ?? true;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `hide = ${hide ? "True" : "False"}\n` +
      "changed = []\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj is None:\n" +
      "        continue\n" +
      "    obj.hide_set(hide)\n" +
      "    changed.append(obj.name)\n" +
      "result = {'hidden': changed, 'count': len(changed), 'hide': hide}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Hide objects failed: ${err.message}`);
  }
}

export async function blenderShowAllObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "for obj in bpy.data.objects:\n" +
      "    obj.hide_set(False)\n" +
      "    obj.hide_render = False\n" +
      "result = {'shown': len(bpy.data.objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Show all objects failed: ${err.message}`);
  }
}

export async function blenderSetOrigin(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; origin?: string; location?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const origin = input.origin || "geometry";
    const loc = input.location ? `(${input.location.map((v) => v ?? 0).join(", ")})` : null;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `origin = ${JSON.stringify(origin)}.lower()\n` +
      `loc = ${loc}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "objects = [bpy.data.objects.get(n) for n in object_names]\n" +
      "objects = [o for o in objects if o]\n" +
      "for obj in objects:\n" +
      "    obj.select_set(True)\n" +
      "if objects:\n" +
      "    bpy.context.view_layer.objects.active = objects[0]\n" +
      "    if origin == 'cursor':\n" +
      "        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')\n" +
      "    elif origin == 'center':\n" +
      "        bpy.ops.object.origin_set(type='ORIGIN_CENTER_OF_MASS')\n" +
      "    elif loc is not None:\n" +
      "        for obj in objects:\n" +
      "            obj.select_set(False)\n" +
      "        bpy.context.scene.cursor.location = loc\n" +
      "        bpy.ops.object.select_all(action='DESELECT')\n" +
      "        for obj in objects:\n" +
      "            obj.select_set(True)\n" +
      "        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')\n" +
      "    else:\n" +
      "        bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY')\n" +
      "result = {'objects': [obj.name for obj in objects], 'origin': origin, 'count': len(objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set origin failed: ${err.message}`);
  }
}

export async function blenderApplyTransforms(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; location?: boolean; rotation?: boolean; scale?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const location = input.location ?? true;
    const rotation = input.rotation ?? true;
    const scale = input.scale ?? true;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `apply_loc = ${location ? "True" : "False"}\n` +
      `apply_rot = ${rotation ? "True" : "False"}\n` +
      `apply_scale = ${scale ? "True" : "False"}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "objects = [bpy.data.objects.get(n) for n in object_names]\n" +
      "objects = [o for o in objects if o]\n" +
      "for obj in objects:\n" +
      "    obj.select_set(True)\n" +
      "if objects:\n" +
      "    bpy.context.view_layer.objects.active = objects[0]\n" +
      "    bpy.ops.object.transform_apply(location=apply_loc, rotation=apply_rot, scale=apply_scale)\n" +
      "result = {'applied': [obj.name for obj in objects], 'count': len(objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Apply transforms failed: ${err.message}`);
  }
}

export async function blenderClearTransforms(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; location?: boolean; rotation?: boolean; scale?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const location = input.location ?? true;
    const rotation = input.rotation ?? true;
    const scale = input.scale ?? false;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `clear_loc = ${location ? "True" : "False"}\n` +
      `clear_rot = ${rotation ? "True" : "False"}\n` +
      `clear_scale = ${scale ? "True" : "False"}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "objects = [bpy.data.objects.get(n) for n in object_names]\n" +
      "objects = [o for o in objects if o]\n" +
      "for obj in objects:\n" +
      "    obj.select_set(True)\n" +
      "if objects:\n" +
      "    bpy.context.view_layer.objects.active = objects[0]\n" +
      "    bpy.ops.object.location_clear(clear_delta=clear_loc)\n" +
      "    bpy.ops.object.rotation_clear(clear_delta=clear_rot)\n" +
      "    bpy.ops.object.scale_clear(clear_delta=clear_scale)\n" +
      "result = {'cleared': [obj.name for obj in objects], 'count': len(objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Clear transforms failed: ${err.message}`);
  }
}

export async function blenderMirrorObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; axis?: string[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const axes = input.axis ?? ["X"];
    const axisFlags = axes.map((a) => a.toUpperCase()).filter((a) => ["X", "Y", "Z"].includes(a));
    if (axisFlags.length === 0) axisFlags.push("X");
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `axes = ${JSON.stringify(axisFlags)}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "objects = [bpy.data.objects.get(n) for n in object_names]\n" +
      "objects = [o for o in objects if o]\n" +
      "for obj in objects:\n" +
      "    obj.select_set(True)\n" +
      "if objects:\n" +
      "    bpy.context.view_layer.objects.active = objects[0]\n" +
      "    use_x = 'X' in axes\n" +
      "    use_y = 'Y' in axes\n" +
      "    use_z = 'Z' in axes\n" +
      "    bpy.ops.transform.mirror(orient_type='GLOBAL', constraint_axis=(use_x, use_y, use_z))\n" +
      "result = {'mirrored': [obj.name for obj in objects], 'axes': axes, 'count': len(objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Mirror objects failed: ${err.message}`);
  }
}

export async function blenderSetCursorLocation(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; location: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const loc = `(${input.location.slice(0, 3).map((v) => v ?? 0).join(", ")})`;
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.context.scene.cursor.location = ${loc}\n` +
      "result = {'cursor': [round(v, 4) for v in bpy.context.scene.cursor.location]}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set cursor location failed: ${err.message}`);
  }
}

// ─── Selection ──────────────────────────────────────────────────────────────

export async function blenderSelectByType(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectType: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_type = ${JSON.stringify(input.objectType)}.upper()\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "matches = [obj for obj in bpy.context.scene.objects if obj.type == object_type]\n" +
      "for obj in matches:\n" +
      "    obj.select_set(True)\n" +
      "result = {'selected': [obj.name for obj in matches], 'type': object_type, 'count': len(matches)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select by type failed: ${err.message}`);
  }
}

export async function blenderSelectLinked(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "obj.select_set(True)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "bpy.ops.object.select_linked(type='OBDATA')\n" +
      "result = {'selected': [o.name for o in bpy.context.selected_objects], 'count': len(bpy.context.selected_objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select linked failed: ${err.message}`);
  }
}

export async function blenderSelectByCollection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; collectionName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `collection_name = ${JSON.stringify(input.collectionName)}\n` +
      "coll = bpy.data.collections.get(collection_name)\n" +
      "if coll is None:\n" +
      "    raise RuntimeError('Collection not found: ' + collection_name)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "for obj in coll.objects:\n" +
      "    obj.select_set(True)\n" +
      "result = {'selected': [obj.name for obj in coll.objects], 'collection': coll.name, 'count': len(coll.objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select by collection failed: ${err.message}`);
  }
}

export async function blenderSelectByMaterial(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; materialName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `material_name = ${JSON.stringify(input.materialName)}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "matches = []\n" +
      "for obj in bpy.context.scene.objects:\n" +
      "    names = [slot.material.name for slot in obj.material_slots if slot.material]\n" +
      "    if material_name in names:\n" +
      "        obj.select_set(True)\n" +
      "        matches.append(obj.name)\n" +
      "result = {'selected': matches, 'material': material_name, 'count': len(matches)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select by material failed: ${err.message}`);
  }
}

export async function blenderSelectByPolycount(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; maxTriangles?: number; minTriangles?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const maxTriangles = input.maxTriangles ?? Number.POSITIVE_INFINITY;
    const minTriangles = input.minTriangles ?? 0;
    const res = await client.sendExecute(
      "import bpy\n" +
      `max_tris = ${Number.isFinite(maxTriangles) ? maxTriangles : "float('inf')"}\n` +
      `min_tris = ${minTriangles}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "matches = []\n" +
      "for obj in bpy.context.scene.objects:\n" +
      "    if obj.type != 'MESH' or not obj.data:\n" +
      "        continue\n" +
      "    tris = sum(max(len(p.vertices) - 2, 1) for p in obj.data.polygons)\n" +
      "    if min_tris <= tris <= max_tris:\n" +
      "        obj.select_set(True)\n" +
      "        matches.append({'name': obj.name, 'triangles': tris})\n" +
      "matches.sort(key=lambda m: m['triangles'], reverse=True)\n" +
      "result = {'selected': [m['name'] for m in matches], 'count': len(matches), 'details': matches[:50]}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select by polycount failed: ${err.message}`);
  }
}

export async function blenderInvertSelection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "bpy.ops.object.select_all(action='INVERT')\n" +
      "result = {'selected': [o.name for o in bpy.context.selected_objects], 'count': len(bpy.context.selected_objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Invert selection failed: ${err.message}`);
  }
}

export async function blenderDeselectAll(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "result = {'selected': [], 'count': 0}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Deselect all failed: ${err.message}`);
  }
}

export async function blenderSelectAll(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "bpy.ops.object.select_all(action='SELECT')\n" +
      "result = {'selected': [o.name for o in bpy.context.selected_objects], 'count': len(bpy.context.selected_objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select all failed: ${err.message}`);
  }
}

// ─── Mesh Edit Mode ─────────────────────────────────────────────────────────

export async function blenderEnterEditMode(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "bpy.ops.object.mode_set(mode='EDIT')\n" +
      "result = {'object': obj.name, 'mode': bpy.context.mode}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Enter edit mode failed: ${err.message}`);
  }
}

export async function blenderExitEditMode(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "result = {'mode': bpy.context.mode}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Exit edit mode failed: ${err.message}`);
  }
}

export async function blenderSetMeshSelectionMode(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; mode?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const mode = input.mode || "VERT";
    const res = await client.sendExecute(
      "import bpy\n" +
      `mode = ${JSON.stringify(mode)}.upper()\n` +
      "if mode not in {'VERT', 'EDGE', 'FACE'}:\n" +
      "    raise RuntimeError('Unsupported selection mode: ' + mode)\n" +
      "mesh = bpy.context.object.data if bpy.context.object else None\n" +
      "if mesh is None or not hasattr(mesh, 'use_mesh_faces'):\n" +
      "    raise RuntimeError('Active object is not an editable mesh')\n" +
      "bpy.ops.object.mode_set(mode='EDIT')\n" +
      "mesh = bpy.context.object.data\n" +
      "mesh.select_mode = {'VERT' if mode == 'VERT' else 'EDGE' if mode == 'EDGE' else 'FACE'}\n" +
      "result = {'mode': mode}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set mesh selection mode failed: ${err.message}`);
  }
}

export async function blenderExtrudeSelection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; amount?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const amount = input.amount ?? [0, 0, 1];
    const res = await client.sendExecute(
      "import bpy, bmesh\n" +
      "from mathutils import Vector\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Object not found or not a mesh: ' + object_name)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "selected = [v for v in bm.verts if v.select]\n" +
      "selected_faces = [f for f in bm.faces if f.select]\n" +
      "if not selected:\n" +
      "    raise RuntimeError('Nothing selected to extrude')\n" +
      `geom = bmesh.ops.extrude_face_region(bm, geom=selected + selected_faces)\n` +
      `vec = Vector(${JSON.stringify(amount)})\n` +
      "inv_mat = obj.matrix_world.inverted().to_3x3()\n" +
      "for v in geom['geom']:\n" +
      "    if isinstance(v, bmesh.types.BMVert):\n" +
      "        v.co += inv_mat @ vec\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'object': obj.name, 'extruded_verts': len(selected)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Extrude selection failed: ${err.message}`);
  }
}

export async function blenderBevelSelection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; amount?: number; segments?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const amount = input.amount ?? 0.05;
    const segments = input.segments ?? 1;
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      `bmesh.ops.bevel(bm, geom=[v for v in bm.verts if v.select] + [e for e in bm.edges if e.select] + [f for f in bm.faces if f.select], offset=${amount}, segments=${segments}, affect='VERTICES')\n` +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'object': obj.name, 'amount': " + JSON.stringify(amount) + ", 'segments': " + JSON.stringify(segments) + "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Bevel selection failed: ${err.message}`);
  }
}

export async function blenderLoopCut(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; cuts?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const cuts = Math.max(1, input.cuts ?? 1);
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      `bpy.ops.mesh.loopcut_slide(number_cuts=${cuts})\n` +
      "result = {'object': obj.name, 'cuts': " + JSON.stringify(cuts) + "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Loop cut failed: ${err.message}`);
  }
}

export async function blenderSubdivide(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; cuts?: number; smooth?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const cuts = Math.max(1, input.cuts ?? 1);
    const smooth = input.smooth ?? 0;
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      "bpy.ops.mesh.subdivide(number_cuts=" + JSON.stringify(cuts) + ", smooth=" + JSON.stringify(smooth) + ")\n" +
      "result = {'object': obj.name, 'cuts': " + JSON.stringify(cuts) + "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Subdivide failed: ${err.message}`);
  }
}

export async function blenderMergeByDistance(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; distance?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const distance = input.distance ?? 0.001;
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "bpy.ops.mesh.remove_doubles(threshold=" + JSON.stringify(distance) + ")\n" +
      "result = {'object': obj.name, 'distance': " + JSON.stringify(distance) + "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Merge by distance failed: ${err.message}`);
  }
}

export async function blenderRecalculateNormals(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "bpy.ops.mesh.normals_make_consistent(inside=False)\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'object': obj.name, 'normals': 'recalculated'}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Recalculate normals failed: ${err.message}`);
  }
}

export async function blenderFlipNormals(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      "bpy.ops.mesh.flip_normals()\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'object': obj.name, 'normals': 'flipped'}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Flip normals failed: ${err.message}`);
  }
}

export async function blenderTriangulateFaces(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "bpy.ops.mesh.quads_convert_to_tris(quad_method='BEAUTY', ngon_method='BEAUTY')\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'object': obj.name, 'faces': 'triangulated'}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Triangulate faces failed: ${err.message}`);
  }
}

export async function blenderInsetFaces(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; thickness?: number; depth?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const thickness = input.thickness ?? 0.05;
    const depth = input.depth ?? 0;
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      "bpy.ops.mesh.inset(thickness=" + JSON.stringify(thickness) + ", depth=" + JSON.stringify(depth) + ", use_individual=True)\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'object': obj.name, 'thickness': " + JSON.stringify(thickness) + "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Inset faces failed: ${err.message}`);
  }
}

export async function blenderDeleteLooseGeometry(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "bpy.ops.mesh.delete_loose()\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'object': obj.name, 'loose': 'deleted'}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Delete loose geometry failed: ${err.message}`);
  }
}

export async function blenderFixNonManifold(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "bpy.ops.mesh.select_non_manifold()\n" +
      "selected = len([v for v in bm.verts if v.select])\n" +
      "result = {'object': obj.name, 'non_manifold_verts': selected}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Fix non-manifold failed: ${err.message}`);
  }
}

export async function blenderSetFaceSmoothing(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; smooth?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const smooth = input.smooth ?? true;
    const res = await client.sendExecute(
      meshEditPrologue(input.objectName) +
      `for face in bm.faces:\n    face.smooth = ${smooth ? "True" : "False"}\n` +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'object': obj.name, 'smooth': " + JSON.stringify(smooth) + "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set face smoothing failed: ${err.message}`);
  }
}

// ─── Modifiers ──────────────────────────────────────────────────────────────

export async function blenderAddModifier(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; modifierType: string; name?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const name = input.name ?? input.modifierType;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `modifier_type = ${JSON.stringify(input.modifierType)}\n` +
      `modifier_name = ${JSON.stringify(name)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "try:\n" +
      "    mod = obj.modifiers.new(modifier_name, modifier_type)\n" +
      "except Exception as exc:\n" +
      "    raise RuntimeError('Unsupported modifier type: ' + modifier_type + ' - ' + str(exc))\n" +
      "result = {'object': obj.name, 'modifier': mod.name, 'type': mod.type}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Add modifier failed: ${err.message}`);
  }
}

export async function blenderRemoveModifier(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; modifierName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `modifier_name = ${JSON.stringify(input.modifierName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "mod = obj.modifiers.get(modifier_name)\n" +
      "if mod is None:\n" +
      "    raise RuntimeError('Modifier not found: ' + modifier_name)\n" +
      "obj.modifiers.remove(mod)\n" +
      "result = {'object': obj.name, 'removed': modifier_name, 'remaining': [m.name for m in obj.modifiers]}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Remove modifier failed: ${err.message}`);
  }
}

export async function blenderApplyModifier(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; modifierName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `modifier_name = ${JSON.stringify(input.modifierName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "mod = obj.modifiers.get(modifier_name)\n" +
      "if mod is None:\n" +
      "    raise RuntimeError('Modifier not found: ' + modifier_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "bpy.ops.object.modifier_apply(modifier=modifier_name)\n" +
      "result = {'object': obj.name, 'applied': modifier_name, 'remaining': [m.name for m in obj.modifiers]}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Apply modifier failed: ${err.message}`);
  }
}

// ─── Materials ──────────────────────────────────────────────────────────────

export async function blenderCreateMaterial(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name: string; color?: number[]; roughness?: number; metallic?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const color = input.color ? `(${input.color.slice(0, 4).map((v) => v ?? 1).join(", ")})` : "(0.8, 0.8, 0.8, 1)";
    const roughness = input.roughness ?? 0.5;
    const metallic = input.metallic ?? 0;
    const res = await client.sendExecute(
      "import bpy\n" +
      `mat_name = ${JSON.stringify(input.name)}\n` +
      `color = ${color}\n` +
      `roughness = ${roughness}\n` +
      `metallic = ${metallic}\n` +
      "mat = bpy.data.materials.get(mat_name)\n" +
      "if mat is None:\n" +
      "    mat = bpy.data.materials.new(mat_name)\n" +
      "mat.use_nodes = True\n" +
      "bsdf = mat.node_tree.nodes.get('Principled BSDF')\n" +
      "if bsdf:\n" +
      "    bsdf.inputs['Base Color'].default_value = color\n" +
      "    bsdf.inputs['Roughness'].default_value = roughness\n" +
      "    bsdf.inputs['Metallic'].default_value = metallic\n" +
      "result = {'name': mat.name, 'color': list(mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value) if 'Principled BSDF' in mat.node_tree.nodes else None, 'users': mat.users}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create material failed: ${err.message}`);
  }
}

export async function blenderAssignMaterial(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; materialName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `material_name = ${JSON.stringify(input.materialName)}\n` +
      "mat = bpy.data.materials.get(material_name)\n" +
      "if mat is None:\n" +
      "    raise RuntimeError('Material not found: ' + material_name)\n" +
      "assigned = []\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj is None or obj.type != 'MESH':\n" +
      "        continue\n" +
      "    if not obj.data.materials:\n" +
      "        obj.data.materials.append(mat)\n" +
      "    else:\n" +
      "        obj.data.materials[0] = mat\n" +
      "    assigned.append(obj.name)\n" +
      "result = {'assigned': assigned, 'material': mat.name, 'count': len(assigned)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Assign material failed: ${err.message}`);
  }
}

export async function blenderListMaterials(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "result = {'materials': [{'name': m.name, 'users': m.users, 'use_nodes': m.use_nodes} for m in bpy.data.materials], 'count': len(bpy.data.materials)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`List materials failed: ${err.message}`);
  }
}

export async function blenderRenameMaterial(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; materialName: string; newName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `material_name = ${JSON.stringify(input.materialName)}\n` +
      `new_name = ${JSON.stringify(input.newName)}\n` +
      "mat = bpy.data.materials.get(material_name)\n" +
      "if mat is None:\n" +
      "    raise RuntimeError('Material not found: ' + material_name)\n" +
      "mat.name = new_name\n" +
      "result = {'old_name': material_name, 'new_name': mat.name}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Rename material failed: ${err.message}`);
  }
}

export async function blenderDuplicateMaterial(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; materialName: string; newName?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `material_name = ${JSON.stringify(input.materialName)}\n` +
      `new_name = ${JSON.stringify(input.newName ?? "")}\n` +
      "mat = bpy.data.materials.get(material_name)\n" +
      "if mat is None:\n" +
      "    raise RuntimeError('Material not found: ' + material_name)\n" +
      "dup = mat.copy()\n" +
      "if new_name:\n" +
      "    dup.name = new_name\n" +
      "result = {'source': mat.name, 'duplicate': dup.name}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Duplicate material failed: ${err.message}`);
  }
}

export async function blenderRemoveUnusedMaterials(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "removed = []\n" +
      "for mat in list(bpy.data.materials):\n" +
      "    if mat.users == 0:\n" +
      "        removed.append(mat.name)\n" +
      "        bpy.data.materials.remove(mat)\n" +
      "result = {'removed': removed, 'count': len(removed)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Remove unused materials failed: ${err.message}`);
  }
}

// ─── Viewport ───────────────────────────────────────────────────────────────

export async function blenderFrameAll(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      VIEW3D_HELPER +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    bpy.ops.view3d.view_all(use_all_regions=False)\n" +
      "result = {'framed': 'all'}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Frame all failed: ${err.message}`);
  }
}

export async function blenderToggleXray(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; enabled?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const enabled = input.enabled;
    const res = await client.sendExecute(
      "import bpy\n" +
      VIEW3D_HELPER +
      "window, screen, area, region, space = _view3d_context()\n" +
      `if ${enabled === undefined ? "True" : "False"}:\n` +
      `    space.shading.show_xray = not space.shading.show_xray\n` +
      "else:\n" +
      `    space.shading.show_xray = ${enabled ? "True" : "False"}\n` +
      "result = {'xray': space.shading.show_xray}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Toggle X-ray failed: ${err.message}`);
  }
}

export async function blenderToggleOverlays(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; enabled?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const enabled = input.enabled;
    const res = await client.sendExecute(
      "import bpy\n" +
      VIEW3D_HELPER +
      "window, screen, area, region, space = _view3d_context()\n" +
      `if ${enabled === undefined ? "True" : "False"}:\n` +
      `    space.overlay.show_overlays = not space.overlay.show_overlays\n` +
      "else:\n" +
      `    space.overlay.show_overlays = ${enabled ? "True" : "False"}\n` +
      "result = {'overlays': space.overlay.show_overlays}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Toggle overlays failed: ${err.message}`);
  }
}

export async function blenderToggleLocalView(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; enable?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const enable = input.enable;
    const res = await client.sendExecute(
      "import bpy\n" +
      VIEW3D_HELPER +
      "window, screen, area, region, space = _view3d_context()\n" +
      "was_local = space.local_view is not None\n" +
      `if ${enable === undefined ? "True" : "False"}:\n` +
      "    bpy.ops.object.local_view_override()\n" +
      "else:\n" +
      `    if ${enable ? "True" : "False"} and not was_local:\n` +
      "        bpy.ops.object.local_view_override()\n" +
      `    elif not ${enable ? "True" : "False"} and was_local:\n` +
      "        bpy.ops.object.local_view_override()\n" +
      "result = {'local_view': space.local_view is not None}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Toggle local view failed: ${err.message}`);
  }
}

// ─── File & Export ──────────────────────────────────────────────────────────

export async function blenderExportFbx(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filepath: string; applyScale?: string; useSelected?: boolean },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const absPath = registry.resolveArtifactPath(workspace, input.filepath, "blender");
    await mkdir(dirname(absPath), { recursive: true });
    const client = getBlenderClient(input.workspaceId);
    const applyScale = input.applyScale ?? "FBX_SCALE_NONE";
    const useSelected = input.useSelected ?? false;
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.export_scene.fbx(filepath=${JSON.stringify(absPath)}, use_selection=${useSelected ? "True" : "False"}, apply_scale_options=${JSON.stringify(applyScale)})\n` +
      `result = {'exported': ${JSON.stringify(absPath)}}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Export FBX failed: ${err.message}`);
  }
}

export async function blenderExportObj(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filepath: string; useSelected?: boolean },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const absPath = registry.resolveArtifactPath(workspace, input.filepath, "blender");
    await mkdir(dirname(absPath), { recursive: true });
    const client = getBlenderClient(input.workspaceId);
    const useSelected = input.useSelected ?? false;
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.wm.obj_export(filepath=${JSON.stringify(absPath)}, export_selected_objects=${useSelected ? "True" : "False"})\n` +
      `result = {'exported': ${JSON.stringify(absPath)}}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Export OBJ failed: ${err.message}`);
  }
}

export async function blenderPurgeUnusedData(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "bpy.ops.outliner.orphans_purge()\n" +
      "result = {'purged': 'orphan data blocks removed'}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Purge unused data failed: ${err.message}`);
  }
}

// ─── Animation ──────────────────────────────────────────────────────────────

export async function blenderSetFrame(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; frame: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.context.scene.frame_set(${input.frame})\n` +
      "result = {'frame': bpy.context.scene.frame_current}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set frame failed: ${err.message}`);
  }
}

export async function blenderPlayAnimation(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "if bpy.context.screen:\n" +
      "    bpy.ops.screen.animation_play()\n" +
      "result = {'playing': True}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Play animation failed: ${err.message}`);
  }
}

export async function blenderStopAnimation(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "if bpy.context.screen and bpy.context.screen.is_animation_playing:\n" +
      "    bpy.ops.screen.animation_play()\n" +
      "result = {'playing': False}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Stop animation failed: ${err.message}`);
  }
}

export async function blenderInsertKeyframe(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; properties?: string[]; frame?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const props = input.properties ?? ["location", "rotation_euler", "scale"];
    const frame = input.frame;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `properties = ${JSON.stringify(props)}\n` +
      `frame = ${frame ?? "None"}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if frame is not None:\n" +
      "    bpy.context.scene.frame_set(frame)\n" +
      "for prop in properties:\n" +
      "    if hasattr(obj, prop):\n" +
      "        obj.keyframe_insert(data_path=prop)\n" +
      "result = {'object': obj.name, 'keyframed': [p for p in properties if hasattr(obj, p)], 'frame': bpy.context.scene.frame_current}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Insert keyframe failed: ${err.message}`);
  }
}
