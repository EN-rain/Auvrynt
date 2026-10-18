import { randomBytes } from "node:crypto";
import type { JobsServerConfig } from "../../../infrastructure/config.js";
import { JobsStore } from "../../store.js";

export type FacebookOAuthConfig = JobsServerConfig["integrations"]["facebook"];
export type FacebookOAuthErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_CALLBACK"
  | "EXCHANGE_FAILED"
  | "PROFILE_FAILED"
  | "STORE_FAILED";

export class FacebookOAuthError extends Error {
  constructor(readonly code: FacebookOAuthErrorCode) {
    super(code);
    this.name = "FacebookOAuthError";
  }
}

interface PendingAuthorization {
  redirectUri: string;
  createdAt: number;
}

export interface FacebookOAuthCallback {
  state: unknown;
  code: unknown;
  redirectUri: string;
}

export interface FacebookFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FacebookFetch = (input: string | URL, init?: RequestInit) => Promise<FacebookFetchResponse>;

interface FacebookOAuthDependencies {
  fetch?: FacebookFetch;
  now?: () => number;
  state?: () => string;
}

export interface FacebookOAuthCompletion {
  accountId: string;
  accountName?: string;
  tokenExpiresAt?: string;
}

const STATE_TTL_MS = 10 * 60_000;
const FACEBOOK_AUTH_ORIGIN = "https://www.facebook.com";
const FACEBOOK_GRAPH_ORIGIN = "https://graph.facebook.com";
export const FACEBOOK_CALLBACK_PATH = "/dashboard/jobs/integrations/facebook/callback";

/**
 * Server-side Facebook login coordinator. It only exposes an authorization
 * URL to the local dashboard; exchanged tokens are immediately handed to the
 * JobsStore and are never returned by a route.
 */
export class FacebookOAuthManager {
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly fetchImpl: FacebookFetch;
  private readonly now: () => number;
  private readonly stateFactory: () => string;

  constructor(dependencies: FacebookOAuthDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = dependencies.now ?? Date.now;
    this.stateFactory = dependencies.state ?? (() => randomBytes(32).toString("base64url"));
  }

  begin(config: FacebookOAuthConfig, redirectUri: string): string {
    assertConfigured(config);
    if (!isSafeLoopbackRedirect(redirectUri)) throw new FacebookOAuthError("NOT_CONFIGURED");
    this.removeExpiredStates();
    const state = this.stateFactory();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new FacebookOAuthError("INVALID_CALLBACK");
    this.pending.set(state, { redirectUri, createdAt: this.now() });
    const authorization = new URL("/dialog/oauth", FACEBOOK_AUTH_ORIGIN);
    authorization.searchParams.set("client_id", config.appId!);
    authorization.searchParams.set("redirect_uri", redirectUri);
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("scope", "public_profile");
    authorization.searchParams.set("response_type", "code");
    return authorization.toString();
  }

  async complete(config: FacebookOAuthConfig, store: JobsStore, callback: FacebookOAuthCallback): Promise<FacebookOAuthCompletion> {
    assertConfigured(config);
    const state = boundedString(callback.state, 128);
    const code = boundedString(callback.code, 4096);
    const redirectUri = callback.redirectUri;
    if (!state || !code || !isSafeLoopbackRedirect(redirectUri)) throw new FacebookOAuthError("INVALID_CALLBACK");
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.redirectUri !== redirectUri || this.now() - pending.createdAt > STATE_TTL_MS) {
      throw new FacebookOAuthError("INVALID_CALLBACK");
    }

    const tokenResponse = await this.fetchToken(config, redirectUri, code);
    const accessToken = readToken(tokenResponse);
    if (!accessToken) throw new FacebookOAuthError("EXCHANGE_FAILED");
    const profileResponse = await this.fetchProfile(config, accessToken);
    const profile = readProfile(profileResponse);
    if (!profile) throw new FacebookOAuthError("PROFILE_FAILED");
    const tokenExpiresAt = readExpiry(tokenResponse, this.now());
    try {
      store.connectFacebook({
        accountId: profile.id,
        accountName: profile.name,
        accessToken,
        tokenExpiresAt,
      });
    } catch {
      throw new FacebookOAuthError("STORE_FAILED");
    }
    return { accountId: profile.id, accountName: profile.name, tokenExpiresAt };
  }

  pendingCount(): number {
    this.removeExpiredStates();
    return this.pending.size;
  }

  cancel(state: unknown): void {
    if (typeof state === "string") this.pending.delete(state);
  }

  private async fetchToken(config: FacebookOAuthConfig, redirectUri: string, code: string): Promise<unknown> {
    const endpoint = new URL(`/${config.graphVersion}/oauth/access_token`, FACEBOOK_GRAPH_ORIGIN);
    const body = new URLSearchParams({
      client_id: config.appId!,
      client_secret: config.appSecret!,
      redirect_uri: redirectUri,
      code,
    });
    let response: FacebookFetchResponse;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (response.status === 405) {
        const fallbackEndpoint = new URL(endpoint);
        for (const [key, value] of body) fallbackEndpoint.searchParams.set(key, value);
        response = await this.fetchImpl(fallbackEndpoint, { method: "GET", redirect: "error", headers: { accept: "application/json" } });
      }
    } catch {
      throw new FacebookOAuthError("EXCHANGE_FAILED");
    }
    if (!response.ok) throw new FacebookOAuthError("EXCHANGE_FAILED");
    try { return await response.json(); } catch { throw new FacebookOAuthError("EXCHANGE_FAILED"); }
  }

  private async fetchProfile(config: FacebookOAuthConfig, accessToken: string): Promise<unknown> {
    const endpoint = new URL(`/${config.graphVersion}/me`, FACEBOOK_GRAPH_ORIGIN);
    endpoint.searchParams.set("fields", "id,name");
    let response: FacebookFetchResponse;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new FacebookOAuthError("PROFILE_FAILED");
    }
    if (!response.ok) throw new FacebookOAuthError("PROFILE_FAILED");
    try { return await response.json(); } catch { throw new FacebookOAuthError("PROFILE_FAILED"); }
  }

  private removeExpiredStates(): void {
    const cutoff = this.now() - STATE_TTL_MS;
    for (const [state, pending] of this.pending) if (pending.createdAt < cutoff) this.pending.delete(state);
  }
}

function assertConfigured(config: FacebookOAuthConfig): void {
  if (!config.enabled || !config.appId || !config.appSecret || !/^v\d+\.\d+$/.test(config.graphVersion)) throw new FacebookOAuthError("NOT_CONFIGURED");
}

function isSafeLoopbackRedirect(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1") && parsed.pathname === FACEBOOK_CALLBACK_PATH && parsed.search === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

function readToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const token = (value as Record<string, unknown>).access_token;
  return typeof token === "string" && token.length > 0 && token.length <= 16_384 ? token : undefined;
}

function readProfile(value: unknown): { id: string; name?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 256) return undefined;
  const name = typeof record.name === "string" && record.name.length <= 256 ? record.name : undefined;
  return { id: record.id, name };
}

function readExpiry(value: unknown, nowMs: number): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const seconds = (value as Record<string, unknown>).expires_in;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 10 * 365 * 24 * 60 * 60) return undefined;
  return new Date(nowMs + Math.floor(seconds) * 1000).toISOString();
}
