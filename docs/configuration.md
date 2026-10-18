# Configuration Reference

Auvrynt can be configured through `auvrynt init`, persisted config files, or
environment variables.

The default files are:

```text
~/.auvrynt/config.json
~/.auvrynt/auth.json
```

Use another config directory with:

```bash
AUVRYNT_CONFIG_DIR=/path/to/config npx auvrynt start
```

## Commands

```bash
npx auvrynt init
npx auvrynt start
npx auvrynt doctor
npx auvrynt config get
npx auvrynt config set publicBaseUrl https://auvrynt.example.com
```

## Core Environment Variables

| Variable | Purpose |
| --- | --- |
| `HOST` | Local bind host. Defaults to `127.0.0.1`. |
| `PORT` | Local port. Defaults to `49321`. |
| `AUVRYNT_ALLOWED_ROOTS` | Comma-separated local roots that workspaces may open. |
| `workspaceRoot` (in `~/.auvrynt/config.json`) | Last workspace directory selected by the dashboard or an explicit lifecycle command. Plain `auvrynt start` reuses it. |
| `AUVRYNT_PUBLIC_BASE_URL` | Public origin used by foreground `auvrynt serve`, without `/mcp`. Non-loopback origins must use HTTPS. Managed `auvrynt start` supplies its tunnel URL automatically. |
| `AUVRYNT_TUNNEL_PROVIDER` | Managed background tunnel: `cloudflare` (default), `ngrok`, or `custom`. A custom provider can remain externally managed or use a Cloudflare Named Tunnel token so Auvrynt starts it. |
| `AUVRYNT_CLOUDFLARE_TUNNEL_TOKEN` | Optional non-Windows Cloudflare Named Tunnel token. On Windows, custom mode controls the installed `cloudflared` service with `sc.exe`; the service must already contain the Named Tunnel token. |

### Local Cloudflare account profiles

When the local machine must authenticate to two Cloudflare accounts, run the interactive browser login twice with different profile names:

```text
auvrynt cloudflare login
auvrynt cloudflare login
auvrynt cloudflare list
auvrynt cloudflare select account-a
```

The login command opens Cloudflare's browser flow and saves each account certificate under the private Auvrynt directory. Use names such as `account-a` and `account-b`; credentials are never printed or placed in command arguments. Auvrynt accepts at most two local profiles. The current tunnel lifecycle still has one active tunnel at a time, so profile selection does not start two simultaneous tunnels.
| `AUVRYNT_NGROK_AUTHTOKEN` | Optional ngrok token when ngrok is not already authenticated locally. |
| `AUVRYNT_NGROK_URL` | Optional stable HTTPS origin reserved on the ngrok account, such as `https://your-name.ngrok.app`. Auvrynt passes it through ngrok's `--url` option. |
| `AUVRYNT_ARBITER_ENABLED` | Opts the read-only typed-decision MCP tool into the configured Arbiter service. Defaults to disabled. Arbiter is not a coding model or deterministic safety validator. |
| `AUVRYNT_ARBITER_URL` | Arbiter HTTP(S) base URL. Requests use `/healthz`, `/readyz`, `/v1/models`, and `/v1/systemone`. Defaults to `http://127.0.0.1:8010`. |
| `AUVRYNT_ARBITER_MODEL` | Model name sent to Arbiter. Defaults to `laya-typed-decisions`. |
| `AUVRYNT_ARBITER_TIMEOUT_MS` | Per-request timeout from 250 to 120000 milliseconds. Defaults to 10000. |
| `AUVRYNT_ARBITER_API_KEY` | Optional environment override for the Arbiter Bearer credential. Prefer the private `arbiterApiKey` field in `~/.auvrynt/auth.json`; it is never returned by dashboard APIs. |
| `AUVRYNT_ALLOWED_HOSTS` | Optional Host header allowlist override. |
| `AUVRYNT_OAUTH_OWNER_TOKEN` | Owner token for OAuth approval. Must be at least 16 characters. |
| `AUVRYNT_WORKTREE_ROOT` | Directory for managed Git worktrees. Defaults to `~/.auvrynt/worktrees`. |
| `AUVRYNT_STATE_DIR` | Directory for SQLite state. Defaults to `~/.local/share/auvrynt`. |
| `AUVRYNT_SESSION_IDLE_MS` | MCP session inactivity before automatic closure. Defaults to 12 hours; valid range is 1 minute to 7 days. Sessions with in-flight requests or tool calls are not expired. |
| `AUVRYNT_DISCONNECT_GRACE_MS` | Optional retention time after a session becomes disconnected. Defaults to `0`, so an idle session closes at its timeout without an additional grace period. Persistent processes started with `start_process` continue independently. |
| `AUVRYNT_MAX_SESSIONS` | Maximum reserved and established MCP sessions across all OAuth clients. Defaults to 32 and cannot be raised above 256. The Connectivity tab can persist any value from 1 to 256 when this environment variable is unset. |
| `AUVRYNT_MAX_SESSIONS_PER_CLIENT` | Maximum reserved and established MCP sessions for one OAuth client. Defaults to 8 and cannot be raised above 256. The Connectivity tab keeps both persisted limits aligned. |
| `AUVRYNT_SERENA_ENABLED` | Enables the Serena runtime. When unset, startup enables Serena only if its executable or process is detected. Set to `0` to disable it completely. |
| `AUVRYNT_SERENA_INTEGRATION_ENABLED` | Controls whether Serena tools are advertised to MCP clients. When unset, detection decides the default. Disabling it removes Serena from active clients' tool lists and stops active Serena sessions. |
| `AUVRYNT_ASEPRITE_ENABLED` | Controls whether native Aseprite pixel-art tools are advertised. Defaults to enabled. |
| `AUVRYNT_ASEPRITE_PATH` | Optional direct path to `aseprite.exe`/`aseprite`. |
| `AUVRYNT_ASEPRITE_SOURCE_PATH` | Optional Aseprite source/build directory. Auvrynt checks `build/bin`, `bin`, then the source root for the executable. |

## Arbiter typed decisions

When enabled, Auvrynt exposes `arbiter_decide` as a read-only MCP operation. It
sends typed `choice`, `score`, or `noul` questions to the configured Arbiter
endpoint and returns the model's probabilities and confidence. Unavailable,
timed-out, unauthorized, or malformed responses become bounded tool errors; they
do not crash Auvrynt or trigger a local action. Arbiter output must not be used
as the sole approval for destructive file, process, or security operations.

Store the credential in the private auth file alongside the owner token:

```json
{
  "arbiterApiKey": "your-private-key"
}
```

## Jobs / Facebook account linking

The Jobs workspace is local-first. To enable its Facebook **account-linking**
button, create a Facebook app and register this exact callback URL in the app's
OAuth settings:

```text
http://127.0.0.1:<PORT>/dashboard/jobs/integrations/facebook/callback
```

Configure the app on the Auvrynt server, then restart it:

| Variable | Purpose |
| --- | --- |
| `AUVRYNT_JOBS_FACEBOOK_APP_ID` | Facebook app id. |
| `AUVRYNT_JOBS_FACEBOOK_APP_SECRET` | Facebook app secret. Read only by the server; never put it in the Jobs page or browser storage. |
| `AUVRYNT_JOBS_FACEBOOK_ENABLED` | Optional boolean feature gate. When omitted, Facebook is enabled automatically only when both app values are present. |
| `AUVRYNT_JOBS_FACEBOOK_GRAPH_VERSION` | Optional Graph API version such as `v22.0`; defaults to `v22.0`. |

Open `http://127.0.0.1:<PORT>/dashboard/jobs#integrations`, select **Connect
Facebook**, and finish the official consent screen. Auvrynt validates a
one-time, short-lived state value, exchanges the code server-side, verifies the
account profile, and stores the token encrypted in the private state directory.
No Facebook scanning or background sync starts automatically in this milestone.
Disconnecting from the page removes the saved local token.

## OAuth

Auvrynt uses a single-user OAuth approval flow.

| Variable | Default |
| --- | --- |
| `AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` |
| `AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS` | `2592000` |
| `AUVRYNT_OAUTH_SCOPES` | `auvrynt:read,auvrynt:write,auvrynt:process,auvrynt:web,auvrynt:software,auvrynt:godot,auvrynt:blender,auvrynt:aseprite,auvrynt:serena,auvrynt:roblox,auvrynt:krita` |
| `AUVRYNT_OAUTH_ALLOWED_REDIRECT_HOSTS` | `grok.com,console.x.ai,chatgpt.com,claude.ai,claude.com,anthropic.com,oauth.lovable.app,lovable.app,lovable.dev,api.lovable.dev,bolt.new,clusy.io,app.clusy.io,docs.clusy.io,localhost,127.0.0.1` |

### Header-only MCP clients (Clusy and similar)

Some hosts only support **Streamable HTTP + custom headers** and never open the browser `/authorize` page. For those clients, Auvrynt accepts the **Owner token** as a Bearer access token:

```text
Authorization: Bearer <AUVRYNT_OWNER_TOKEN>
```

That grant uses client id `auvrynt-owner-bearer` and the configured `AUVRYNT_OAUTH_SCOPES`. Prefer OAuth for Grok/Claude/ChatGPT; use Owner Bearer only for header-only hosts. Rotate the Owner token (`auvrynt token reset`) if it is ever exposed.

`auvrynt:blender-python` is intentionally **not** granted by default. Add it to `AUVRYNT_OAUTH_SCOPES` only when a trusted client must use the arbitrary Blender Python escape hatch. Auvrynt enforces scopes per tool call, not only at login.

For a durable trusted-owner local opt-in without changing the default scope set, set `"blenderPythonEnabled": true` in the private `~/.auvrynt/config.json` and restart Auvrynt. This adds `auvrynt:blender-python` only when `AUVRYNT_OAUTH_SCOPES` is not explicitly supplied; an explicit environment scope list remains authoritative. Treat this as host-level Python execution inside Blender and enable it only for trusted agents/workspaces.

The `auvrynt:desktop` scope is intentionally **not** granted by default. Add it explicitly when a trusted client needs Desktop Use: bounded observation plus mouse/keyboard interaction with explicitly targeted Windows displays or applications. The `krita` profile uses the separately gated no-plugin Krita path and never installs or requires a Krita plugin or bridge.

OAuth scopes are the durable capability envelope; integration profiles are a second local execution gate. Profiles and the last workspace directory are persisted in the private config, while dashboard and lifecycle commands are the supported mutation paths. Changing profiles updates that local gate without closing MCP sessions or changing the public tunnel URL. Disabled integration tools are removed from active MCP tool lists, so agents do not keep planning calls to unavailable integrations. When the owner explicitly enables a profile, existing tokens receive only the required scopes that are already allowed by `AUVRYNT_OAUTH_SCOPES`.

MCP clients discover metadata from:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

## Tool Modes

`AUVRYNT_TOOL_NAMING` controls tool names.

| Value | Behavior |
| --- | --- |
| `short` | Default. Uses `read`, `edit`, `bash`, and related names. |
| `legacy` | Uses `read_file`, `edit_file`, `run_shell`, and related names. |

`AUVRYNT_TOOL_MODE` controls the tool surface.

| Value | Behavior |
| --- | --- |
| `minimal` | Default. Disables dedicated search and list tools. Clients use the shell tool with `rg`, `grep`, `find`, `ls`, or `tree` for inspection. |
| `full` | Enables dedicated `grep`, `glob`, and `ls` tools. |

## Widgets

`AUVRYNT_WIDGETS` controls ChatGPT Apps iframe usage.

| Value | Behavior |
| --- | --- |
| `full` | Default. Widget UI is attached to exposed workspace, file, edit, and shell tools. |
| `changes` | Enables the aggregate `show_changes` tool and attaches widget UI to `open_workspace` and `show_changes`. |
| `off` | Disables widget UI. |

## Skills

| Variable | Purpose |
| --- | --- |
| `AUVRYNT_SKILLS` | Set to `0` to hide skills. Enabled by default. |
| `AUVRYNT_AGENT_DIR` | Defaults to `~/.codex`. |
| `AUVRYNT_SKILL_PATHS` | Optional comma-separated skill directories. |

Example:

```bash
AUVRYNT_SKILL_PATHS="$HOME/.codex/skills,$HOME/.claude/skills" \
npx auvrynt start
```

## Logging

| Variable | Default |
| --- | --- |
| `AUVRYNT_LOG_LEVEL` | `info` |
| `AUVRYNT_LOG_FORMAT` | `json` |
| `AUVRYNT_LOG_REQUESTS` | `1` |
| `AUVRYNT_LOG_ASSETS` | `0` |
| `AUVRYNT_LOG_TOOL_CALLS` | `1` |
| `AUVRYNT_LOG_SHELL_COMMANDS` | `0` |

Auvrynt trusts forwarded client information only from an immediate loopback proxy. This is fixed behavior rather than a runtime toggle so direct remote clients cannot opt into spoofable forwarding headers.

Plain HTTP public origins are rejected unless the hostname is loopback (`localhost`, `127.0.0.0/8`, or `::1`). Use HTTPS for every tunnel, reverse proxy, LAN hostname, and public deployment.

Run `auvrynt tunnel` to switch the managed provider interactively. With ngrok, leaving the stable URL blank uses an assigned URL; supplying `AUVRYNT_NGROK_URL` or saving the same value through the tunnel command keeps that origin across hard restarts as long as the reservation remains available. Auvrynt discovers the active ngrok URL from that process's structured startup logs rather than querying the shared `127.0.0.1:4040` inspector API, so another local ngrok process cannot be mistaken for Auvrynt's tunnel.

Set `AUVRYNT_LOG_FORMAT=pretty` for local debugging.

Set `AUVRYNT_LOG_SHELL_COMMANDS=1` only when you intentionally want command
previews in logs.

## Env-Only Example

```bash
AUVRYNT_OAUTH_OWNER_TOKEN="$(openssl rand -base64 32)" \
AUVRYNT_ALLOWED_ROOTS="$HOME/personal,$HOME/work" \
AUVRYNT_PUBLIC_BASE_URL="https://auvrynt.example.com" \
AUVRYNT_WORKTREE_ROOT="$HOME/.auvrynt/worktrees" \
AUVRYNT_TOOL_MODE="minimal" \
AUVRYNT_TOOL_NAMING="short" \
AUVRYNT_WIDGETS="full" \
npx auvrynt start
```

The environment assignments must be part of the same command invocation, or
exported first.
