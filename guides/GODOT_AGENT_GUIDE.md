# GODOT_AGENT_GUIDE.md

## Scope

This guide applies to Godot 4 game development projects. It covers C#, GDScript, and mixed C#/GDScript projects. The Godot project remains the primary project type whenever a `project.godot` file exists.

Do not edit `.godot/imported` manually.
Do not edit binary `.scn` or `.res` files directly.
Do not use generic `.NET` tools (like `dotnet run`) to launch a Godot game; use Godot-specific tools.

---

## Language Routing

Before modifying or inspecting files, identify the script language:

- **`.gd` files:** Use GDScript diagnostics, GDScript editing rules, and GDScript debugger/LSP tools.
- **`.cs` files:** Use Godot C# build, Roslyn/LSP, C# exception parser, and C# semantic definitions.
- **Scenes and resource files (`.tscn`, `.tres`):** Use the shared Godot editor bridge and Inspector APIs.
- **Mixed projects:** Validate both C# build and GDScript parsing when changes span both boundaries.

---

## Shared Godot Capabilities

- Project and executable discovery.
- Headless project validation & asset reimporting.
- Persistent process management for running projects/scenes.
- Runtime logs and error categorization.
- Live editor bridge (connect, status, disconnect).
- Edited/remote scene tree mutation and property editing (using UndoRedo).
- Performance monitors (FPS, memory, nodes).
- Input injection & visual gameplay assertions (screenshots, node existence).
- Export presets listing and headless exporting.

---

## GDScript Development Rules

### Editing & Syntax
- Use Godot 4 syntax rules (e.g. `await` instead of `yield`, modern annotations like `@onready`, `@export`).
- Preserve the existing indentation style (tabs vs spaces) and static typing conventions.
- Use snake_case for methods/variables, PascalCase for `class_name` definitions.
- Only add `@tool` or `class_name` when explicitly requested or necessary.
- Avoid calling `get_node()` (or `$`) inside expensive callbacks like `_process()` or `_physics_process()`; cache them using `@onready` instead.
- Use `_physics_process()` for frame-independent movement/physics updates.
- Respect object lifetimes; use `is_instance_valid()` before accessing potentially freed objects.
- Use deferred calls (`call_deferred()`) when mutating the scene tree inside signal handlers or physics callbacks.

---

## Godot C# Development Rules

### Editing & Syntax
- Use partial classes for nodes (e.g. `public partial class Player : CharacterBody2D`).
- Preserve namespace structure and naming conventions.
- Avoid calling `GetNode()` repeatedly inside `_Process()` or `_PhysicsProcess()`.
- Use `_PhysicsProcess(double delta)` for physics updates.
- Respect Godot object lifetimes and call `Dispose()` or `QueueFree()` when freeing nodes.
- Do not translate GDScript API names blindly (e.g. GDScript `queue_free()` becomes C# `QueueFree()`).

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Godot 4.2+** | Required for all supported Godot projects |
| **Godot .NET/mono build** | Required only when the active project/task uses C# |
| **.NET SDK 8.0+** | Required only for C# compilation |
| **Auvrynt server** | Running and connected to your AI client |
| **Auvrynt workspace** | Opened via `open_workspace` pointing to your Godot project root |

---

## Environment Variables

Set these to help Auvrynt find the right Godot executable:

```sh
# Preferred: Godot .NET-enabled executable
set GODOT_DOTNET_EXECUTABLE=C:\Godot\Godot_v4.4_mono_win64.exe

# Fallback if above is not set
set GODOT_EXECUTABLE=C:\Godot\Godot_v4.4_stable_win64.exe
```

---

## Quick Start — New Project

```
1. open_workspace({ path: "/path/to/my-godot-game" })
2. godot_dotnet_environment({ workspaceId })        # verify setup
3. inspect_godot_dotnet_project({ workspaceId })    # check project health
4. godot_dotnet_restore({ workspaceId, projectPath: "." })
5. godot_dotnet_build({ workspaceId, projectPath: "." })
6. godot_run_project({ workspaceId, projectPath: ".", debug: true })
7. godot_get_runtime_logs({ workspaceId, processId })
```

---

## Editor Bridge Setup

The editor bridge enables live scene-tree inspection and node mutation from Auvrynt while the Godot editor is open.

### Setup

1. **Copy the plugin** into your project:
   ```
   addons/auvrynt_bridge/auvrynt_bridge.gd
   addons/auvrynt_bridge/plugin.cfg
   ```

2. **Enable the plugin** in Godot:
   `Project → Project Settings → Plugins → AuvryntBridge → Enable`

3. **Connect from Auvrynt**:
   ```
   godot_editor_connect({
     workspaceId,
     projectPath: ".",
     token: "<printed in Godot Output panel>"
   })
   ```
   The token is printed in the Godot **Output** panel when the plugin starts:
   ```
   [AuvryntBridge] Listening on 127.0.0.1:49322  token=12345678
   ```

4. **Verify connection**:
   ```
   godot_editor_status({ workspaceId })
   ```

### Bridge Methods

| Tool | Method | Notes |
|---|---|---|
| `godot_get_scene_tree` | `scene.get_tree` | Edited scene tree |
| `godot_get_scene_tree` (mode=remote) | `remote.get_scene_tree` | Running game tree |
| `godot_get_runtime_property` | `remote.get_property` | Live runtime value |
| `godot_get_performance_monitors` | `remote.get_performance_monitors` | FPS, memory, node count |
| `godot_assert_node_exists` | `remote.get_node` | Pass/fail node check |
| `godot_assert_property` | `remote.get_property` + comparison | Gameplay assertion |
| `godot_press_action` | `input.press_action` | Input simulation |

---

## Complete Tool Reference

### Environment & Project

| Tool | What it does |
|---|---|
| `godot_dotnet_environment` | Detect executable, .NET SDK, architecture |
| `inspect_godot_dotnet_project` | Inspect `.csproj`, `.sln`, autoloads, scripts |

### Build & Restore

| Tool | What it does |
|---|---|
| `godot_build_solutions` | Regenerate `.sln`/`.csproj` (run after adding C# files) |
| `godot_dotnet_restore` | NuGet restore |
| `godot_dotnet_build` | C# build, returns structured diagnostics |
| `godot_dotnet_clean` | Remove `bin/` and `obj/` |

### Running

| Tool | What it does |
|---|---|
| `godot_run_project` | Launch project as tracked persistent process |
| `godot_run_scene` | Launch a single `.tscn` scene |
| `godot_stop` | Stop a tracked Godot process |
| `godot_get_runtime_logs` | Structured runtime log categorization |

### Validation & Import

| Tool | What it does |
|---|---|
| `godot_validate_project` | Headless validation: imports, scripts, plugins |
| `godot_import_assets` | Force headless reimport |

### Editor Bridge

| Tool | What it does |
|---|---|
| `godot_editor_connect` | Connect to Godot editor plugin |
| `godot_editor_status` | Check connection |
| `godot_editor_disconnect` | Disconnect |
| `godot_get_scene_tree` | Scene tree (edited or remote) |
| `godot_get_runtime_property` | Read live runtime property |
| `godot_get_performance_monitors` | FPS, memory, physics timing |

### C# Semantics

| Tool | What it does |
|---|---|
| `godot_find_csharp_class` | Find class by name, get `[Export]`, `[Signal]`, overrides |
| `godot_get_exported_properties` | List `[Export]` properties on a script |
| `godot_get_csharp_diagnostics` | Scan for anti-patterns |

### Project Settings & Configuration

| Tool | What it does |
|---|---|
| `godot_get_project_settings` | Read all `project.godot` settings |
| `godot_get_input_map` | List input actions |
| `godot_get_autoloads` | List autoloads |
| `godot_apply_pixel_art_import_preset` | Nearest-neighbour, lossless, no mipmaps |
| `godot_generate_vscode_config` | Create `.vscode/tasks.json` + `.vscode/launch.json` |

### Export

| Tool | What it does |
|---|---|
| `godot_list_export_presets` | List export presets from `export_presets.cfg` |
| `godot_export_project` | Export using named preset |

### Testing & Assertions

| Tool | What it does |
|---|---|
| `godot_assert_node_exists` | Assert node exists in remote scene tree |
| `godot_assert_property` | Assert runtime property value (`eq`, `neq`, `gt`, `lt`, `approx`, `contains`, `exists`) |
| `godot_run_test_sequence` | Automated gameplay sequence (max 50 steps, 30s) |
| `godot_press_action` | Inject input action via bridge |

### Visuals

| Tool | What it does |
|---|---|
| `godot_capture_game` | Screenshot a running Godot window |
| `view_image` | Load and inspect an image file |
| `inspect_image` | Analyse pixel dimensions, palette, format |
| `inspect_sprite` | Detect animation frames in sprite sheets |

---

## Recommended Workflow

1. Open workspace and inspect project languages.
2. If C# is present, compile C# using `godot_dotnet_build`.
3. Run headless project validation using `godot_validate_project`.
4. Inspect the active scene or node properties via the editor bridge.
5. Make minimal changes to scripts. Validate syntax.
6. Launch the project or active scene as a persistent process.
7. Inject input or test gameplay behavior using assertions.
8. Capture gameplay window screenshot to verify visually.
9. Stop the game process when finished.

---

## Security Model

- **Path resolution**: All file paths are resolved via `workspaces.resolvePath` — reading outside the opened workspace root is blocked.
- **Process tracking**: Processes are tracked by `workspaceId` + `processId`. Stopping a process from a different workspace is not permitted.
- **Editor bridge**: Runs on `127.0.0.1` only. Requires a per-session token printed in the Godot output panel. Never accepts external connections.
- **NuGet restore**: Credentials are redacted from output before returning to the AI client.
- **Export**: Output path must resolve inside the opened workspace.

---

## Serena (Semantic Code)

Serena provides language-aware symbol navigation for Godot C# and GDScript source files.

**Use Serena for:**
- C# or GDScript source navigation when supported reliably
- References and symbol structure
- Code-level refactoring

**Do not use Serena for:**
- Scene tree, Inspector, resources, animations, TileMap, collision
- Remote runtime tree, game input, screenshots, exports

**Use:**
- Godot editor bridge → scenes/resources/runtime
- Serena → semantic source navigation (`serena_find_symbol`, `serena_find_referencing_symbols`, etc.)
- Godot/.NET diagnostics → build/parser truth (`godot_dotnet_build`, `godot_get_gdscript_diagnostics`)

Do not replace Godot's GDScript LSP integration with Serena unless tests prove equivalent behavior.

---

## Troubleshooting

### `GODOT_DOTNET_EXECUTABLE not set`
Set the env var (see above) or run `godot_dotnet_environment` to see what was auto-detected.

### `Build failed: Godot.NET.Sdk not found`
Run `godot_build_solutions` first to generate the `.csproj`. This requires the Godot editor executable to be available.

### `Editor bridge: connection refused`
Make sure the Auvrynt Bridge plugin is enabled and the Godot editor is open with the project loaded. Copy the token from the Godot Output panel.

### `Node not found` errors
The `nodePath` must be relative to the scene root (e.g. `Player/Sprite2D`), not absolute. For remote tree queries, the game must be running.
