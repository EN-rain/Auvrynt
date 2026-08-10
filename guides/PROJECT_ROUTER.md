# PROJECT_ROUTER.md

## Purpose

Read this file first before any development work. Detect the active project or subproject, then load **only** the relevant guide. Do not load all guides by default.

Available guides: `WEB_AGENT_GUIDE.md`, `SOFTWARE_AGENT_GUIDE.md`, `GODOT_AGENT_GUIDE.md`, `BLENDER_AGENT_GUIDE.md`, `ASEPRITE_AGENT_GUIDE.md`, `ROBLOX_AGENT_GUIDE.md` (all in this `guides/` directory).

---

## Project Detection

Inspect the workspace root for these indicators:

### Blender indicators (highest priority for 3D asset work)
- `.blend`, `.blend1`
- Python scripts importing `bpy`
- `blender_manifest.toml`
- `addons/` with `plugin.cfg` and `__init__.py`
- Blender asset library directories
- Explicit user request mentioning Blender, 3D modeling, rigging, rendering, or UV mapping

### Aseprite indicators (highest priority for pixel-art asset work)
- `.aseprite`, `.ase`
- Aseprite Lua scripts
- Explicit user request mentioning Aseprite, exact pixel drawing, sprite animation, palettes, layers, tags, or frame timing

### Godot indicators
- `project.godot`
- `*.tscn`, `*.tres`, `*.gd`
- `*.cs` (combined with `project.godot`)
- `export_presets.cfg`
- `.godot/`

### Web indicators
- `package.json`
- `vite.config.*`, `next.config.*`, `nuxt.config.*`, `angular.json`, `astro.config.*`, `svelte.config.*`
- `index.html` in root or `public/`
- `src/` with `.tsx`, `.vue`, `.svelte` files

### General software / .NET indicators
- `*.sln`, `*.csproj`, `*.fsproj`, `*.vbproj`
- `Directory.Build.props`, `Directory.Packages.props`, `global.json`
- `src/` with `.cs` / `.fs` files (without `project.godot`)
- `tests/`, `test/`

---

## Routing Rules

### Rule 1 — Godot project
If `project.godot` exists:
- **Primary guide**: `GODOT_AGENT_GUIDE.md`
- If `.cs` or `.csproj` also exists → use Godot C# sections of `GODOT_AGENT_GUIDE.md`
- If `.gd` exists → use GDScript sections of `GODOT_AGENT_GUIDE.md`
- If both → use mixed-language rules in `GODOT_AGENT_GUIDE.md`
- `SOFTWARE_AGENT_GUIDE.md` is secondary only for generic .NET operations outside Godot
- If source `.blend` files exist alongside → load `BLENDER_AGENT_GUIDE.md` **only for the Blender asset task**
- Do not use browser tools unless the project has an actual web UI

### Rule 2 — Web project (no `project.godot`)
If project is clearly a website or web application:
- **Primary guide**: `WEB_AGENT_GUIDE.md`
- Do not load Godot tools
- Load `SOFTWARE_AGENT_GUIDE.md` only for backend/service component of the same task
- If `.blend` source assets exist → load `BLENDER_AGENT_GUIDE.md` only when editing that asset

### Rule 3 — General software / .NET
If project is a desktop app, CLI, API, service, library, or non-Godot .NET project:
- **Primary guide**: `SOFTWARE_AGENT_GUIDE.md`
- Do not use Godot tools
- Do not use browser tools unless the app exposes a web interface

### Rule 4 — Blender-only
If primary task involves 3D modeling, rendering, material, rigging, animation, UV mapping, or export:
- **Primary guide**: `BLENDER_AGENT_GUIDE.md`
- Do not load web, Godot, or software tools unless the task explicitly crosses into those domains

### Rule 5 — Aseprite / pixel-art assets
If the primary task involves exact pixel editing, sprite animation, layers, palettes, tags, or Aseprite export:
- **Primary guide**: `ASEPRITE_AGENT_GUIDE.md`
- Use native `aseprite_*` tools rather than a GUI plugin unless live editor state is explicitly required.
- If the sprite belongs to a Godot project, use `GODOT_AGENT_GUIDE.md` only for the engine-side import/runtime task.
- Do not use image-generation tools as a substitute for exact pixel edits.

### Rule 6 — Monorepo
Identify the active subproject from the user request. Read only that subproject's guide. Refresh project state when switching subprojects.

Example layout:
```
apps/web/          → WEB_AGENT_GUIDE.md
games/rpg/         → GODOT_AGENT_GUIDE.md (contains project.godot)
services/api/      → SOFTWARE_AGENT_GUIDE.md
assets/characters/ → BLENDER_AGENT_GUIDE.md (.blend files)
```

### Rule 7 — Unclear
Inspect only the smallest useful set of root files. State which guide was selected and why. Do not scan the entire repository.

---

## Context Efficiency

- Never load all guides together for a single-project task.
- Prefer one primary guide per task.
- Add a secondary guide only when the task genuinely crosses project boundaries.
- Keep irrelevant tool schemas out of context.

---

## Expected Agent Behavior

> Before making changes, classify the active project or subproject.  
> Load only the relevant development guide.  
> Use the smallest set of tools needed for the current task.  
> Never invent unavailable tools or claim unverified results.

---

## Routing Quick Reference

| Evidence | Guide |
|---|---|
| `project.godot` | GODOT_AGENT_GUIDE.md |
| `package.json` + `vite.config.*` | WEB_AGENT_GUIDE.md |
| `*.sln` / `*.csproj` (no `project.godot`) | SOFTWARE_AGENT_GUIDE.md |
| `.blend` / `bpy` scripts / explicit Blender request | BLENDER_AGENT_GUIDE.md |
| `.aseprite` / `.ase` / explicit pixel-art animation request | ASEPRITE_AGENT_GUIDE.md |
| Godot project + `.blend` source asset task | GODOT_AGENT_GUIDE.md primary, BLENDER_AGENT_GUIDE.md secondary |
| Web project + `.blend` source asset task | WEB_AGENT_GUIDE.md primary, BLENDER_AGENT_GUIDE.md secondary |

## Serena (Semantic Code Engine)

Serena is a local semantic code analysis engine accessible through Auvrynt. It provides symbol-aware navigation and editing across supported languages.

**Use Serena when:**
- Locating symbols in a large codebase
- Understanding class/function/component structure
- Finding definitions and references
- Tracing cross-file dependencies
- Performing symbol-aware insertion or replacement
- Safely renaming symbols
- Navigating monorepos
- Inspecting unfamiliar architecture

**Do not use Serena for:**
- Simple exact text replacement (use Auvrynt edit tools)
- Reading a small known file (use Auvrynt read tools)
- Starting servers, process logs, browser DOM, console errors, network requests, screenshots, visual comparison, image inspection
- Godot scene-tree operations or Blender scene/object operations
- Git commands

**Routing:**
- Need semantic code structure? → Start a Serena session with `serena_start_session`, then use `serena_find_symbol`, `serena_find_referencing_symbols`, etc.
- Need ordinary file/config inspection? → Auvrynt workspace tools
- Need runtime behavior? → Auvrynt process/browser/Godot/Blender tools
- Need visual evidence? → Auvrynt screenshot/image tools

To enable Serena, set `AUVRYNT_SERENA_ENABLED=true` or add `"serena": { "enabled": true }` to Auvrynt config.

---

## Nested Instruction Files

If a subdirectory contains its own `AGENTS.md` or `CLAUDE.md`, those instructions override root-level guidance for that subdirectory.
