import { createHash } from "node:crypto";
import {
  loadAuvryntFiles,
  writeAuvryntAuth,
  type AuvryntFiles,
} from "./user-config.js";

export interface Context7AuthSummary {
  configured: boolean;
  fingerprint?: string;
  environmentOverride: boolean;
}

export interface Context7AuthMutationResult {
  summary: Context7AuthSummary;
}

export function validateContext7ApiKey(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a valid Context7 API key.");
  const key = value.trim();
  if (key.length < 8 || key.length > 512) {
    throw new Error("Context7 API keys must be between 8 and 512 characters.");
  }
  if (/\s|[\u0000-\u001f\u007f]/u.test(key)) {
    throw new Error("Context7 API keys must not contain whitespace or control characters.");
  }
  return key;
}

export function context7ApiKeyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 10).toUpperCase();
}

export function resolveContext7ApiKey(
  files: AuvryntFiles = loadAuvryntFiles(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const override = env.AUVRYNT_CONTEXT7_API_KEY?.trim();
  if (override) return override;
  const stored = files.auth.context7ApiKey?.trim();
  return stored || undefined;
}

export function summarizeContext7Auth(
  files: AuvryntFiles = loadAuvryntFiles(),
  env: NodeJS.ProcessEnv = process.env,
): Context7AuthSummary {
  const environmentOverride = Boolean(env.AUVRYNT_CONTEXT7_API_KEY?.trim());
  const key = resolveContext7ApiKey(files, env);
  if (!key) {
    return { configured: false, environmentOverride };
  }
  return {
    configured: true,
    fingerprint: context7ApiKeyFingerprint(key),
    environmentOverride,
  };
}

export function setContext7ApiKey(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Context7AuthMutationResult {
  if (env.AUVRYNT_CONTEXT7_API_KEY?.trim()) {
    throw new Error(
      "AUVRYNT_CONTEXT7_API_KEY is set in the environment. Remove that override before saving a key in Secrets.",
    );
  }
  const key = validateContext7ApiKey(value);
  const files = loadAuvryntFiles(env);
  writeAuvryntAuth({ ...files.auth, context7ApiKey: key }, env);
  return { summary: summarizeContext7Auth(loadAuvryntFiles(env), env) };
}

export function clearContext7ApiKey(
  env: NodeJS.ProcessEnv = process.env,
): Context7AuthMutationResult {
  if (env.AUVRYNT_CONTEXT7_API_KEY?.trim()) {
    throw new Error(
      "AUVRYNT_CONTEXT7_API_KEY is set in the environment. Remove that override before clearing the saved key.",
    );
  }
  const files = loadAuvryntFiles(env);
  const next = { ...files.auth };
  delete next.context7ApiKey;
  writeAuvryntAuth(next, env);
  return { summary: summarizeContext7Auth(loadAuvryntFiles(env), env) };
}
