import { timingSafeEqual, randomBytes, randomUUID, createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { AccessDeniedError, InvalidGrantError, InvalidRequestError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type { LoggingConfig } from "../logger.js";
import { logEvent } from "../logger.js";
import { AUVRYNT_THEME_CSS } from "../ui/brand-theme.js";

export interface OAuthStaticClientConfig {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName?: string;
}

export interface OAuthConfig {
  ownerToken: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  scopes: string[];
  allowedRedirectHosts: string[];
  staticClients?: OAuthStaticClientConfig[];
  logging?: LoggingConfig;
}

interface AuthorizationCodeRecord {
  clientId: string;
  params: AuthorizationParams;
  expiresAtMs: number;
}

interface AccessTokenRecord {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

interface RefreshTokenRecord {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

interface PersistedOAuthState {
  version: 1;
  resourceServerUrl: string;
  clients: OAuthClientInformationFull[];
  codes: Array<[string, Omit<AuthorizationCodeRecord, "params"> & {
    params: Omit<AuthorizationParams, "resource"> & { resource?: string };
  }]>;
  accessTokens: Array<[string, Omit<AccessTokenRecord, "resource"> & { resource?: string }]>;
  refreshTokens: Array<[string, Omit<RefreshTokenRecord, "resource"> & { resource?: string }]>;
}

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_DYNAMIC_CLIENTS = 1024;
const MAX_AUTHORIZATION_CODES = 1024;
const MAX_ACCESS_TOKENS = 4096;
const MAX_REFRESH_TOKENS = 4096;

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formHtml(params: {
  error?: string;
  clientName: string;
  scopes: string[];
  resource?: URL;
  fields: Record<string, string | undefined>;
  nonce: string;
}): string {
  const scopeDescriptions: Record<string, string> = {
    "auvrynt:read": "Inspect files, search, and perform read-only project analysis",
    "auvrynt:write": "Edit and create files",
    "auvrynt:process": "Run local commands and processes with the current OS user's privileges",
    "auvrynt:web": "Use browser and web-development tools",
    "auvrynt:software": "Use software and .NET tools",
    "auvrynt:godot": "Use Godot project and editor tools",
    "auvrynt:blender": "Use workspace-bound Blender 3D tools",
    "auvrynt:blender-python": "Execute arbitrary Python inside Blender (host-level capability)",
    "auvrynt:serena": "Use local Serena semantic code tools",
  };
  const scopeItems = params.scopes.length > 0
    ? params.scopes.map((s) => {
        const desc = scopeDescriptions[s];
        return `<li><strong>${htmlEscape(s)}</strong>${desc ? ` <span>${htmlEscape(desc)}</span>` : ""}</li>`;
      }).join("\n          ")
    : "<li><strong>auvrynt</strong><span>General access</span></li>";
  const error = params.error
    ? `<output role="alert" class="error">${htmlEscape(params.error)}</output>`
    : "";
  const privilegedScopes = params.scopes.filter((scope) => scope === "auvrynt:process" || scope === "auvrynt:blender-python");
  const privilegeNote = privilegedScopes.length > 0
    ? `<p class="privilege-note"><strong>Local execution requested.</strong> These permissions can run code with your OS user privileges. Approve only for a web agent you trust.</p>`
    : "";
  const hiddenFields = Object.entries(params.fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `        <input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auvrynt: Webkit Arsenal</title>
    <style nonce="${htmlEscape(params.nonce)}">
      ${AUVRYNT_THEME_CSS}
      *, *::before, *::after { box-sizing: border-box; }
      :root { font-family: var(--auvrynt-font-sans); }
      html, body { height: 100%; }
      body { margin: 0; height: 100dvh; overflow: hidden; background: radial-gradient(circle at 20% 0%, rgba(168,85,247,.20), transparent 36%), linear-gradient(135deg, var(--auvrynt-bg), var(--auvrynt-surface) 52%, var(--auvrynt-bg-deep)); color: var(--auvrynt-text); display: flex; align-items: center; justify-content: center; }
      main { width: min(100%, 760px); max-height: 100dvh; overflow: hidden; }
      .form-panel { padding: clamp(18px, 4vh, 42px) clamp(20px, 5vw, 52px); }
      .brand-icon { width: 52px; height: 52px; display: block; margin: 0 0 14px; border-radius: 12px; object-fit: cover; }
      .eyebrow { margin: 0 0 7px; color: var(--auvrynt-accent-soft); font-size: 10px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
      .form-panel h2 { margin: 0 0 7px; font-size: clamp(26px, 4vh, 34px); line-height: 1.05; letter-spacing: -.045em; }
      .intro { max-width: 660px; margin: 0 0 12px; color: var(--auvrynt-text-secondary); font-size: 14px; line-height: 1.45; }
      .client-badge { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 12px; color: #f3e8ff; font-size: 13px; font-weight: 650; }
      .client-badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--auvrynt-accent); }
      .section-label { margin: 0 0 5px; color: var(--auvrynt-text-muted); font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
      .scope-list { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-wrap: wrap; column-gap: 22px; row-gap: 3px; }
      .scope-list li { flex: 1 1 46%; min-width: 260px; padding: 2px 0; color: #c4b5fd; font-size: 11px; line-height: 1.3; }
      .scope-list li strong { color: #fff7ff; font-size: 11px; font-weight: 700; }
      .token-group { margin-bottom: 12px; }
      .token-group label { display: block; margin-bottom: 5px; color: #dce6f1; font-size: 12px; font-weight: 650; }
      .input-wrapper { position: relative; }
      .input-wrapper input { width: 100%; padding: 11px 12px; border: 1px solid var(--auvrynt-border); border-radius: var(--auvrynt-radius); background: var(--auvrynt-code); color: var(--auvrynt-text); font: inherit; font-size: 14px; outline: none; }
      .input-wrapper input:focus { border-color: var(--auvrynt-accent); box-shadow: 0 0 0 2px rgba(192,132,252,.20); }
      .input-wrapper input::placeholder { color: #657388; }
      .button-group { display: flex; gap: 8px; }
      .button-group button { flex: 1; min-height: 42px; border-radius: 7px; padding: 10px 12px; font: inherit; font-size: 13px; font-weight: 750; cursor: pointer; }
      .button-group button:focus-visible { outline: 2px solid var(--auvrynt-accent); outline-offset: 2px; }
      .btn-approve { border: 1px solid var(--auvrynt-accent); color: var(--auvrynt-surface); background: linear-gradient(135deg, var(--auvrynt-accent-soft), var(--auvrynt-accent)); }
      .btn-deny { border: 1px solid rgba(216,180,254,.35); color: #f3e8ff; background: transparent; }
      .error { display: block; margin: 0 0 10px; color: var(--auvrynt-danger); font-size: 12px; line-height: 1.35; }
      .privilege-note { margin: -2px 0 10px; color: #e9d5ff; font-size: 11px; line-height: 1.35; }
      .privilege-note strong { color: #f5d0fe; }
      .security-note { display: flex; gap: 7px; margin: 10px 0 0; color: #a78bfa; font-size: 11px; line-height: 1.35; }
      .submit-status { min-height: 16px; margin: 8px 0 0; color: #c4b5fd; font-size: 11px; line-height: 1.35; }
      .security-note::before { content: "✓"; color: var(--auvrynt-accent); font-weight: 800; }
      @media (max-width: 620px) { body { align-items: flex-start; } .form-panel { padding: 14px 18px; } .scope-list li { min-width: 100%; } }
      @media (max-height: 680px) { .brand-icon { width: 40px; height: 40px; margin-bottom: 8px; } .intro, .client-badge, .scope-list { margin-bottom: 8px; } .scope-list li { font-size: 10px; padding: 0; } .form-panel h2 { font-size: 26px; } }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    </style>
  </head>
  <body>
    <main role="main" aria-labelledby="authorize-title">
      <section class="form-panel">
        <img class="brand-icon" src="/brand-assets/auvrynt-icon.png" alt="Auvrynt" width="64" height="64" />
        <p class="eyebrow">Secure handshake</p>
        <h2 id="authorize-title">Approve this connection</h2>
        <p class="intro">Review what the web agent can do in your workspace, then confirm with your local owner token.</p>
        ${error}
        <div class="client-badge">${htmlEscape(params.clientName)}</div>
        <p class="section-label">Requested permissions</p>
        <ul class="scope-list" aria-label="Requested permissions">
          ${scopeItems}
        </ul>
        ${privilegeNote}
        <form id="authorization-form" method="post" action="/authorize" aria-describedby="token-desc">
          <div class="token-group">
            <label for="owner_token">Local owner token</label>
            <p id="token-desc" class="sr-only">Enter your Auvrynt owner token to authorize this connection. This token stays on this page and is never shared with the web agent.</p>
            <div class="input-wrapper">
              <input id="owner_token" name="owner_token" type="password" placeholder="Enter your owner token" autocomplete="off" autofocus required aria-required="true" />
            </div>
          </div>
${hiddenFields}
          <div class="button-group">
            <button type="submit" name="denied" value="true" class="btn-deny" formnovalidate>Deny request</button>
            <button type="submit" class="btn-approve">Approve connection</button>
          </div>
          <p id="approval-status" class="submit-status" role="status" aria-live="polite"></p>
        </form>
        <p class="security-note">Your owner token is validated locally. It is never sent to the web agent, stored in cookies, or written to logs.</p>
      </section>
    </main>
    <script nonce="${htmlEscape(params.nonce)}">
      (function() {
        var form = document.getElementById('authorization-form');
        var status = document.getElementById('approval-status');
        if (form && status) {
          form.addEventListener('submit', function(event) {
            if (event.submitter && event.submitter.name === 'denied') return;
            var approve = form.querySelector('.btn-approve');
            if (approve) {
              approve.textContent = 'Approving...';
              approve.setAttribute('aria-busy', 'true');
            }
            status.textContent = 'Approval submitted. Returning to your web agent...';
            var dashboardUrl = 'http://127.0.0.1:49321/dashboard';
            var dashboard = window.open(dashboardUrl, '_blank', 'noopener,noreferrer');
            if (!dashboard) status.textContent = 'Approved. Your browser blocked the dashboard tab; open ' + dashboardUrl + ' manually.';
            window.setTimeout(function() {
              if (!approve || approve.textContent !== 'Approving...') return;
              approve.textContent = 'Approve connection';
              approve.removeAttribute('aria-busy');
              status.textContent = 'Still waiting for the web agent callback. Keep this page open, then retry if the web agent does not finish connecting.';
            }, 8000);
          });
        }
      })();
    </script>
  </body>
</html>`;
}

function requestedScopesAllowed(requested: string[], supported: string[]): boolean {
  return requested.every((scope) => supported.includes(scope));
}

function redirectHostAllowed(redirectUri: string, allowedHosts: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (loopback) return parsed.protocol === "http:" || parsed.protocol === "https:";
  if (parsed.protocol !== "https:") return false;

  return allowedHosts.some((allowed) => {
    const h = allowed.toLowerCase();
    return h === "*" || hostname === h || hostname.endsWith(`.${h}`);
  });
}

function redirectHostDescription(redirectUri: string): string {
  try {
    const parsed = new URL(redirectUri);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return "invalid-uri";
  }
}

function authorizationNonce(): string {
  return randomBytes(18).toString("base64url");
}

function setAuthorizationSecurityHeaders(res: Response, nonce: string, redirectUri?: string): void {
  let redirectOrigin: string | undefined;
  try {
    redirectOrigin = redirectUri ? new URL(redirectUri).origin : undefined;
  } catch {
    redirectOrigin = undefined;
  }
  const formAction = ["'self'", redirectOrigin].filter(Boolean).join(" ");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
  );
}

function sendAuthorizationForm(
  res: Response,
  params: Omit<Parameters<typeof formHtml>[0], "nonce">,
  status: number,
): void {
  const nonce = authorizationNonce();
  setAuthorizationSecurityHeaders(res, nonce, params.fields.redirect_uri);
  res.status(status).setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(formHtml({ ...params, nonce }));
}

export class InMemoryOAuthClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly staticClients = new Map<string, OAuthClientInformationFull>();

  constructor(
    private readonly allowedRedirectHosts: string[],
    initialClients: OAuthClientInformationFull[] = [],
    private readonly onChange?: () => void,
    private readonly isClientInUse: (clientId: string) => boolean = () => false,
    private readonly onEvictClient?: (clientId: string) => void,
    staticClients: OAuthClientInformationFull[] = [],
  ) {
    for (const client of initialClients) {
      if (client.client_id) this.clients.set(client.client_id, client);
    }
    for (const client of staticClients) {
      if (client.client_id) {
        this.staticClients.set(client.client_id, client);
        this.clients.set(client.client_id, client);
      }
    }
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId) ?? this.staticClients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    if (this.clients.size >= MAX_DYNAMIC_CLIENTS && !this.evictOldestInactiveClient()) {
      throw new InvalidRequestError("Dynamic OAuth client capacity reached while all registered clients are active.");
    }
    const rejectedRedirectHosts = client.redirect_uris
      .filter((uri) => !redirectHostAllowed(uri, this.allowedRedirectHosts))
      .map(redirectHostDescription);
    if (rejectedRedirectHosts.length > 0) {
      throw new InvalidRequestError(
        `Client redirect_uri is not allowed for this Auvrynt server (rejected host(s): ${rejectedRedirectHosts.join(", ")})`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const registered: OAuthClientInformationFull = {
      ...client,
      client_id: `auvrynt-${randomUUID()}`,
      client_id_issued_at: now,
      token_endpoint_auth_method: client.token_endpoint_auth_method ?? "none",
      grant_types: client.grant_types ?? ["authorization_code", "refresh_token"],
      response_types: client.response_types ?? ["code"],
    };
    this.clients.set(registered.client_id, registered);
    this.onChange?.();
    return registered;
  }

  allClients(): OAuthClientInformationFull[] {
    return [...this.clients.values()];
  }

  private evictOldestInactiveClient(): boolean {
    const candidates = [...this.clients.values()]
      .filter((registered) => !this.staticClients.has(registered.client_id))
      .sort(
        (left, right) => (left.client_id_issued_at ?? 0) - (right.client_id_issued_at ?? 0),
      );
    const inactive = candidates.find((registered) => !this.isClientInUse(registered.client_id));
    if (inactive) {
      this.onEvictClient?.(inactive.client_id);
      return this.clients.delete(inactive.client_id);
    }
    const oldest = candidates[0];
    if (!oldest) return false;
    this.onEvictClient?.(oldest.client_id);
    return this.clients.delete(oldest.client_id);
  }
}

export class SingleUserOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private readonly codes = new Map<string, AuthorizationCodeRecord>();
  private readonly accessTokens = new Map<string, AccessTokenRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();
  private readonly resourceServerUrl: URL;
  private readonly stateFile?: string;

  constructor(
    private readonly config: OAuthConfig,
    resourceServerUrl: URL,
    stateFile?: string,
  ) {
    this.resourceServerUrl = resourceUrlFromServerUrl(resourceServerUrl);
    this.stateFile = stateFile;
    const persisted = this.loadState();
    const staticClients: OAuthClientInformationFull[] = (config.staticClients ?? []).map((sc) => ({
      client_id: sc.clientId,
      client_secret: sc.clientSecret,
      client_name: sc.clientName ?? "Configured Static Client",
      redirect_uris: sc.redirectUris,
      token_endpoint_auth_method: sc.clientSecret ? "client_secret_post" : "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    }));
    this.clientsStore = new InMemoryOAuthClientsStore(
      config.allowedRedirectHosts,
      persisted?.clients,
      () => this.persistState(),
      (clientId) => this.clientHasActiveGrant(clientId),
      (clientId) => this.revokeClientGrants(clientId),
      staticClients,
    );
    for (const [code, record] of persisted?.codes ?? []) {
      this.codes.set(code, {
        ...record,
        params: {
          ...record.params,
          resource: record.params.resource ? new URL(record.params.resource) : undefined,
        },
      });
    }
    for (const [tokenHash, record] of persisted?.accessTokens ?? []) {
      this.accessTokens.set(tokenHash, {
        ...record,
        resource: record.resource ? new URL(record.resource) : undefined,
      });
    }
    for (const [tokenHash, record] of persisted?.refreshTokens ?? []) {
      this.refreshTokens.set(tokenHash, {
        ...record,
        resource: record.resource ? new URL(record.resource) : undefined,
      });
    }
    this.pruneExpired();
    this.persistState();
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Some hosted MCP clients (including Bolt) omit the RFC 8707 resource
    // parameter even after discovering the protected-resource metadata. Bind
    // an omitted value to this server; never accept a different resource.
    const requestedResource = params.resource ?? this.resourceServerUrl;
    if (!checkResourceAllowed({ requestedResource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidRequestError("Invalid or missing OAuth resource");
    }
    params = { ...params, resource: requestedResource };
    if (!requestedScopesAllowed(params.scopes ?? [], this.config.scopes)) {
      throw new InvalidRequestError("Requested scope is not supported");
    }

    const req = res.req as Request;
    const queryError = req.query?.error as string | undefined;

    if (queryError === "access_denied") {
      throw new AccessDeniedError("Authorization denied by user");
    }

    if (req.method !== "POST") {
      sendAuthorizationForm(res, {
        clientName: client.client_name ?? client.client_id,
        scopes: params.scopes ?? this.config.scopes,
        resource: params.resource,
        fields: authorizationFormFields(client, params),
      }, 200);
      return;
    }

    if (req.body?.denied === "true") {
      throw new AccessDeniedError("Authorization denied by user");
    }

    const providedToken = String(req.body?.owner_token ?? "");
    if (!safeEquals(providedToken, this.config.ownerToken)) {
      sendAuthorizationForm(res, {
        error: "The owner token was not accepted.",
        clientName: client.client_name ?? client.client_id,
        scopes: params.scopes ?? this.config.scopes,
        resource: params.resource,
        fields: authorizationFormFields(client, params),
      }, 401);
      return;
    }

    this.pruneExpired();
    if (this.codes.size >= MAX_AUTHORIZATION_CODES) {
      throw new InvalidRequestError("Too many pending authorization requests. Try again after older requests expire.");
    }
    const code = `code-${randomUUID()}`;
    this.codes.set(code, {
      clientId: client.client_id,
      params,
      expiresAtMs: Date.now() + CODE_TTL_MS,
    });
    this.persistState();
    if (this.config.logging) {
      logEvent(this.config.logging, "info", "oauth_authorization_approved", {
        clientId: client.client_id,
        clientName: client.client_name ?? client.client_id,
        scopes: params.scopes ?? this.config.scopes,
      });
    }

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (params.state !== undefined) redirectUrl.searchParams.set("state", params.state);
    res.redirect(302, redirectUrl.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = this.validCodeRecord(client, authorizationCode);
    return record.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.validCodeRecord(client, authorizationCode);
    if (redirectUri && redirectUri !== record.params.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Invalid resource");
    }

    this.codes.delete(authorizationCode);
    const tokens = this.issueTokens(client.client_id, record.params.scopes ?? this.config.scopes, record.params.resource);
    this.persistState();
    return tokens;
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.refreshTokens.get(hashToken(refreshToken));
    if (!record || record.clientId !== client.client_id || record.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Invalid resource");
    }

    const requestedScopes = scopes ?? record.scopes;
    if (!requestedScopes.every((scope) => record.scopes.includes(scope))) {
      throw new AccessDeniedError("Refresh token cannot grant requested scopes");
    }

    this.refreshTokens.delete(hashToken(refreshToken));
    const tokens = this.issueTokens(client.client_id, requestedScopes, resource ?? record.resource);
    this.persistState();
    return tokens;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    this.pruneExpired();

    // Header-only MCP clients (e.g. Clusy) cannot run the browser /authorize
    // flow. Accept the Owner token as a long-lived Bearer credential that
    // grants the configured OAuth scopes. OAuth access tokens still take
    // precedence when present.
    if (safeEquals(token, this.config.ownerToken)) {
      return {
        token,
        clientId: "auvrynt-owner-bearer",
        scopes: [...this.config.scopes],
        expiresAt: Math.floor(Date.now() / 1000) + this.config.accessTokenTtlSeconds,
        resource: this.resourceServerUrl,
      };
    }

    const record = this.accessTokens.get(hashToken(token));
    if (!record || record.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidTokenError("Invalid or expired access token");
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      resource: record.resource,
    };
  }

  /**
   * A local profile change is an explicit owner action. Extend existing grants
   * only with scopes already allowed by server configuration so connected web
   * agents can use the newly enabled profile without a forced OAuth reconnect.
   */
  grantScopesToExistingTokens(scopes: readonly string[]): number {
    const allowed = scopes.filter((scope) => this.config.scopes.includes(scope));
    if (allowed.length === 0) return 0;

    let updated = 0;
    const extend = (record: AccessTokenRecord | RefreshTokenRecord): void => {
      const next = Array.from(new Set([...record.scopes, ...allowed]));
      if (next.length === record.scopes.length) return;
      record.scopes = next;
      updated++;
    };
    for (const record of this.accessTokens.values()) extend(record);
    for (const record of this.refreshTokens.values()) extend(record);
    if (updated > 0) this.persistState();
    return updated;
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hashed = hashToken(request.token);
    this.accessTokens.delete(hashed);
    this.refreshTokens.delete(hashed);
    this.persistState();
  }

  private validCodeRecord(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): AuthorizationCodeRecord {
    const record = this.codes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id || record.expiresAtMs < Date.now()) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    return record;
  }

  private revokeClientGrants(clientId: string): void {
    for (const [code, record] of this.codes) {
      if (record.clientId === clientId) this.codes.delete(code);
    }
    for (const [hash, record] of this.accessTokens) {
      if (record.clientId === clientId) this.accessTokens.delete(hash);
    }
    for (const [hash, record] of this.refreshTokens) {
      if (record.clientId === clientId) this.refreshTokens.delete(hash);
    }
  }

  private clientHasActiveGrant(clientId: string): boolean {
    this.pruneExpired();
    for (const record of this.codes.values()) {
      if (record.clientId === clientId) return true;
    }
    for (const record of this.accessTokens.values()) {
      if (record.clientId === clientId) return true;
    }
    for (const record of this.refreshTokens.values()) {
      if (record.clientId === clientId) return true;
    }
    return false;
  }

  private issueTokens(clientId: string, scopes: string[], resource?: URL): OAuthTokens {
    this.pruneExpired();
    if (this.accessTokens.size >= MAX_ACCESS_TOKENS || this.refreshTokens.size >= MAX_REFRESH_TOKENS) {
      throw new InvalidGrantError("OAuth token capacity reached. Revoke stale clients or restart Auvrynt.");
    }

    const now = Math.floor(Date.now() / 1000);
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessExpiresAt = now + this.config.accessTokenTtlSeconds;
    const refreshExpiresAt = now + this.config.refreshTokenTtlSeconds;

    this.accessTokens.set(hashToken(accessToken), {
      clientId,
      scopes,
      expiresAt: accessExpiresAt,
      resource,
    });
    this.refreshTokens.set(hashToken(refreshToken), {
      clientId,
      scopes,
      expiresAt: refreshExpiresAt,
      resource,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  private pruneExpired(): void {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();
    for (const [code, record] of this.codes) {
      if (record.expiresAtMs < nowMs) this.codes.delete(code);
    }
    for (const [tokenHash, record] of this.accessTokens) {
      if (record.expiresAt < nowSeconds) this.accessTokens.delete(tokenHash);
    }
    for (const [tokenHash, record] of this.refreshTokens) {
      if (record.expiresAt < nowSeconds) this.refreshTokens.delete(tokenHash);
    }
  }

  private loadState(): PersistedOAuthState | undefined {
    if (!this.stateFile) return undefined;
    try {
      const state = JSON.parse(readFileSync(this.stateFile, "utf8")) as PersistedOAuthState;
      if (state.version !== 1 || state.resourceServerUrl !== this.resourceServerUrl.href) return undefined;
      return state;
    } catch {
      return undefined;
    }
  }

  private persistState(): void {
    if (!this.stateFile || !(this.clientsStore instanceof InMemoryOAuthClientsStore)) return;
    const state: PersistedOAuthState = {
      version: 1,
      resourceServerUrl: this.resourceServerUrl.href,
      clients: this.clientsStore.allClients(),
      codes: [...this.codes.entries()].map(([code, record]) => [code, {
        ...record,
        params: {
          ...record.params,
          resource: record.params.resource?.href,
        },
      }]),
      accessTokens: [...this.accessTokens.entries()].map(([tokenHash, record]) => [tokenHash, {
        ...record,
        resource: record.resource?.href,
      }]),
      refreshTokens: [...this.refreshTokens.entries()].map(([tokenHash, record]) => [tokenHash, {
        ...record,
        resource: record.resource?.href,
      }]),
    };
    mkdirSync(dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, this.stateFile);
    chmodSync(this.stateFile, 0o600);
  }
}

function authorizationFormFields(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
): Record<string, string | undefined> {
  return {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    scope: params.scopes?.join(" "),
    state: params.state,
    resource: params.resource?.href,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
