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
  <a href="https://github.com/EN-rain/Auvrynt/blob/main/LICENSE">
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
- Work across web, .NET, Godot, Blender, Aseprite, and more
- Capture screenshots of running apps
- Use isolated Git worktrees for parallel coding sessions

---

## Quick Start

> **Requires:** Node.js `>=20.12 <27` — Node 22 LTS recommended
> **Platform:** Windows only (PowerShell or cmd.exe)

**Install globally:**

```bash
npm install -g auvrynt
```

The global launcher checks that the CLI bundle is present before starting. If a
linked development checkout is incomplete, it builds the checkout automatically;
otherwise it repairs the package installation from npm and retries once.

**Set up and start:**

```bash
auvrynt start
```

`auvrynt start` creates local configuration automatically on first run. Use `auvrynt init` only when you want to manually configure your setup.

**Or run directly without installing:**

```bash
npx auvrynt start
```

During first-time setup, you will be prompted for:

| Prompt | Description |
|---|---|
| Project roots | Local folder paths your AI is allowed to access |
| Local port | Default is `49321` |
| Public base URL | The HTTPS URL of your tunnel or reverse proxy |
| Cloudflare tunnel token | *(optional)* Saved for automatic tunnel self-healing |

> **Important:** Provide the base URL — do **not** include `/mcp`. Example: `https://your-tunnel.trycloudflare.com`

---

## Start the Server

```bash
# Start one managed background instance, scoped to the current directory
auvrynt start

# Check, restart, or stop the background instance
auvrynt status
auvrynt restart
auvrynt stop

# Switch the running workspace to this directory
cd C:\path\to\another-project
auvrynt change

# Foreground server with verbose request logs
auvrynt serve

# Add a profile to a running instance without restarting
auvrynt add web
```

---

## Integration Profiles

Start Auvrynt with optional integrations enabled:

```bash
auvrynt start web           # Playwright/browser tools
auvrynt start blender       # Blender MCP detection
auvrynt start godotcs       # Godot C#
auvrynt start godotgd       # Godot GDScript
auvrynt start se            # Serena (language server)
auvrynt start web,blender   # Multiple integrations together
```

> All integrations are disabled by default. Pass profiles to enable only what you need.

### Integration Status

| Integration | Profile | Status |
|---|---|---|
| Web / Playwright | `web` | ✅ Stable |
| Godot GDScript | `godotgd` | ✅ Stable |
| Godot C# | `godotcs` | ✅ Stable |
| Serena (LSP) | `se` | ✅ Stable |
| Aseprite | built-in | ✅ Stable |
| .NET / C# tools | built-in | ✅ Stable |
| Images | built-in | ✅ Stable |
| Blender MCP | `blender` | ⚠️ Experimental |
| Roblox MCP | *(auto-detected)* | ⚠️ Experimental |
| Context7 | *(auto-detected)* | ⚠️ Experimental |
| Obsidian | *(auto-detected)* | ⚠️ Experimental |

> **⚠️ Blender MCP** requires the [Blender MCP addon](addons/) to be installed separately inside Blender. It communicates with Auvrynt over a local bridge port. Scene edits may be lossy on complex rigs — always keep a checkpoint or backup before large AI-driven operations.

> **⚠️ Roblox MCP** is an early-stage integration and requires the Roblox Studio plugin (see [ROBLOX_AGENT_GUIDE.md](guides/ROBLOX_AGENT_GUIDE.md)). It is auto-detected when Roblox Studio is running. Tool coverage and stability are limited compared to other integrations.

> **⚠️ Context7** and **Obsidian** integrations are community-experimental. They are auto-detected from running processes and may change behavior in future versions.

---

## Tunnel Setup

Auvrynt needs a public HTTPS URL so AI clients can reach it. Choose a tunnel provider:

### Option A — Cloudflare Quick Tunnel (easiest, no account needed)

```bash
auvrynt start
```

Auvrynt automatically creates a temporary Cloudflare tunnel. The URL changes each restart.

### Option B — Cloudflare Named Tunnel (stable URL, recommended)

1. Create a Named Tunnel from the [Cloudflare Zero Trust dashboard](https://dash.cloudflare.com/).
2. Run `auvrynt tunnel`, pick **Custom external URL**, and paste your token.
3. Your token is saved to `~/.auvrynt/auth.json` and Auvrynt will **automatically self-heal** the tunnel connection on future starts.

```bash
auvrynt tunnel
# Select option 3: Custom external URL
```

**Self-healing behavior (v1.0.5+):** If the Windows `cloudflared` service fails to start due to missing Administrator privileges, Auvrynt automatically falls back to launching the tunnel in user mode using your saved token. If the tunnel drops while the server is running, the health monitor will automatically reconnect.

### Option C — ngrok

```bash
auvrynt tunnel
# Select option 2: ngrok
```

Paste your ngrok authtoken. Auvrynt manages the tunnel lifecycle automatically.

---

## Connect an MCP Client

Paste your `/mcp` URL into the connector setup for one of these clients:

| Connector | Setup location |
|---|---|
| ChatGPT | ChatGPT connector/app settings |
| Claude | Claude connector settings |
| Grok | `grok.com/connectors` → **New Connector** → **Custom** |
| Lovable | Lovable MCP connectors |
| Bolt | Bolt MCP connectors |
| Clusy | `app.clusy.io` → MCP servers → Streamable HTTP + Bearer header |

Use the public HTTPS URL ending in `/mcp`:

```
https://your-tunnel.trycloudflare.com/mcp
```

When the client connects, Auvrynt opens a local approval page that requires your **Owner token**. Retrieve it with:

```bash
auvrynt token
```

It is stored locally in `~/.auvrynt/auth.json`. Keep it private.

**Header-only hosts (Clusy and similar):** Put the Owner token in a custom header:

```text
Authorization: Bearer <owner-token-from-auvrynt-token>
```

Use Streamable HTTP and the public `/mcp` URL. No browser approval prompt is shown on Clusy.

Client registrations and authorization sessions survive `auvrynt restart` and `auvrynt change` while the same public origin remains active. Re-approve only after `auvrynt token reset` or a hard restart that changes your public URL.

---

## Commands

| Command | Description |
|---|---|
| `auvrynt init` | Run first-time setup or update your config |
| `auvrynt start [profiles]` | Start one managed background instance scoped to the current directory |
| `auvrynt start blender,web` | Start selected profiles: `web`, `blender`, `godotcs`, `godotgd`, `se` |
| `auvrynt start ... --replace` | Live-replace profiles, or switch the managed workspace without changing the tunnel |
| `auvrynt add <profiles>` | Add profiles live without restarting the server or tunnel |
| `auvrynt change` | Switch the running workspace to the current directory while preserving profiles and tunnel URL |
| `auvrynt tunnel` | Select Cloudflare, ngrok, or a custom Cloudflare Named Tunnel |
| `auvrynt restart [profiles]` | Restart only Auvrynt while preserving the current managed tunnel URL |
| `auvrynt restart hard [profiles]` | Stop and recreate both Auvrynt and its managed tunnel |
| `auvrynt stop` | Stop Auvrynt and its managed tunnel |
| `auvrynt serve` | Start the server with verbose log output |
| `auvrynt doctor` | Show your config, Node version, and dependency health |
| `auvrynt status` | Show local MCP and integration status |
| `auvrynt token` | Print the Owner token only on explicit local request |
| `auvrynt token reset` | Generate a new Owner token and clear saved connector authorizations |
| `auvrynt setup` | Configure executable paths for local tools (Godot, Blender, Aseprite, Serena) |
| `auvrynt enable` | Enable or disable integrations one by one |
| `auvrynt disable` | Select enabled integrations to disable |
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
| **Web** | Launch dev servers, screenshot pages, inspect DOM, browser automation |
| **Images** | Inspect, compare, sprite-sheet splitting, window capture |
| **.NET** | Inspect projects, restore, build, test, format |
| **Git** | Worktree management, status, diff, branch ops |
| **Godot** | Run projects, inspect scenes, C# build, GDScript diagnostics |
| **Blender** ⚠️ | Scene audit, checkpoints, renders, export GLB *(experimental)* |
| **Aseprite** | Exact pixel drawing, layers, frames, tags, palettes, sheets, conversion |
| **Serena** | Language server (LSP) code intelligence across projects |
| **Roblox** ⚠️ | Studio bridge, place inspection, script analysis *(experimental)* |
| **Context7** ⚠️ | Documentation context for libraries *(experimental)* |
| **Obsidian** ⚠️ | Vault file access *(experimental)* |

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
| Roblox Studio active | Roblox Agent Guide |

See [`PROJECT_ROUTER.md`](guides/PROJECT_ROUTER.md) for full routing rules.

---

## Platform Support

**Windows only. Tested on Windows 10/11 with PowerShell and cmd.exe.**

**Check your environment:**

```bash
auvrynt doctor
```

---

## Configuration

Config files are stored in `~/.auvrynt/`:

```
~/.auvrynt/config.json   — ports, roots, public URL, tunnel provider
~/.auvrynt/auth.json     — owner token, tunnel credentials (keep private)
```

Key environment variables:

| Variable | Description |
|---|---|
| `AUVRYNT_ALLOWED_ROOTS` | Comma-separated project root paths |
| `AUVRYNT_PUBLIC_BASE_URL` | Public origin for foreground `auvrynt serve` (no `/mcp`) |
| `AUVRYNT_OAUTH_OWNER_TOKEN` | Override the owner token directly |
| `AUVRYNT_LOG_FORMAT` | `json` (default) or `pretty` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Override cloudflared tunnel token for self-healing |

See [Configuration Reference](docs/configuration.md) for all options.

---

## Artifacts & Logs

Generated artifacts are stored under the active workspace's `auvrynt-logs/` directory:

```
auvrynt-logs/
  playwright/    — screenshots and browser captures
  images/        — image diffs, sprite frames, window captures
  blender/       — renders, checkpoints, GLB exports
  godot/         — exported scenes and build outputs
```

Normal source edits and project files still use their requested project paths.

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
| [Blender Agent Guide](guides/BLENDER_AGENT_GUIDE.md) | Blender integration setup and usage |
| [Roblox Agent Guide](guides/ROBLOX_AGENT_GUIDE.md) | Roblox Studio integration setup and usage |
| [Godot Agent Guide](guides/GODOT_AGENT_GUIDE.md) | Godot integration setup and usage |
| [Web Agent Guide](guides/WEB_AGENT_GUIDE.md) | Web development integration setup |
| [Aseprite Agent Guide](guides/ASEPRITE_AGENT_GUIDE.md) | Aseprite integration setup and usage |

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

MIT © 2026 [EN-rain](https://github.com/EN-rain)
