# Auvrynt Local Development Tools Guide

Auvrynt extends Model Context Protocol (MCP) with tools for web application development, C#/.NET software development, Godot 4 game development, Aseprite pixel-art editing, image inspection/comparison, and persistent process management.

---

## Architecture & Security Boundaries

Use `get_connection_status` after `open_workspace` to automatically probe the
authenticated MCP session, Blender, Aseprite, Godot, Cloudflare Tunnel, Serena, browser
support, Chrome MCP registration, and tracked workspace processes. Blender
scene tools connect directly to the Blender Lab MCP endpoint shown in Blender
preferences (`localhost:9876` by default).
Godot detection distinguishes a running Godot process from a reachable Auvrynt
editor bridge (`127.0.0.1:49322`). Cloudflare Tunnel and Serena report whether
their executables are installed and whether their processes are running. A
browser marked `available` means Playwright is installed; browser sessions are
created on demand and are not persistent connections.

1. **Workspace Boundary Enforcement**: Every path input must be relative to the opened workspace root. Path traversal (`..`) or symbolic links escaping the workspace are blocked by `WorkspaceRegistry.resolvePath`.
2. **Persistent Processes**: Long-running servers, .NET applications, and Godot games run as background child processes managed by `ProcessManager`. Standard output and error streams are captured in bounded in-memory log buffers (max 1000 lines).
3. **Secret Redaction**: Environment variables containing keywords like `TOKEN`, `SECRET`, `PASSWORD`, `KEY`, or `CONNECTION_STRING` are automatically redacted in responses and log entries.
4. **Browser & Network Security**: `capture_page_screenshot` and `inspect_page` enforce strict SSRF defenses, blocking non-HTTP(S) schemes (`file:`, `data:`, `javascript:`) and cloud metadata / private network IP addresses unless targeting recognized local development hosts (`localhost`, `127.0.0.1`, `[::1]`).

---

## Tool Reference

### Phase 1: Persistent Process Management
- `start_process`: Spawns background process inside workspace. Returns `processId`.
- `get_process_logs`: Tail stdout/stderr for a process (default 100 lines, max 500 lines).
- `list_processes`: List tracked background processes for a workspace.
- `stop_process`: Gracefully stop or force-kill (`force: true`) process tree.

### Phase 2: Structured Project Discovery & Search
- `glob_files`: Fast file globbing respecting `.gitignore` and default exclusions (`.git`, `node_modules`, `dist`, `bin`, `obj`).
- `search_text`: Workspace-wide text search returning matching lines and context snippets.
- `inspect_project`: Auto-detect Node.js, TypeScript, .NET, Godot, Python, Git projects and recommended build/run/test commands.

### Phase 3: Web-Development Tools
- `start_dev_server`: Launch web dev server (auto-detects `npm run dev` script).
- `capture_page_screenshot`: Playwright browser screenshot saved inside workspace and returned as MCP image content.
- `inspect_page`: Extract structured page title, headings, buttons, links, landmarks, console errors, and failed requests.

### Phase 3b: Agent Reach (external internet platforms)
Requires the **web / Playwright** integration profile (`auvrynt start web`). Wraps the open-source [Agent Reach](https://github.com/Panniantong/Agent-Reach) CLI for free platform read/search (Twitter/X, Reddit, YouTube, GitHub, Bilibili, XiaoHongShu, RSS, web search, and more).

- `agent_reach_status`: Detect whether `agent-reach` is on PATH (and version when available).
- `agent_reach_doctor`: Run `agent-reach doctor` / `doctor --json` for channel health.
- `agent_reach_guide`: Install/update URLs and platform notes without executing the CLI.

Agent Reach is an installer + health-checker + router. After setup, agents call upstream tools (`yt-dlp`, `gh`, `twitter`, `opencli`, …) directly. Cookies remain on the local machine.

### Phase 4: Image and Screenshot Inspection
- `inspect_image`: Inspect dimensions, format, MIME type, alpha, and color palette.
- `compare_images`: RGBA pixel-by-pixel image comparison returning match %, changed pixels, and optional diff PNG output.
- `inspect_sprite`: Analyze sprite sheet grid dimensions, cell divisibility, and frame bounds.
- `split_sprite_sheet`: Slices sprite sheet into individual frame PNGs saved inside the workspace.

### Phase 5: C# and .NET Tools
- `inspect_dotnet_project`: Parse `.csproj`, `.fsproj`, `.sln` for SDK style, frameworks, packages, and test runner.
- `dotnet_restore`: Run `dotnet restore` securely.
- `dotnet_build`: Run `dotnet build` returning structured compiler errors/warnings with line and column.
- `dotnet_test`: Run `dotnet test` returning pass/fail/skip counts, failed test names, and assertion messages.
- `dotnet_run`: Launch .NET app as persistent process.
- `dotnet_format`: Run `dotnet format` (`verifyOnly` mode supported).

### Phase 6: Godot 4 Tools
- `detect_godot_project`: Read `project.godot` for project name, main scene, renderer, autoloads, input actions.
- `godot_run`: Launch Godot game or editor as persistent process. Environment variable `GODOT_EXECUTABLE` overrides path.
- `inspect_godot_scene`: Parse `.tscn` text scene trees, node types, signals, and external resources.

### Phase 7: Aseprite Pixel-Art Tools
Auvrynt exposes 36 grouped Aseprite tools. Core categories:
- Detection/readback/live editor: `aseprite_detect`, `aseprite_live_editor`, `aseprite_capture_current`, `aseprite_capture_canvas`, `aseprite_inspect_file`, `aseprite_read_pixels`.
  - The live editor tool includes 46 allowlisted bridge commands for unsaved drawing, selections, layers/cels/tags, palettes, transforms, frame operations, cross-document copying, and live analysis.
- QA: `aseprite_audit_sprite`, `aseprite_compare_documents`, `aseprite_animation_audit`.
- Safety/maintenance: `aseprite_file_safety`, `aseprite_maintenance`, `aseprite_batch_process`, `aseprite_recovery`, `aseprite_extensions`.
- Drawing/regions: `aseprite_create_sprite`, `aseprite_set_pixels`, `aseprite_draw_shapes`, `aseprite_draw_stroke`, `aseprite_draw_advanced`, `aseprite_edit_region`, `aseprite_manage_mask`, `aseprite_run_safe_command`.
- Structure/animation: `aseprite_manage_layers`, `aseprite_compose_layers`, `aseprite_manage_frames`, `aseprite_manage_animation`, `aseprite_manage_tags`, `aseprite_manage_cels`, `aseprite_manage_document`.
- Color/tilemap/import/export: `aseprite_set_palette`, `aseprite_manage_color`, `aseprite_import_sprite_sheet`, `aseprite_manage_tilemap`, `aseprite_export_sprite_sheet`, `aseprite_manage_export_preset`, `aseprite_convert_file`.

Destructive source edits accept `expectedVersion` and `checkpoint`. Use the SHA-256 returned by `aseprite_file_safety` to reject stale writes. Recovery deletion and extension mutation additionally require `allowGlobalWrite=true`.

### Phase 8: Window Capture
- `capture_window`: Capture screenshot of Auvrynt-tracked application window (Windows only).
- `godot_capture_game`: Wrap window capture for Godot game processes.

---

## Development Workflows

### Web Development Workflow
```text
1. open_workspace(path)
2. inspect_project(workspaceId)
3. start_dev_server(workspaceId)
4. capture_page_screenshot(workspaceId, url="http://localhost:3000", outputPath="screenshots/home.png")
5. inspect_page(workspaceId, url="http://localhost:3000")
6. stop_process(workspaceId, processId)
```

### External platform research (Agent Reach)
```text
1. Enable web profile: auvrynt start web
2. agent_reach_status
3. If missing → agent_reach_guide → user installs from GitHub install.md
4. agent_reach_doctor (json optional)
5. Use upstream CLIs via bash for the specific platform task
```

### .NET Workflow
```text
1. open_workspace(path)
2. inspect_dotnet_project(workspaceId, projectPath="MyApp.csproj")
3. dotnet_restore(workspaceId, projectPath="MyApp.csproj")
4. dotnet_build(workspaceId, projectPath="MyApp.csproj")
5. dotnet_test(workspaceId, projectPath="MyApp.Tests.csproj")
6. dotnet_run(workspaceId, projectPath="MyApp.csproj")
```

### Aseprite Workflow
```text
1. open_workspace(path)
2. aseprite_detect(workspaceId)
3. aseprite_inspect_file(workspaceId, filePath="sprites/hero.aseprite")
4. aseprite_read_pixels(...) or aseprite_audit_sprite(...) for exact evidence
5. aseprite_file_safety(action="status") -> retain version
6. aseprite_set_pixels(..., expectedVersion=version, checkpoint=true)
7. aseprite_compare_documents(...) or aseprite_animation_audit(...)
8. aseprite_manage_export_preset(action="run", name="game")
9. aseprite_manage_export_preset(action="validate", name="game")
```

### Godot 4 Workflow
```text
1. open_workspace(path)
2. detect_godot_project(workspaceId)
3. inspect_godot_scene(workspaceId, scenePath="scenes/main.tscn")
4. godot_run(workspaceId, projectPath=".")
5. godot_capture_game(workspaceId, processId, outputPath="captures/game.png")
6. stop_process(workspaceId, processId)
```
