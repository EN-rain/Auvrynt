import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";
import {
  ROBLOX_OFFICIAL_TOOL_NAMES,
  robloxCall,
  robloxDisconnect,
  robloxListTools,
  robloxStatus,
} from "../../integrations/roblox/roblox-tools.js";
import {
  robloxClearTerrain,
  robloxCloneInstance,
  robloxCreateConstraint,
  robloxCreateGuiObject,
  robloxCreateInstance,
  robloxCreateModuleScript,
  robloxCreateRemoteEvent,
  robloxCreateRemoteFunction,
  robloxCreateScreenGui,
  robloxCreateSound,
  robloxDestroyInstance,
  robloxEnsurePostEffect,
  robloxFillTerrainBall,
  robloxFillTerrainRegion,
  robloxRenameInstance,
  robloxSetAttribute,
  robloxSetCollisionGroup,
  robloxSetCollisionGroupCollidable,
  robloxSetLighting,
  robloxSetParent,
  robloxSetProperties,
  robloxSetWorkspaceGravity,
} from "../../integrations/roblox/roblox-helpers.js";

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    isError,
  };
}

const datamodelTypeSchema = z.enum(["Edit", "Client", "Server"]).optional().describe("Studio DataModel target. Default Edit.");

export function registerRobloxTools(server: McpServer, config: ServerConfig): void {
  registerAppTool(server, "roblox_status", {
    title: "Roblox Studio MCP status",
    description:
      "Probe the official Roblox Studio MCP launcher (mcp.bat / StudioMCP), connection state, and available remote tools. Requires Studio open with MCP enabled.",
    inputSchema: {},
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => {
    try {
      return textResult(await robloxStatus());
    } catch (error) {
      return textResult(`roblox_status failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_list_tools", {
    title: "List Roblox Studio MCP tools",
    description: "List tools exposed by the official Roblox Studio MCP server (remote names and Auvrynt roblox_* aliases).",
    inputSchema: {
      forceRefresh: z.boolean().optional().describe("Bypass cached tool list and re-query Studio MCP."),
    },
    ...toolWidgetDescriptorMeta(config, "read"),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ forceRefresh }) => {
    try {
      return textResult(await robloxListTools(forceRefresh === true));
    } catch (error) {
      return textResult(`roblox_list_tools failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_call", {
    title: "Call Roblox Studio MCP tool",
    description:
      "Generic proxy to any official Studio MCP tool. Pass remote tool name (e.g. execute_luau) or auvrynt name (roblox_execute_luau) and arguments object matching Studio's schema.",
    inputSchema: {
      tool: z.string().min(1).describe("Studio tool name, with or without roblox_ prefix."),
      arguments: z.record(z.string(), z.unknown()).optional().describe("Arguments forwarded to Studio MCP."),
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async ({ tool, arguments: toolArgs }) => {
    try {
      return textResult(await robloxCall(tool, toolArgs ?? {}));
    } catch (error) {
      return textResult(`roblox_call failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_disconnect", {
    title: "Disconnect Roblox Studio MCP",
    description: "Close the local stdio connection to Studio MCP. Next roblox_* call will reconnect.",
    inputSchema: {},
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async () => {
    try {
      return textResult(await robloxDisconnect());
    } catch (error) {
      return textResult(`roblox_disconnect failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  // Convenience aliases for documented official tools — all route through roblox_call.
  for (const remoteName of ROBLOX_OFFICIAL_TOOL_NAMES) {
    const name = `roblox_${remoteName}`;
    const mutating = !["script_read", "script_search", "script_grep", "search_game_tree", "inspect_instance", "get_studio_state", "get_console_output", "list_roblox_studios", "http_get", "skill", "search_asset"].includes(remoteName);
    registerAppTool(server, name, {
      title: `Roblox Studio: ${remoteName}`,
      description: `Proxy for official Studio MCP tool '${remoteName}'. Prefer roblox_list_tools for exact input schema. See https://create.roblox.com/docs/studio/mcp`,
      inputSchema: {
        arguments: z.record(z.string(), z.unknown()).optional().describe(`Arguments for Studio tool ${remoteName}.`),
      },
      ...toolWidgetDescriptorMeta(config, mutating ? "write" : "read"),
      annotations: mutating ? MUTATING_ANNOTATIONS : READ_ONLY_ANNOTATIONS,
    }, async ({ arguments: toolArgs }) => {
      try {
        return textResult(await robloxCall(remoteName, toolArgs ?? {}));
      } catch (error) {
        return textResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    });
  }

  // --- Auvrynt helpers (execute_luau wrappers; not official Studio MCP tools) ---

  registerAppTool(server, "roblox_create_instance", {
    title: "Roblox: create instance",
    description: "Auvrynt helper: Instance.new under a parent path. Supports optional properties (Color3/Vector3 as {R,G,B} or {X,Y,Z} / RGB arrays).",
    inputSchema: {
      className: z.string().min(1).describe("Roblox class name, e.g. Part, Folder, Script."),
      parentPath: z.string().min(1).describe("Parent path, e.g. Workspace or StarterGui."),
      name: z.string().optional().describe("Instance name; defaults to className."),
      properties: z.record(z.string(), z.unknown()).optional().describe("Properties to apply after create."),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCreateInstance(args));
    } catch (error) {
      return textResult(`roblox_create_instance failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_destroy_instance", {
    title: "Roblox: destroy instance",
    description: "Auvrynt helper: Destroy an instance by path.",
    inputSchema: {
      path: z.string().min(1).describe("Instance path, e.g. Workspace.Part."),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxDestroyInstance(args));
    } catch (error) {
      return textResult(`roblox_destroy_instance failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_clone_instance", {
    title: "Roblox: clone instance",
    description: "Auvrynt helper: Clone an instance; optional new parent and name.",
    inputSchema: {
      path: z.string().min(1),
      parentPath: z.string().optional(),
      name: z.string().optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCloneInstance(args));
    } catch (error) {
      return textResult(`roblox_clone_instance failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_set_parent", {
    title: "Roblox: set parent",
    description: "Auvrynt helper: Reparent an instance.",
    inputSchema: {
      path: z.string().min(1),
      parentPath: z.string().min(1),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxSetParent(args));
    } catch (error) {
      return textResult(`roblox_set_parent failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_rename_instance", {
    title: "Roblox: rename instance",
    description: "Auvrynt helper: Rename an instance.",
    inputSchema: {
      path: z.string().min(1),
      name: z.string().min(1),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxRenameInstance(args));
    } catch (error) {
      return textResult(`roblox_rename_instance failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_set_properties", {
    title: "Roblox: set properties",
    description: "Auvrynt helper: Set instance properties. Color3 via {R,G,B} 0-1 or [r,g,b] 0-255; Vector3 via {X,Y,Z} or [x,y,z]. Enums via {__enum:\"Material.Grass\"}.",
    inputSchema: {
      path: z.string().min(1),
      properties: z.record(z.string(), z.unknown()),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxSetProperties(args));
    } catch (error) {
      return textResult(`roblox_set_properties failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_set_attribute", {
    title: "Roblox: set attribute",
    description: "Auvrynt helper: SetAttribute on an instance.",
    inputSchema: {
      path: z.string().min(1),
      key: z.string().min(1),
      value: z.unknown(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxSetAttribute(args));
    } catch (error) {
      return textResult(`roblox_set_attribute failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_set_lighting", {
    title: "Roblox: set lighting",
    description: "Auvrynt helper: Apply properties on Lighting (Brightness, ClockTime, Ambient, FogColor, etc.).",
    inputSchema: {
      properties: z.record(z.string(), z.unknown()),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxSetLighting(args));
    } catch (error) {
      return textResult(`roblox_set_lighting failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_fill_terrain", {
    title: "Roblox: fill terrain block",
    description: "Auvrynt helper: Terrain:FillBlock at center (x,y,z) with size and material name (e.g. Grass, Rock, Water).",
    inputSchema: {
      x: z.number(),
      y: z.number(),
      z: z.number(),
      sizeX: z.number(),
      sizeY: z.number(),
      sizeZ: z.number(),
      material: z.string().optional().describe("Enum.Material name. Default Grass."),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxFillTerrainRegion(args));
    } catch (error) {
      return textResult(`roblox_fill_terrain failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_clear_terrain", {
    title: "Roblox: clear terrain",
    description: "Auvrynt helper: Terrain:Clear().",
    inputSchema: {
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxClearTerrain(args));
    } catch (error) {
      return textResult(`roblox_clear_terrain failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_create_screen_gui", {
    title: "Roblox: create ScreenGui",
    description: "Auvrynt helper: Create a ScreenGui under StarterGui (or parentPath).",
    inputSchema: {
      name: z.string().optional(),
      parentPath: z.string().optional().describe("Default StarterGui."),
      resetOnSpawn: z.boolean().optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCreateScreenGui(args));
    } catch (error) {
      return textResult(`roblox_create_screen_gui failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });
  registerAppTool(server, "roblox_ensure_post_effect", {
    title: "Roblox: ensure post effect",
    description: "Auvrynt helper: Create/update Lighting post effect (BloomEffect, ColorCorrectionEffect, SunRaysEffect, Atmosphere, DepthOfFieldEffect, BlurEffect, Sky).",
    inputSchema: {
      className: z.string().min(1),
      name: z.string().optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxEnsurePostEffect(args));
    } catch (error) {
      return textResult(`roblox_ensure_post_effect failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_create_gui_object", {
    title: "Roblox: create GUI object",
    description: "Auvrynt helper: Create Frame/TextLabel/TextButton/ImageLabel/etc under a parent path.",
    inputSchema: {
      className: z.string().min(1),
      parentPath: z.string().min(1),
      name: z.string().optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCreateGuiObject(args));
    } catch (error) {
      return textResult(`roblox_create_gui_object failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_create_sound", {
    title: "Roblox: create sound",
    description: "Auvrynt helper: Create Sound instance with optional rbxassetid.",
    inputSchema: {
      parentPath: z.string().min(1),
      name: z.string().optional(),
      soundId: z.string().optional().describe("Asset id or rbxassetid://..."),
      properties: z.record(z.string(), z.unknown()).optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCreateSound(args));
    } catch (error) {
      return textResult(`roblox_create_sound failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_create_constraint", {
    title: "Roblox: create constraint",
    description: "Auvrynt helper: Create WeldConstraint/HingeConstraint/RopeConstraint/etc with optional Attachment0/1 or Part0/1 paths.",
    inputSchema: {
      className: z.string().min(1),
      parentPath: z.string().min(1),
      name: z.string().optional(),
      attachment0Path: z.string().optional(),
      attachment1Path: z.string().optional(),
      part0Path: z.string().optional(),
      part1Path: z.string().optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCreateConstraint(args));
    } catch (error) {
      return textResult(`roblox_create_constraint failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_set_collision_group", {
    title: "Roblox: set collision group",
    description: "Auvrynt helper: Register collision group and assign to a BasePart.",
    inputSchema: {
      path: z.string().min(1),
      groupName: z.string().min(1),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxSetCollisionGroup(args));
    } catch (error) {
      return textResult(`roblox_set_collision_group failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_set_collision_collidable", {
    title: "Roblox: set groups collidable",
    description: "Auvrynt helper: PhysicsService CollisionGroupSetCollidable between two groups.",
    inputSchema: {
      groupA: z.string().min(1),
      groupB: z.string().min(1),
      collidable: z.boolean(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxSetCollisionGroupCollidable(args));
    } catch (error) {
      return textResult(`roblox_set_collision_collidable failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_fill_terrain_ball", {
    title: "Roblox: fill terrain ball",
    description: "Auvrynt helper: Terrain:FillBall.",
    inputSchema: {
      x: z.number(),
      y: z.number(),
      z: z.number(),
      radius: z.number(),
      material: z.string().optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxFillTerrainBall(args));
    } catch (error) {
      return textResult(`roblox_fill_terrain_ball failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_set_gravity", {
    title: "Roblox: set gravity",
    description: "Auvrynt helper: workspace.Gravity.",
    inputSchema: {
      gravity: z.number(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxSetWorkspaceGravity(args));
    } catch (error) {
      return textResult(`roblox_set_gravity failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_create_remote_event", {
    title: "Roblox: create RemoteEvent",
    description: "Auvrynt helper: RemoteEvent under ReplicatedStorage (or parentPath).",
    inputSchema: {
      name: z.string().min(1),
      parentPath: z.string().optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCreateRemoteEvent(args));
    } catch (error) {
      return textResult(`roblox_create_remote_event failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_create_remote_function", {
    title: "Roblox: create RemoteFunction",
    description: "Auvrynt helper: RemoteFunction under ReplicatedStorage (or parentPath).",
    inputSchema: {
      name: z.string().min(1),
      parentPath: z.string().optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCreateRemoteFunction(args));
    } catch (error) {
      return textResult(`roblox_create_remote_function failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  registerAppTool(server, "roblox_create_module_script", {
    title: "Roblox: create ModuleScript",
    description: "Auvrynt helper: Create/update ModuleScript Source under parentPath.",
    inputSchema: {
      name: z.string().min(1),
      parentPath: z.string().min(1),
      source: z.string().optional(),
      datamodelType: datamodelTypeSchema,
    },
    ...toolWidgetDescriptorMeta(config, "write"),
    annotations: MUTATING_ANNOTATIONS,
  }, async (args) => {
    try {
      return textResult(await robloxCreateModuleScript(args));
    } catch (error) {
      return textResult(`roblox_create_module_script failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

}
