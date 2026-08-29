

<p align="center">
  <img src="docs/assets/auvrynt-icon.png" alt="Auvrynt icon" width="112" height="112" />
</p>

<h1 align="center">Auvrynt — Web-to-local Arsenal</h1>

<p align="center">
  A self-hosted MCP server that gives AI coding assistants secure, real-time access to your local machine.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/auvrynt">
    <img alt="npm" src="https://img.shields.io/npm/v/auvrynt?style=flat-square&color=cb3837" />
  </a>
  <a href="https://github.com/EN-rain/Auvrynt-Web-to-local-Arsenal/actions/workflows/ci.yml">
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/EN-rain/Auvrynt-Web-to-local-Arsenal/ci.yml?style=flat-square&branch=main" />
  </a>
  <a href="https://github.com/EN-rain/Auvrynt-Web-to-local-Arsenal/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/npm/l/auvrynt?style=flat-square" />
  </a>
  <a href="https://nodejs.org">
    <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20.12-brightgreen?style=flat-square" />
  </a>
</p>

---

## What is Auvrynt?

Auvrynt is a **Model Context Protocol (MCP) server** you run on your own machine. It creates a secure, tunneled connection between AI clients like ChatGPT, Claude, or Grok and your local development environment — your actual files, terminals, build tools, and project folders.

No cloud upload. No third-party storage. Your code stays on your machine.

Connect once, then ask your AI to:

- Open any approved project folder on your machine
- Read, write, search, and edit real source files
- Run shell commands, tests, builds, and package scripts
- Work across web, .NET, Godot, Blender, and Aseprite projects
- Capture screenshots of running apps
- Use isolated Git worktrees for parallel coding sessions

---

## Quick Start

> **Requires:** Node.js `>=20.12 <27` — Node 22 LTS recommended

**Install globally:**

```bash
npm install -g auvrynt
```

**Set up and start:**

```bash
auvrynt start
```

`auvrynt start` creates local configuration automatically. Use `auvrynt init`
only when you want to configure foreground `auvrynt serve` manually.

**Or run directly without installing:**

```bash
npx auvrynt init
npx auvrynt start
```

During `auvrynt init`, you will be asked for:

| Prompt | Description |
|---|---|
| Project roots | Local folder paths your AI is allowed to access |
| Local port | Default is `49321` |
| Public base URL | The tunnel URL used by foreground `auvrynt serve` |

> **Important:** Provide the base URL — do **not** include `/mcp`. Example: `https://your-tunnel.trycloudflare.com`

---

## Start the Server

```bash
# Starts one managed background instance, scoped to the current directory
auvrynt start

# Check or stop the background instance
auvrynt status
auvrynt restart
auvrynt stop

# Switch the running workspace to this directory
cd C:\path\to\another-project
auvrynt change

# Foreground server with verbose request logs
auvrynt serve
```

When using foreground `auvrynt serve`, the terminal shows request activity. Background `auvrynt start` returns only after the local server and tunnel are ready; use `auvrynt status` to inspect the managed PID, workspace, profiles, and public URL.

---

`auvrynt start` starts one managed tunnel and one Auvrynt server in the background. Cloudflare is the default; run `auvrynt tunnel` to select ngrok or configure a custom Cloudflare Named Tunnel. On Windows, a custom domain uses the installed `cloudflared` service: `auvrynt start` starts it and `auvrynt stop` stops it. `auvrynt restart` and `auvrynt restart hard` leave that service untouched. It does not keep the terminal occupied. The tunnel stays alive while profiles are added or replaced, so its URL remains the same until `auvrynt stop` or the managed tunnel process exits. A second start asks before changing the existing instance; use `--replace` when running non-interactively.

### Start only what you need

Profiles are session-only: an explicit profile argument enables only those integrations for the current background instance. An unqualified `auvrynt start` starts with every integration disabled, regardless of saved choices.

```bash
# One integration
auvrynt start blender      # Blender MCP port detection
auvrynt start pixel      # Aseprite native CLI/Lua tools
auvrynt start web        # Playwright/browser tools + Agent Reach helpers
auvrynt start godotcs    # Godot C#
auvrynt start godotgd    # Godot GDScript
auvrynt start se         # Serena

# Multiple integrations
auvrynt start blender,godotcs

# Add an integration live; neither the server nor tunnel restarts
auvrynt add web

# Replace profiles live when the workspace is unchanged
auvrynt start se --replace
```

Live profile changes wait until no tool execution is active, then update the local integration gate without closing connected MCP sessions. They do not restart Auvrynt, the managed tunnel, Blender, Godot, Serena, or tracked development processes. Starting with `--replace` from a different directory gracefully changes the managed workspace while preserving the tunnel.

`auvrynt restart` reloads Auvrynt code while keeping the current managed tunnel and URL. `auvrynt restart hard` stops and recreates both. `auvrynt stop` gracefully stops Auvrynt and then its tunnel. These commands do not close Blender or Godot. Lifecycle commands are serialized, so two terminals cannot create duplicate managed instances. Assigned Cloudflare/ngrok URLs may change after a hard restart; a reserved `AUVRYNT_NGROK_URL` remains stable while available.

Generated artifacts are kept under the active workspace's `auvrynt-logs` directory instead of being scattered through the project. Playwright screenshots, responsive captures, image diffs, sprite frames, application captures, Godot exports, Blender exports, and Blender checkpoints use organized subdirectories such as `auvrynt-logs/playwright` and `auvrynt-logs/images`. Normal source edits and generated project source files still use their requested project paths.

---

## Connect an MCP Client

Primary MCP connectors are ChatGPT, Claude, and Grok. Lovable and Bolt are
supported extra connectors.

Paste your `/mcp` URL into the connector setup for one of these clients:

| Connector | Setup location |
| --- | --- |
| ChatGPT | ChatGPT connector/app settings |
| Claude | Claude connector settings |
| Grok | `grok.com/connectors` → **New Connector** → **Custom** |
| Lovable | Lovable MCP connectors |
| Bolt | Bolt MCP connectors |
| Clusy | `app.clusy.io` → MCP servers → Streamable HTTP + Bearer header |

Use the public HTTPS URL ending in `/mcp`, not the local dashboard URL:

```
https://your-tunnel.trycloudflare.com/mcp
```

When the client connects, Auvrynt opens a local approval page that requires your **Owner token**. Normal startup keeps that secret hidden; retrieve it only when needed with:

```bash
auvrynt token
```

It is stored locally in `~/.auvrynt/auth.json`. Keep it private.

**Header-only hosts (Clusy and similar):** these clients never open `/authorize`. Put the Owner token in a custom header instead:

```text
Authorization: Bearer <owner-token-from-auvrynt-token>
```

Use Streamable HTTP and the public `/mcp` URL. Do not expect a browser approve prompt on Clusy.

Client registrations and hashed authorization sessions are stored locally and survive `auvrynt restart` and `auvrynt change` while the same public origin remains active. You should not need to approve the connector again after either command.

Authorization is required again after `auvrynt token reset` or any operation that changes the public origin, including a hard restart of an assigned tunnel. A hard restart using the same reserved ngrok origin keeps the OAuth issuer/resource origin unchanged. If a connector already reports `invalid id`, remove and recreate that connector once with the current `/mcp` URL.

---

## Commands

| Command | Description |
|---|---|
| `auvrynt init` | Run first-time setup or update your config |
| `auvrynt start [profiles]` | Start one managed background instance scoped to the current directory |
| `auvrynt start blender,web` | Start selected profiles: `model`, `web`, `godotcs`, `godotgd`, `se` |
| `auvrynt start ... --replace` | Live-replace profiles, or switch the managed workspace without changing the tunnel |
| `auvrynt add <profiles>` | Add profiles live without restarting the server or tunnel |
| `auvrynt change` | Switch the running workspace to the current directory while preserving profiles and tunnel URL |
| `auvrynt tunnel` | Select Cloudflare, ngrok, or a custom Cloudflare Named Tunnel |
| `auvrynt restart [profiles]` | Restart only Auvrynt while preserving the current managed tunnel URL |
| `auvrynt restart hard [profiles]` | Stop and recreate both Auvrynt and its managed tunnel |
| `auvrynt stop` | Stop Auvrynt and its managed tunnel |
| `auvrynt serve` | Start the server with verbose log output |
| `auvrynt doctor` | Show your config, Node version, and dependency health |
| `auvrynt status` | Show local MCP and integration status without modifying integration files |
| `auvrynt token` | Print the Owner token only on explicit local request |
| `auvrynt token reset` | Generate a new Owner token and clear saved connector authorizations |
| `auvrynt connected` | Show recently observed Grok, ChatGPT, Claude, Lovable, Bolt, or other MCP providers |
| `auvrynt uninstall` | Remove Auvrynt configuration after confirmation |
| `auvrynt uninstall -y` | Remove Auvrynt configuration without confirmation |
| `auvrynt help` | Print the complete command reference |
| `auvrynt config get` | Print your saved configuration |
| `auvrynt config set publicBaseUrl <url>` | Set the public URL used by foreground `auvrynt serve` |

---

## What Your AI Can Do

Once connected and a workspace is opened, your AI assistant has access to **over 150 tools** across:

| Category | Capabilities |
|---|---|
| **Files** | Read, write, edit, search, glob, list directory |
| **Shell** | Run commands, tests, builds, git, package scripts |
| **Processes** | Start/stop persistent processes, tail logs |
| **Web** | Launch dev servers, screenshot pages, inspect DOM |
| **Images** | Inspect, compare, sprite-sheet splitting |
| **.NET** | Inspect projects, restore, build, test, format |
| **Godot** | Run projects, inspect scenes, C# build, GDScript diagnostics |
| **Blender** | Scene audit, checkpoints, renders, export GLB |
| **Aseprite** | Exact pixel drawing, layers, frames, tags, palettes, sheets, conversion |
| **Git** | Worktree management, status, diff, branch ops |

---

## Project Routing

Auvrynt automatically selects the right workflow guide based on your project type:

| Project signals | Guide loaded |
|---|---|
| `package.json` + `vite.config.ts` / web framework | Web Agent Guide |
| `App.sln` / `.csproj` without `project.godot` | Software Agent Guide |
| `project.godot` (any language) | Godot Agent Guide |
| `.blend` files | Blender Agent Guide |
| `.aseprite` / `.ase` files | Aseprite Agent Guide |

See [`PROJECT_ROUTER.md`](guides/PROJECT_ROUTER.md) for full routing rules.

---

## Platform Support

**Windows only. Tested on Windows PowerShell and cmd.exe.**

**Check your environment:**

```bash
auvrynt doctor
```

---

## Configuration

Config files are stored in `~/.auvrynt/`:

```
~/.auvrynt/config.json   ← ports, roots, public URL
~/.auvrynt/auth.json     ← owner token (keep private)
```

Key environment variables:

| Variable | Description |
|---|---|
| `AUVRYNT_ALLOWED_ROOTS` | Comma-separated project root paths |
| `AUVRYNT_PUBLIC_BASE_URL` | Public origin for foreground `auvrynt serve` (no `/mcp`) |
| `AUVRYNT_OAUTH_OWNER_TOKEN` | Override the owner token directly |
| `AUVRYNT_LOG_FORMAT` | `json` (default) or `pretty` |

See [Configuration Reference](docs/configuration.md) for all options.

---

## Documentation

| Document | Description |
|---|---|
| [Setup Guide](docs/setup.md) | Step-by-step tunnel and client setup |
| [Source Layout](docs/source-layout.md) | Runtime domains, entry points, and root compatibility facades |
| [Configuration Reference](docs/configuration.md) | All env vars and config options |
| [ChatGPT Coding Workflow](docs/chatgpt-coding-workflow.md) | How to use Auvrynt day-to-day |
| [Long Projects and Multiple Agents](docs/multi-agent-and-long-projects.md) | Checklist continuity, rooms, directories, and worktrees |
| [Security Model](docs/security.md) | Path isolation, auth, and threat model |
| [Troubleshooting Gotchas](docs/gotchas.md) | Common issues and fixes |

---

## Local Development

```bash
npm install --include=dev
npm run typecheck
npm test
npm run build
npm run dev
```

---

## License

MIT — © 2026 [EN-rain](https://github.com/EN-rain)
