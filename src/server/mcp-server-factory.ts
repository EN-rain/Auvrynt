import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { ServerConfig } from "../config.js";
import type { createReviewCheckpointManager } from "../review-checkpoints.js";
import type { WorkspaceRegistry } from "../workspaces.js";
import type { ProcessManager } from "../processes.js";
import type { RoomRegistry } from "../room-registry.js";
import type { SessionRegistry } from "../session-registry.js";
import type { SerenaManager } from "../serena-manager.js";
import { registerSerenaTools } from "../serena-tools.js";
import { updateToolScopes } from "../tool-capabilities.js";
import { configureMcpToolGuard } from "./mcp-tool-registrar.js";
import { WORKSPACE_APP_URI } from "./tool-registration-shared.js";
import {
  appCsp,
  assertWorkspaceAppAssets,
  packageVersion,
  workspaceAppHtml,
} from "./ui-assets.js";
import { logFailedToolResponse, logToolCall } from "./tool-logging.js";
import { registerWorkspaceLifecycleTools } from "./tools/workspace-lifecycle-tools-registration.js";
import { registerCoreFileTools } from "./tools/core-file-tools-registration.js";
import { registerProcessProjectTools } from "./tools/process-project-tools-registration.js";
import { registerWebImageTools } from "./tools/web-image-tools-registration.js";
import { registerDotnetGodotWindowTools } from "./tools/dotnet-godot-window-tools-registration.js";
import { registerGodotCsharpTools } from "./tools/godot-csharp-tools-registration.js";
import { registerGodotGdscriptTools } from "./tools/godot-gdscript-tools-registration.js";
import { registerBlenderTools } from "./tools/blender-tools-registration.js";
import { registerAsepriteTools } from "./tools/aseprite-tools-registration.js";
import { registerContext7Tools } from "../integrations/context7/context7-tools.js";
import { registerObsidianTools } from "../integrations/obsidian/obsidian-tools.js";
import { registerAgentReachTools } from "../integrations/agent-reach/agent-reach-tools.js";
import { registerRobloxTools } from "./tools/roblox-tools-registration.js";
import type { WorkspaceChangeTracker } from "./workspace-analytics.js";

interface ToolNames {
  openWorkspace: "open_workspace";
  read: "read_file" | "read";
  write: "write_file" | "write";
  edit: "edit_file" | "edit";
  grep: "grep_files" | "grep";
  glob: "find_files" | "glob";
  ls: "list_directory" | "ls";
  shell: "run_shell" | "bash";
}

export function createMcpServer(
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  reviewCheckpoints: ReturnType<typeof createReviewCheckpointManager>,
  serenaManager: SerenaManager,
  processManager: ProcessManager,
  roomRegistry: RoomRegistry,
  sessionRegistry: SessionRegistry,
  workspaceChanges: WorkspaceChangeTracker,
): McpServer {
  const toolNames = toolNamesFor(config);
  const server = new McpServer(
    {
      name: "auvrynt",
      title: "Auvrynt",
      version: packageVersion(),
      description:
        "Secure local coding workspace for MCP clients. Provides workspace-scoped file, search, edit, write, and shell tools.",
    },
    { instructions: serverInstructions(config, toolNames) },
  );
  configureMcpToolGuard(server, { config, workspaces, rooms: roomRegistry });

  const widgetCsp = appCsp(config);
  const widgetMeta = {
    ui: {
      csp: widgetCsp,
      prefersBorder: false,
    },
    "openai/widgetDescription":
      "Compact Auvrynt tool result card showing the action, target path, result count, and expandable output.",
    "openai/widgetPrefersBorder": false,
    "openai/widgetCSP": {
      connect_domains: widgetCsp.connectDomains,
      resource_domains: widgetCsp.resourceDomains,
    },
  };

  registerAppResource(
    server,
    "Auvrynt Tool Card",
    WORKSPACE_APP_URI,
    {
      description: "Interactive Auvrynt card for workspace tool results.",
      _meta: widgetMeta,
    },
    async () => {
      await assertWorkspaceAppAssets();
      return {
        contents: [
          {
            uri: WORKSPACE_APP_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: workspaceAppHtml(config),
            _meta: widgetMeta,
          },
        ],
      };
    },
  );

  registerWorkspaceLifecycleTools(
    server,
    config,
    workspaces,
    reviewCheckpoints,
    processManager,
    roomRegistry,
    sessionRegistry,
    workspaceChanges,
    logToolCall,
  );
  registerCoreFileTools(
    server,
    config,
    workspaces,
    reviewCheckpoints,
    toolNames,
    workspaceChanges,
    logToolCall,
    logFailedToolResponse,
  );
  registerProcessProjectTools(
    server,
    config,
    workspaces,
    processManager,
    logToolCall,
  );
  registerWebImageTools(server, config, workspaces, processManager);
  registerDotnetGodotWindowTools(server, config, workspaces, processManager);
  registerGodotCsharpTools(server, config, workspaces, processManager);
  registerGodotGdscriptTools(server, config, workspaces);
  registerBlenderTools(server, config, workspaces);
  registerAsepriteTools(server, config, workspaces, processManager);
  registerRobloxTools(server, config);

  if (config.oauth.scopes.includes("auvrynt:serena")) {
    registerSerenaTools(server, config, serenaManager, workspaces);
  registerContext7Tools(server);
  registerObsidianTools(server, config);
  registerAgentReachTools(server);
  }

  updateToolScopes();
  return server;
}

function toolNamesFor(config: ServerConfig): ToolNames {
  return config.toolNaming === "short"
    ? {
        openWorkspace: "open_workspace",
        read: "read",
        write: "write",
        edit: "edit",
        grep: "grep",
        glob: "glob",
        ls: "ls",
        shell: "bash",
      }
    : {
        openWorkspace: "open_workspace",
        read: "read_file",
        write: "write_file",
        edit: "edit_file",
        grep: "grep_files",
        glob: "find_files",
        ls: "list_directory",
        shell: "run_shell",
      };
}

function serverInstructions(config: ServerConfig, toolNames: ToolNames): string {
  const inspection = config.minimalTools
    ? `In minimal tool mode, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} are disabled; use ${toolNames.shell} with command-line tools such as grep, rg, find, ls, and tree for search and directory inspection. `
    : `Prefer ${toolNames.read}, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} for file inspection. `;
  const skills = config.skillsEnabled
    ? `When ${toolNames.openWorkspace} returns available skills and a task matches a skill, use ${toolNames.read} to read that skill's path before proceeding. Skill paths may be outside the workspace, but ${toolNames.read} only permits advertised SKILL.md files and files under already-loaded skill directories. `
    : "";
  const agentsMd = `Follow instructions returned by ${toolNames.openWorkspace}. Before working under a path listed in availableAgentsFiles, use ${toolNames.read} to inspect that instruction file and follow it. `;
  const viewImageInstruction = `Use view_image when asked to inspect, describe, analyze, or compare a local image. Call ${toolNames.openWorkspace} first, pass the returned workspaceId, and use a workspace-relative path. Do not use ${toolNames.read} for binary image files. `;
  const showChanges = config.widgets === "changes"
    ? " After creating, editing, or overwriting files, call show_changes once after the related file changes are complete so the user can see the aggregate diff."
    : "";
  const devTools = `
Process management: Use start_process for long-running servers, apps, and games that must stay running. Use get_process_logs to tail output. Use stop_process when done. Do not use ${toolNames.shell} for commands that block indefinitely.
Web development: Use start_dev_server to launch a dev server (auto-detects npm run dev), capture_page_screenshot to capture pages with Playwright, inspect_page for structured DOM/accessibility info, test_responsive_page for multi-viewport testing. Requires Playwright; see docs/DEVELOPMENT_TOOLS.md.
Generated artifacts: Screenshots, image diffs, sprite frames, application captures, Godot exports, Blender exports, and Blender checkpoints are stored under the workspace's auvrynt-logs directory. Output path arguments are organized into tool-specific subdirectories there. Ordinary source-file edits and generated project source code remain at their requested project paths.
Project discovery: Use inspect_project to detect project type, package manager, and recommended commands. Use glob_files and search_text for structured file search across the workspace.
Image tools: Use inspect_image for dimensions/format/palette. Use compare_images for pixel-level diff. Use inspect_sprite and split_sprite_sheet for sprite sheets. Do not use view_image for analysis—use inspect_image.
.NET tools: Use inspect_dotnet_project to read project structure, dotnet_restore/dotnet_build/dotnet_test for CLI operations, dotnet_run to start a .NET app as a persistent process, dotnet_format for formatting.
Godot tools: Use detect_godot_project when a workspace contains project.godot. Use godot_run to start the game or editor as a persistent process. Use inspect_godot_scene to read .tscn scene trees. Configure the Godot executable via GODOT_EXECUTABLE environment variable.
Roblox Studio tools: Use roblox_status then roblox_list_tools / roblox_call (or roblox_* aliases) to proxy the official Studio MCP (Enable Studio as MCP server). Requires auvrynt start roblox and an open Studio session.
Aseprite tools: Use aseprite_detect to verify the configured source build, aseprite_inspect_file for layers/frames/tags, aseprite_set_pixels or aseprite_draw_shapes for exact pixel edits, and the export/convert tools for workspace-bound outputs. Aseprite files and output paths must stay inside the open workspace.
Window capture: Use capture_window to screenshot a running application tracked by Auvrynt. Use godot_capture_game specifically for Godot game processes.
Security: All paths must be workspace-relative. Never access files outside the opened workspace. Do not claim a screenshot or comparison succeeded unless the tool returned successfully.`;

  return `Use Auvrynt as a local coding workspace. Call ${toolNames.openWorkspace} once per project folder or worktree to obtain a workspaceId. Reuse that same workspaceId for all later file, search, edit, write, show-changes, view-image, and shell tools in that folder; do not call ${toolNames.openWorkspace} again unless switching folders/worktrees, changing checkout/worktree mode, the workspaceId is rejected as unknown, or the user explicitly asks to reopen. ${agentsMd}${skills}${inspection}${viewImageInstruction}Prefer ${toolNames.edit} for targeted source-file modifications and ${toolNames.write} only for new files or complete rewrites. Use ${toolNames.shell} for tests, builds, git inspection, package scripts, and commands that genuinely require a shell. The shell/process tools execute with the local user's privileges and are not a filesystem sandbox; only invoke them when the granted auvrynt:process scope and requested task justify local command execution.${showChanges}${devTools}`;
}
