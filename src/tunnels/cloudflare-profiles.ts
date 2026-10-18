import { join } from "node:path";
import { auvryntConfigDir, type AuvryntAuthConfig } from "../infrastructure/user-config.js";

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_PROFILES = 2;

export interface CloudflareAccountProfile {
  name: string;
  certPath: string;
}

export function normalizeCloudflareProfileName(value: string): string {
  const name = value.trim().toLowerCase();
  if (!PROFILE_NAME.test(name)) {
    throw new Error("Cloudflare profile names must start with a-z or 0-9 and contain only lowercase letters, numbers, _ or - (max 32 characters).");
  }
  return name;
}

export function cloudflareProfileCertPath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = normalizeCloudflareProfileName(name);
  return join(auvryntConfigDir(env), "cloudflare", normalized, "cert.pem");
}

export function upsertCloudflareProfile(
  auth: AuvryntAuthConfig,
  name: string,
  certPath: string,
): AuvryntAuthConfig {
  const normalized = normalizeCloudflareProfileName(name);
  const profiles = [...(auth.cloudflareProfiles ?? [])];
  const index = profiles.findIndex((profile) => profile.name === normalized);
  if (index < 0 && profiles.length >= MAX_PROFILES) {
    throw new Error("Auvrynt supports at most two local Cloudflare account profiles.");
  }
  const profile: CloudflareAccountProfile = { name: normalized, certPath };
  if (index < 0) profiles.push(profile);
  else profiles[index] = profile;
  return {
    ...auth,
    cloudflareProfiles: profiles,
    cloudflareActiveProfile: auth.cloudflareActiveProfile ?? normalized,
  };
}

export function selectCloudflareProfile(auth: AuvryntAuthConfig, name: string): AuvryntAuthConfig {
  const normalized = normalizeCloudflareProfileName(name);
  if (!(auth.cloudflareProfiles ?? []).some((profile) => profile.name === normalized)) {
    throw new Error(`Cloudflare profile '${normalized}' is not configured. Run auvrynt cloudflare login first.`);
  }
  return { ...auth, cloudflareActiveProfile: normalized };
}
