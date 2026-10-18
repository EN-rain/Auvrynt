import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";
import { registerCatalogTools } from "../../integrations/blender/blender-catalog.js";
import { sceneCatalogTools } from "../../integrations/blender/blender-catalog-scene.js";
import { selectCatalogTools } from "../../integrations/blender/blender-catalog-select.js";
import { meshCatalogTools } from "../../integrations/blender/blender-catalog-mesh.js";
import { objectCatalogTools } from "../../integrations/blender/blender-catalog-object.js";
import {
  blenderPing,
  blenderGetSceneInfo,
  blenderGetSceneAudit,
  blenderGetSelection,
  blenderGetActiveModeAndStatus,
  blenderInspectObject,
  blenderCreateCube,
  blenderSelectObject,
  blenderSelectObjects,
  blenderTransformObject,
  blenderDuplicateLinked,
  blenderJoinObjects,
  blenderDeleteObjects,
  blenderCreateCollection,
  blenderMoveToCollection,
  blenderSetViewportView,
  blenderOrbitViewport,
  blenderPanViewport,
  blenderZoomViewport,
  blenderFrameSelected,
  blenderSetViewportShading,
  blenderInspectMaterial,
  blenderInspectGeometryNodes,
  blenderEditModifier,
  blenderSetRenderSettings,
  blenderRenderCamera,
  blenderRenderObjectIsolation,
  blenderRenderViewport,
  blenderSaveCheckpoint,
  blenderListCheckpoints,
  blenderRollbackCheckpoint,
  blenderExecutePython,
  blenderGetCurrentFile,
  blenderOpenFile,
  blenderSaveFile,
  blenderSaveFileAs,
  blenderExportGlb,
  blenderCreatePlane,
  blenderCreateCircle,
  blenderCreateCylinder,
  blenderCreateCone,
  blenderCreateSphere,
  blenderCreateIcosphere,
  blenderCreateTorus,
  blenderCreateGrid,
  blenderCreateMonkey,
  blenderCreateCamera,
  blenderCreateLight,
  blenderCreateEmpty,
  blenderCreateText,
  blenderCreateCurve,
  blenderCreateArmature,
  blenderCreateMetaball,
  blenderRenameObject,
  blenderDuplicateObject,
  blenderParentObject,
  blenderUnparentObject,
  blenderHideObjects,
  blenderShowAllObjects,
  blenderSetOrigin,
  blenderApplyTransforms,
  blenderClearTransforms,
  blenderMirrorObjects,
  blenderSetCursorLocation,
  blenderSelectByType,
  blenderSelectLinked,
  blenderSelectByCollection,
  blenderSelectByMaterial,
  blenderSelectByPolycount,
  blenderInvertSelection,
  blenderDeselectAll,
  blenderSelectAll,
  blenderEnterEditMode,
  blenderExitEditMode,
  blenderSetMeshSelectionMode,
  blenderExtrudeSelection,
  blenderBevelSelection,
  blenderLoopCut,
  blenderSubdivide,
  blenderMergeByDistance,
  blenderRecalculateNormals,
  blenderFlipNormals,
  blenderTriangulateFaces,
  blenderInsetFaces,
  blenderDeleteLooseGeometry,
  blenderFixNonManifold,
  blenderSetFaceSmoothing,
  blenderAddModifier,
  blenderRemoveModifier,
  blenderApplyModifier,
  blenderCreateMaterial,
  blenderAssignMaterial,
  blenderListMaterials,
  blenderRenameMaterial,
  blenderDuplicateMaterial,
  blenderRemoveUnusedMaterials,
  blenderFrameAll,
  blenderToggleXray,
  blenderToggleOverlays,
  blenderToggleLocalView,
  blenderExportFbx,
  blenderExportObj,
  blenderPurgeUnusedData,
  blenderSetFrame,
  blenderPlayAnimation,
  blenderStopAnimation,
  blenderInsertKeyframe,
} from "../../integrations/blender/blender-tools.js";

export function registerBlenderTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
): void {
  registerAppTool(server, "blender_ping", {
    title: "Blender Ping",
    description: "Verify local Blender connection is reachable, returning version and active scene status.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderPing(workspaces, { workspaceId }));

  registerAppTool(server, "blender_get_scene_info", {
    title: "Get Blender Scene Info",
    description: "Return current active scene properties, frame, and list of objects.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetSceneInfo(workspaces, { workspaceId }));

  registerAppTool(server, "blender_get_scene_audit", {
    title: "Blender Low-Poly Scene Audit",
    description: "Audit scene configuration for low-poly budgets, duplicate assets, and non-manifold mesh objects.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      includeHidden: z.boolean().optional(),
      includeInstances: z.boolean().optional(),
      includeMaterials: z.boolean().optional(),
      includeImages: z.boolean().optional(),
      includeModifiers: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderGetSceneAudit(workspaces, input));

  registerAppTool(server, "blender_get_selection", {
    title: "Get Selected Objects",
    description: "List currently selected objects, active object, and Blender interaction mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetSelection(workspaces, { workspaceId }));

  registerAppTool(server, "blender_get_active_mode_and_status", {
    title: "Get active mode",
    description: "Check selection mode, rendering engine, and whether animation is playing.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetActiveModeAndStatus(workspaces, { workspaceId }));

  registerAppTool(server, "blender_inspect_object", {
    title: "Inspect Blender Object",
    description: "Inspect specific object mesh details, applied modifiers, parent/child state, and materials.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderInspectObject(workspaces, input));

  registerAppTool(server, "blender_create_cube", {
    title: "Create Blender Cube",
    description: "Create a primitive cube mesh at location.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), size: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCube(workspaces, input));

  registerAppTool(server, "blender_select_object", {
    title: "Select Object",
    description: "Select a single object and optionally set interaction mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), mode: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectObject(workspaces, input));

  registerAppTool(server, "blender_select_objects", {
    title: "Select Objects",
    description: "Select multiple objects by wildcard name, type, collection, or material.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, pattern: z.string().optional(), objectType: z.string().optional(), collection: z.string().optional(), material: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectObjects(workspaces, input));

  registerAppTool(server, "blender_transform_object", {
    title: "Transform Object",
    description: "Set object local translation, scale, or Euler rotation settings.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), location: z.array(z.number()).optional(), rotationEuler: z.array(z.number()).optional(), scale: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderTransformObject(workspaces, input));

  registerAppTool(server, "blender_duplicate_linked", {
    title: "Duplicate Linked",
    description: "Create linked duplicates of objects.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), offset: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderDuplicateLinked(workspaces, input));

  registerAppTool(server, "blender_join_objects", {
    title: "Join Objects",
    description: "Join selected mesh objects into one mesh container.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), resultName: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderJoinObjects(workspaces, input));

  registerAppTool(server, "blender_delete_objects", {
    title: "Delete Objects",
    description: "Remove objects from data dictionary completely.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()) },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderDeleteObjects(workspaces, input));

  registerAppTool(server, "blender_create_collection", {
    title: "Create Collection",
    description: "Create collection node under hierarchy.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string(), parent: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCollection(workspaces, input));

  registerAppTool(server, "blender_move_to_collection", {
    title: "Move Objects to Collection",
    description: "Move objects to collection and optionally unlink from parent.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), collectionName: z.string(), unlinkFromOthers: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderMoveToCollection(workspaces, input));

  registerAppTool(server, "blender_set_viewport_view", {
    title: "Set Viewport View",
    description: "Orient 3D viewport camera view angles.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, view: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetViewportView(workspaces, input));

  registerAppTool(server, "blender_orbit_viewport", {
    title: "Orbit Viewport",
    description: "Orbit camera.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, direction: z.string().optional(), steps: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderOrbitViewport(workspaces, input));

  registerAppTool(server, "blender_pan_viewport", {
    title: "Pan Viewport",
    description: "Pan camera.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, direction: z.string().optional(), steps: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderPanViewport(workspaces, input));

  registerAppTool(server, "blender_zoom_viewport", {
    title: "Zoom Viewport",
    description: "Zoom camera.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, direction: z.string().optional(), steps: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderZoomViewport(workspaces, input));

  registerAppTool(server, "blender_frame_selected", {
    title: "Frame Selected",
    description: "Align view to frame selected elements.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderFrameSelected(workspaces, { workspaceId }));

  registerAppTool(server, "blender_set_viewport_shading", {
    title: "Set Viewport Shading",
    description: "Modify view display shading mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, mode: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetViewportShading(workspaces, input));

  registerAppTool(server, "blender_inspect_material", {
    title: "Inspect Material",
    description: "Get material setup details.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, materialName: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderInspectMaterial(workspaces, input));

  registerAppTool(server, "blender_inspect_geometry_nodes", {
    title: "Inspect Geometry Nodes",
    description: "Inspect modifier setup.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderInspectGeometryNodes(workspaces, input));

  registerAppTool(server, "blender_edit_modifier", {
    title: "Edit Modifier Parameters",
    description: "Modify simple modifier settings.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), modifierName: z.string(), properties: z.record(z.string(), z.unknown()) },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderEditModifier(workspaces, input));

  registerAppTool(server, "blender_set_render_settings", {
    title: "Set Render Settings",
    description: "Alter render properties.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, engine: z.string().optional(), width: z.number().optional(), height: z.number().optional(), samples: z.number().optional(), denoise: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetRenderSettings(workspaces, input));

  registerAppTool(server, "blender_render_camera", {
    title: "Render Camera",
    description: "Generate render image output for active camera.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, cameraName: z.string().optional(), width: z.number().optional(), height: z.number().optional(), samples: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRenderCamera(workspaces, input));

  registerAppTool(server, "blender_render_object_isolation", {
    title: "Render Object Isolation",
    description: "Isolate object render.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), width: z.number().optional(), height: z.number().optional(), samples: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRenderObjectIsolation(workspaces, input));

  registerAppTool(server, "blender_render_viewport", {
    title: "Render Viewport Screenshot",
    description: "Capture screenshot of Blender window.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, width: z.number().optional(), height: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRenderViewport(workspaces, input));

  registerAppTool(server, "blender_save_checkpoint", {
    title: "Save Checkpoint",
    description: "Save snapshot of active work session.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, label: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSaveCheckpoint(workspaces, input));

  registerAppTool(server, "blender_list_checkpoints", {
    title: "List Blender Checkpoints",
    description: "List all saved Blender session checkpoint files.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderListCheckpoints(workspaces, { workspaceId }));

  registerAppTool(server, "blender_rollback_checkpoint", {
    title: "Rollback Checkpoint",
    description: "Open past checkpoint file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, path: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRollbackCheckpoint(workspaces, input));

  registerAppTool(server, "blender_execute_python", {
    title: "Execute python",
    description: "Run custom Python script on active Blender session.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, code: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderExecutePython(workspaces, input));

  registerAppTool(server, "blender_get_current_file", {
    title: "Get current blend file",
    description: "Retrieve current file path.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetCurrentFile(workspaces, { workspaceId }));

  registerAppTool(server, "blender_open_file", {
    title: "Open blend file",
    description: "Load project blend file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, filepath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderOpenFile(workspaces, input));

  registerAppTool(server, "blender_save_file", {
    title: "Save blend file",
    description: "Overwrites current active blend file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderSaveFile(workspaces, { workspaceId }));

  registerAppTool(server, "blender_save_file_as", {
    title: "Save blend file as",
    description: "Save active session to new file path.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, filepath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSaveFileAs(workspaces, input));

  registerAppTool(server, "blender_export_glb", {
    title: "Export GLB asset",
    description: "Generate GLB 3D scene file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, filepath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderExportGlb(workspaces, input));

  // ─── Extended toolset ────────────────────────────────────────────────────

  registerAppTool(server, "blender_create_plane", {
    title: "Create Plane",
    description: "Create a plane primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), size: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreatePlane(workspaces, input));

  registerAppTool(server, "blender_create_circle", {
    title: "Create Circle",
    description: "Create a circle primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, vertices: z.number().optional(), radius: z.number().optional(), fillType: z.enum(["NGON", "TRIFAN", "NOTHING"]).optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCircle(workspaces, input));

  registerAppTool(server, "blender_create_cylinder", {
    title: "Create Cylinder",
    description: "Create a cylinder primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, vertices: z.number().optional(), radius: z.number().optional(), depth: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCylinder(workspaces, input));

  registerAppTool(server, "blender_create_cone", {
    title: "Create Cone",
    description: "Create a cone primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, vertices: z.number().optional(), radius1: z.number().optional(), radius2: z.number().optional(), depth: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCone(workspaces, input));

  registerAppTool(server, "blender_create_sphere", {
    title: "Create UV Sphere",
    description: "Create a UV sphere primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, segments: z.number().optional(), ringCount: z.number().optional(), radius: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateSphere(workspaces, input));

  registerAppTool(server, "blender_create_icosphere", {
    title: "Create Icosphere",
    description: "Create an icosphere primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, subdivisions: z.number().optional(), radius: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateIcosphere(workspaces, input));

  registerAppTool(server, "blender_create_torus", {
    title: "Create Torus",
    description: "Create a torus primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, majorRadius: z.number().optional(), minorRadius: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateTorus(workspaces, input));

  registerAppTool(server, "blender_create_grid", {
    title: "Create Grid",
    description: "Create a grid primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, xSegments: z.number().optional(), ySegments: z.number().optional(), size: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateGrid(workspaces, input));

  registerAppTool(server, "blender_create_monkey", {
    title: "Create Monkey",
    description: "Create a Suzanne monkey primitive mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, size: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateMonkey(workspaces, input));

  registerAppTool(server, "blender_create_camera", {
    title: "Create Camera",
    description: "Create a camera object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), location: z.array(z.number()).optional(), rotation: z.array(z.number()).optional(), lens: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCamera(workspaces, input));

  registerAppTool(server, "blender_create_light", {
    title: "Create Light",
    description: "Create a light object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), lightType: z.enum(["POINT", "SUN", "SPOT", "AREA"]).optional(), energy: z.number().optional(), color: z.array(z.number()).optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateLight(workspaces, input));

  registerAppTool(server, "blender_create_empty", {
    title: "Create Empty",
    description: "Create an empty object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), emptyType: z.string().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateEmpty(workspaces, input));

  registerAppTool(server, "blender_create_text", {
    title: "Create Text",
    description: "Create a text object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), content: z.string().optional(), size: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateText(workspaces, input));

  registerAppTool(server, "blender_create_curve", {
    title: "Create Curve",
    description: "Create a bezier curve object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCurve(workspaces, input));

  registerAppTool(server, "blender_create_armature", {
    title: "Create Armature",
    description: "Create an armature with a single bone.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateArmature(workspaces, input));

  registerAppTool(server, "blender_create_metaball", {
    title: "Create Metaball",
    description: "Create a metaball primitive.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), radius: z.number().optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateMetaball(workspaces, input));

  // Object operations
  registerAppTool(server, "blender_rename_object", {
    title: "Rename Object",
    description: "Rename an object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), newName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRenameObject(workspaces, input));

  registerAppTool(server, "blender_duplicate_object", {
    title: "Duplicate Object",
    description: "Duplicate objects (linked, normal, or instance).",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), duplicateType: z.string().optional(), offset: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderDuplicateObject(workspaces, input));

  registerAppTool(server, "blender_parent_object", {
    title: "Parent Object",
    description: "Parent objects under a parent object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, childNames: z.array(z.string()), parentName: z.string(), keepTransform: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderParentObject(workspaces, input));

  registerAppTool(server, "blender_unparent_object", {
    title: "Unparent Object",
    description: "Clear object parent relationships.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), keepTransform: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderUnparentObject(workspaces, input));

  registerAppTool(server, "blender_hide_objects", {
    title: "Hide Objects",
    description: "Hide or unhide objects in the viewport.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), hide: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderHideObjects(workspaces, input));

  registerAppTool(server, "blender_show_all_objects", {
    title: "Show All Objects",
    description: "Unhide all objects across the scene.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderShowAllObjects(workspaces, input));

  registerAppTool(server, "blender_set_origin", {
    title: "Set Object Origin",
    description: "Set an object's origin to geometry, center of mass, cursor, or a location.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), origin: z.enum(["geometry", "center", "cursor"]).optional(), location: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetOrigin(workspaces, input));

  registerAppTool(server, "blender_apply_transforms", {
    title: "Apply Transforms",
    description: "Apply location, rotation, and/or scale to objects.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), location: z.boolean().optional(), rotation: z.boolean().optional(), scale: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderApplyTransforms(workspaces, input));

  registerAppTool(server, "blender_clear_transforms", {
    title: "Clear Transforms",
    description: "Reset object transforms.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), location: z.boolean().optional(), rotation: z.boolean().optional(), scale: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderClearTransforms(workspaces, input));

  registerAppTool(server, "blender_mirror_objects", {
    title: "Mirror Objects",
    description: "Mirror objects along global axes.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), axis: z.array(z.enum(["X", "Y", "Z"])).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderMirrorObjects(workspaces, input));

  registerAppTool(server, "blender_set_cursor_location", {
    title: "Set Cursor",
    description: "Set the 3D cursor location.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, location: z.array(z.number()) },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetCursorLocation(workspaces, input));

  // Selection
  registerAppTool(server, "blender_select_by_type", {
    title: "Select by Type",
    description: "Select all objects of a given type.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectType: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectByType(workspaces, input));

  registerAppTool(server, "blender_select_linked", {
    title: "Select Linked",
    description: "Select all objects sharing data with the given object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectLinked(workspaces, input));

  registerAppTool(server, "blender_select_by_collection", {
    title: "Select by Collection",
    description: "Select all objects in a collection.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, collectionName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectByCollection(workspaces, input));

  registerAppTool(server, "blender_select_by_material", {
    title: "Select by Material",
    description: "Select all objects using a given material.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, materialName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectByMaterial(workspaces, input));

  registerAppTool(server, "blender_select_by_polycount", {
    title: "Select by Polycount",
    description: "Select mesh objects within a triangle-count range.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, maxTriangles: z.number().optional(), minTriangles: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectByPolycount(workspaces, input));

  registerAppTool(server, "blender_invert_selection", {
    title: "Invert Selection",
    description: "Invert the current object selection.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderInvertSelection(workspaces, input));

  registerAppTool(server, "blender_deselect_all", {
    title: "Deselect All",
    description: "Clear the object selection.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderDeselectAll(workspaces, input));

  registerAppTool(server, "blender_select_all", {
    title: "Select All",
    description: "Select all objects.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectAll(workspaces, input));

  // Mesh edit mode
  registerAppTool(server, "blender_enter_edit_mode", {
    title: "Enter Edit Mode",
    description: "Enter OBJECT/EDIT mode for an object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderEnterEditMode(workspaces, input));

  registerAppTool(server, "blender_exit_edit_mode", {
    title: "Exit Edit Mode",
    description: "Return to OBJECT mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderExitEditMode(workspaces, input));

  registerAppTool(server, "blender_set_mesh_selection_mode", {
    title: "Set Mesh Selection Mode",
    description: "Set edit-mode selection to VERT, EDGE, or FACE.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, mode: z.enum(["VERT", "EDGE", "FACE"]).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetMeshSelectionMode(workspaces, input));

  registerAppTool(server, "blender_extrude_selection", {
    title: "Extrude Selection",
    description: "Extrude the selected geometry.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), amount: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderExtrudeSelection(workspaces, input));

  registerAppTool(server, "blender_bevel_selection", {
    title: "Bevel Selection",
    description: "Bevel selected vertices.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), amount: z.number().optional(), segments: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderBevelSelection(workspaces, input));

  registerAppTool(server, "blender_loop_cut", {
    title: "Loop Cut",
    description: "Add a loop cut to a mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), cuts: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderLoopCut(workspaces, input));

  registerAppTool(server, "blender_subdivide", {
    title: "Subdivide",
    description: "Subdivide the mesh.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), cuts: z.number().optional(), smooth: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSubdivide(workspaces, input));

  registerAppTool(server, "blender_merge_by_distance", {
    title: "Merge by Distance",
    description: "Remove doubled vertices in edit mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), distance: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderMergeByDistance(workspaces, input));

  registerAppTool(server, "blender_recalculate_normals", {
    title: "Recalculate Normals",
    description: "Recalculate face normals to face outward.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRecalculateNormals(workspaces, input));

  registerAppTool(server, "blender_flip_normals", {
    title: "Flip Normals",
    description: "Flip face normals.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderFlipNormals(workspaces, input));

  registerAppTool(server, "blender_triangulate_faces", {
    title: "Triangulate Faces",
    description: "Convert all faces to triangles.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderTriangulateFaces(workspaces, input));

  registerAppTool(server, "blender_inset_faces", {
    title: "Inset Faces",
    description: "Inset the selected faces.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), thickness: z.number().optional(), depth: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderInsetFaces(workspaces, input));

  registerAppTool(server, "blender_delete_loose_geometry", {
    title: "Delete Loose Geometry",
    description: "Delete loose vertices and geometry.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderDeleteLooseGeometry(workspaces, input));

  registerAppTool(server, "blender_fix_non_manifold", {
    title: "Select Non-Manifold",
    description: "Select non-manifold vertices in edit mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderFixNonManifold(workspaces, input));

  registerAppTool(server, "blender_set_face_smoothing", {
    title: "Set Face Smoothing",
    description: "Smooth or flat shade all faces.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), smooth: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetFaceSmoothing(workspaces, input));

  // Modifiers
  registerAppTool(server, "blender_add_modifier", {
    title: "Add Modifier",
    description: "Add a modifier to an object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), modifierType: z.string(), name: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderAddModifier(workspaces, input));

  registerAppTool(server, "blender_remove_modifier", {
    title: "Remove Modifier",
    description: "Remove a modifier from an object.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), modifierName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRemoveModifier(workspaces, input));

  registerAppTool(server, "blender_apply_modifier", {
    title: "Apply Modifier",
    description: "Apply a modifier to an object permanently.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), modifierName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderApplyModifier(workspaces, input));

  // Materials
  registerAppTool(server, "blender_create_material", {
    title: "Create Material",
    description: "Create a principled-material with base color, roughness, metallic.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string(), color: z.array(z.number()).optional(), roughness: z.number().optional(), metallic: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateMaterial(workspaces, input));

  registerAppTool(server, "blender_assign_material", {
    title: "Assign Material",
    description: "Assign a material to one or more objects.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), materialName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderAssignMaterial(workspaces, input));

  registerAppTool(server, "blender_list_materials", {
    title: "List Materials",
    description: "List all materials and their users.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderListMaterials(workspaces, input));

  registerAppTool(server, "blender_rename_material", {
    title: "Rename Material",
    description: "Rename a material.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, materialName: z.string(), newName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRenameMaterial(workspaces, input));

  registerAppTool(server, "blender_duplicate_material", {
    title: "Duplicate Material",
    description: "Duplicate a material.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, materialName: z.string(), newName: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderDuplicateMaterial(workspaces, input));

  registerAppTool(server, "blender_remove_unused_materials", {
    title: "Remove Unused Materials",
    description: "Remove materials with no users.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRemoveUnusedMaterials(workspaces, input));

  // Viewport
  registerAppTool(server, "blender_frame_all", {
    title: "Frame All",
    description: "Zoom out to frame the whole scene.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderFrameAll(workspaces, input));

  registerAppTool(server, "blender_toggle_xray", {
    title: "Toggle X-Ray",
    description: "Toggle or set viewport X-Ray transparency.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, enabled: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderToggleXray(workspaces, input));

  registerAppTool(server, "blender_toggle_overlays", {
    title: "Toggle Overlays",
    description: "Toggle or set viewport overlay visibility.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, enabled: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderToggleOverlays(workspaces, input));

  registerAppTool(server, "blender_toggle_local_view", {
    title: "Toggle Local View",
    description: "Toggle local view for selected objects.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, enable: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderToggleLocalView(workspaces, input));

  // Export & utility
  registerAppTool(server, "blender_export_fbx", {
    title: "Export FBX",
    description: "Export the scene to an FBX file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, filepath: z.string(), applyScale: z.enum(["FBX_SCALE_NONE", "FBX_SCALE_UNITS", "FBX_SCALE_CUSTOM", "FBX_SCALE_ALL"]).optional(), useSelected: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderExportFbx(workspaces, input));

  registerAppTool(server, "blender_export_obj", {
    title: "Export OBJ",
    description: "Export the scene to an OBJ file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, filepath: z.string(), useSelected: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderExportObj(workspaces, input));

  registerAppTool(server, "blender_purge_unused_data", {
    title: "Purge Unused Data",
    description: "Remove orphaned data blocks from the file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderPurgeUnusedData(workspaces, input));

  // Animation
  registerAppTool(server, "blender_set_frame", {
    title: "Set Frame",
    description: "Set the current animation frame.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, frame: z.number() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetFrame(workspaces, input));

  registerAppTool(server, "blender_play_animation", {
    title: "Play Animation",
    description: "Start animation playback.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderPlayAnimation(workspaces, input));

  registerAppTool(server, "blender_stop_animation", {
    title: "Stop Animation",
    description: "Stop animation playback.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderStopAnimation(workspaces, input));

  registerAppTool(server, "blender_insert_keyframe", {
    title: "Insert Keyframe",
    description: "Insert a keyframe on object properties.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), properties: z.array(z.enum(["location", "rotation_euler", "scale", "rotation_quaternion", "hide_viewport", "hide_render"])).optional(), frame: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderInsertKeyframe(workspaces, input));

  // ─── Bridge catalog tools (data-driven) ──────────────────────────────────
  const catalogTools = [
    ...sceneCatalogTools,
    ...selectCatalogTools,
    ...meshCatalogTools,
    ...objectCatalogTools,
  ];
  registerCatalogTools(
    server,
    config,
    workspaces,
    catalogTools.filter((tool) => !ALREADY_REGISTERED_BLENDER_TOOLS.has(tool.name)),
  );
}

const ALREADY_REGISTERED_BLENDER_TOOLS = new Set<string>([
  "blender_delete_loose_geometry",
  "blender_rename_object",
  "blender_delete_objects",
]);
