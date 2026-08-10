const GROUP_KEYWORDS: ReadonlyArray<{ group: string; keywords: readonly string[] }> = [
  { group: "Model", keywords: ["create_", "add_", "primitive", "cube", "sphere", "cylinder", "cone", "plane", "circle", "torus", "grid", "monkey", "curve", "text", "empty", "metaball", "mesh", "extrude", "bevel", "loop", "subdivide", "merge", "knife", "dissolve", "inset", "triangulate", "smooth", "shade", "edge", "face", "vertex", "modifier", "boolean", "solidify", "array", "mirror_modifier", "skin", "lattice", "geometry_nodes", "convex_hull", "decimate", "remesh"] },
  { group: "Animation", keywords: ["animation", "keyframe", "key_frame", "armature", "bone", "rig", "action", "timeline", "play", "frame", "pose", "bone_constraint", "driver", "fcurve", "shape_key", "shapekey", "lattice_animate"] },
  { group: "Materials & Shading", keywords: ["material", "shader", "shading", "texture", "node", "bsdf", "principled", "uv", "lightmap", "image_texture", "color_ramp", "mix"] },
  { group: "Geometry Nodes", keywords: ["geometry_nodes", "gn_", "geo_node", "node_group"] },
  { group: "Viewport & Camera", keywords: ["viewport", "camera", "view", "orbit", "pan", "zoom", "frame_selected", "frame_all", "shading_mode", "xray", "overlay", "local_view", "look", "pov"] },
  { group: "Scene & File", keywords: ["scene", "file", "open", "save", "checkpoint", "collection", "layer", "world", "current_file"] },
  { group: "Selection", keywords: ["select", "deselect", "invert", "select_all"] },
  { group: "Rendering", keywords: ["render", "cycles", "eevee", "resolution", "output", "image", "compositor"] },
  { group: "Export & Import", keywords: ["export", "import", "glb", "fbx", "obj", "stl", "ply", "usd", "dae", "alembic"] },
  { group: "Utilities", keywords: ["ping", "inspect", "audit", "console", "status", "execute", "python", "purge", "cleanup", "recovery", "context", "info", "list", "get_", "set_"] },
];

export interface ToolGroupEntry {
  name: string;
  group: string;
}

export function groupForTool(name: string): string {
  for (const { group, keywords } of GROUP_KEYWORDS) {
    if (keywords.some((keyword) => name.includes(keyword))) return group;
  }
  return "Other";
}

export function groupToolsByName(names: Iterable<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const group = groupForTool(name);
    const list = groups.get(group) ?? [];
    list.push(name);
    groups.set(group, list);
  }
  return groups;
}
