# Security Model

Auvrynt exposes local coding capabilities over MCP. Treat it as remote access
to your development machine.

The security model is simple:

- you choose a narrow filesystem allowlist
- the MCP endpoint requires OAuth approval with your Owner token (or Owner token as `Authorization: Bearer` for header-only clients such as Clusy)
- OAuth scopes are enforced per tool call
- workspace rooms are owned by the OAuth client that opened them
- Host headers are allowlisted from the configured public URL
- forwarded client IPs are trusted only from an immediate loopback proxy
- every coding action happens through explicit MCP tool calls

## Filesystem Allowlist

Auvrynt only opens workspaces under configured roots.

Good examples:

```text
~/work
~/personal/open-source
```

Avoid broad roots:

```text
~
/
C:\
```

The narrower the root, the easier it is to reason about what the MCP client can
reach.

## Workspace Room Ownership

Every workspace opened through MCP is assigned to the authenticated OAuth client
that created it. Workspace-bound tools validate this ownership before resolving
the filesystem root or invoking an integration. Another OAuth client cannot use
a leaked `workspaceId` to read, edit, run processes, or call integration tools in
that room.

Room ownership does not provide file locking. Two owner-protected workspaces can
still point to the same checkout, so use separate managed worktrees when multiple
clients must edit one Git repository concurrently.

## Owner Token

`auvrynt init` generates an Owner token and stores it in:

```text
~/.auvrynt/auth.json
```

When an MCP client connects, Auvrynt shows an approval page. Enter the Owner
token only when you intentionally want that client to access this server. Normal
startup does not print the secret; run `auvrynt token` locally when you explicitly
need to retrieve it.

For env-driven deployments, set a long random value:

```bash
AUVRYNT_OAUTH_OWNER_TOKEN="$(openssl rand -base64 32)"
```

## Public URL And Host Allowlist

Auvrynt needs `AUVRYNT_PUBLIC_BASE_URL` so MCP clients can discover OAuth
metadata and connect to the correct resource.

The value should be the origin only:

```text
https://your-tunnel-host.example.com
```

Do not include `/mcp` in `AUVRYNT_PUBLIC_BASE_URL`.

By default, Auvrynt derives allowed Host headers from the local host and public
URL. Use `AUVRYNT_ALLOWED_HOSTS=*` only for intentional local debugging. Reverse
proxy forwarding information is accepted only when the immediate proxy is on
loopback; there is no option to trust arbitrary forwarding headers.

## Tunnels

Auvrynt does not manage tunnels. Your tunnel or reverse proxy should point to:

```text
http://127.0.0.1:49321
```

Prefer adding Cloudflare Access, Tailscale identity controls, or equivalent
protection in front of public tunnels. Auvrynt OAuth still protects the MCP
endpoint, but the tunnel URL should not be treated as a secret.

## Shell Access

The shell tool is powerful by design. It is meant for tests, builds, git, and
package scripts.

Filesystem path containment applies to Auvrynt file tools. Shell commands run
as local commands and can do what your user account can do. This is why the MCP
client must be trusted and the Owner token must stay private.

The `auvrynt:process` scope should therefore be treated as local command-execution
permission, not as a filesystem sandbox.

## Blender Python

Normal Blender tools require `auvrynt:blender` and are bound to a `.blend` file
inside the opened workspace. The arbitrary `blender_execute_python` escape hatch
also requires `auvrynt:blender-python`, which is excluded from the default OAuth
scope set because Python executed inside Blender has the privileges of the local
user account.

## Browser Network Access

Playwright browser tools validate each HTTP(S) request, redirect, DNS result, and
WebSocket destination against local/private/reserved network ranges. Service
workers are disabled in managed browser contexts so they cannot bypass request
routing. Intentional localhost development pages are allowed, while unrelated
LAN, metadata, and private-network destinations remain blocked.

## Worktrees

Managed worktrees reduce accidental edits to your active checkout, but they are
not a security boundary. They are a workflow boundary for isolated coding
sessions.

## Logs

By default, Auvrynt logs requests and tool calls. Shell command previews are
disabled unless `AUVRYNT_LOG_SHELL_COMMANDS=1`.

Do not enable shell command logging if commands may contain secrets.
