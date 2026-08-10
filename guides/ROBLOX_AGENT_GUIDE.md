# ROBLOX_AGENT_GUIDE.md

## Scope

Official **Roblox Studio MCP** proxy through Auvrynt (Option A).

This is **not** a community HTTP plugin bridge. Auvrynt spawns Studio\'s built-in stdio MCP launcher and re-exports tools as `roblox_*`.

## Prerequisites

1. Latest **Roblox Studio** installed
2. In Studio: **Assistant → … → Manage MCP Servers → Enable Studio as MCP server**
3. Launcher present:
   - Windows: `%LOCALAPPDATA%\Roblox\mcp.bat`
   - macOS: `/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP`
4. Start Auvrynt with the Roblox profile:

```bash
auvrynt start roblox
# aliases: robloxstudio, rbx
# can combine: auvrynt start web,roblox
```

## Primary tools

| Tool | Purpose |
|------|--------|
| `roblox_status` | Launcher path, connection, tool list probe |
| `roblox_list_tools` | Full remote tool inventory + schemas |
| `roblox_call` | Generic proxy (`tool` + `arguments`) |
| `roblox_disconnect` | Close stdio session |
| `roblox_<official_name>` | Convenience aliases for documented Studio tools |

Documented Studio tools (prefix with `roblox_`): `script_read`, `multi_edit`, `script_search`, `script_grep`, `search_game_tree`, `inspect_instance`, `execute_luau`, `get_studio_state`, `start_stop_play`, `get_console_output`, `screen_capture`, `list_roblox_studios`, `set_active_studio`, asset/generation tools, input simulation, `http_get`, `skill`, etc.

Official docs: https://create.roblox.com/docs/studio/mcp

## Workflow

1. Open the place in Roblox Studio (MCP enabled).
2. Ensure Auvrynt is running with `roblox` profile.
3. Call `roblox_status` — expect `ok: true` and a non-empty tool list.
4. Use `roblox_list_tools` when argument shapes are unclear.
5. Prefer specific `roblox_*` aliases or `roblox_call` for actions.
6. Keep Studio open; reconnect with another status/call if Studio restarts.

## Rules

- Never invent Studio tool names beyond what `roblox_list_tools` / `roblox_status` report.
- Studio owns the DataModel; Auvrynt only proxies MCP.
- Multiple Studio windows: use `roblox_list_roblox_studios` + `roblox_set_active_studio`.
- OAuth scope: `auvrynt:roblox`.

## Troubleshooting

- Launcher missing → update Studio; enable MCP in Assistant settings.
- Tools fail → restart Studio and Auvrynt; confirm green MCP client indicator in Studio.
- Linux → official Studio MCP is Windows/macOS oriented; status will say so.

## Helper tools (Auvrynt, via execute_luau)

| Tool | Purpose |
|------|--------|
| `roblox_create_instance` | Instance.new + optional props |
| `roblox_destroy_instance` | Destroy by path |
| `roblox_clone_instance` | Clone (+ optional parent/name) |
| `roblox_set_parent` | Reparent |
| `roblox_rename_instance` | Rename |
| `roblox_set_properties` | Set properties |
| `roblox_set_attribute` | SetAttribute |
| `roblox_set_lighting` | Lighting service props |
| `roblox_fill_terrain` | Terrain:FillBlock |
| `roblox_clear_terrain` | Terrain:Clear |
| `roblox_create_screen_gui` | ScreenGui under StarterGui |

