import { createHash } from "node:crypto";
import {
  loadAuvryntFiles,
  writeAuvryntAuth,
  writeAuvryntConfig,
  type AuvryntFiles,
} from "./user-config.js";

export const MAX_NGROK_AUTHTOKENS = 20;

export interface NgrokAuthtokenSummary {
  index: number;
  fingerprint: string;
  active: boolean;
  quotaExhaustedAt?: string;
}

export interface NgrokAuthtokenPoolSummary {
  enabled: boolean;
  environmentOverride: boolean;
  activeIndex: number | null;
  tokens: NgrokAuthtokenSummary[];
}

export interface NgrokAuthtokenMutationResult {
  summary: NgrokAuthtokenPoolSummary;
  activeChanged: boolean;
}

export interface NgrokQuotaRotationResult {
  environmentOverride: boolean;
  current?: NgrokAuthtokenSummary;
  next?: NgrokAuthtokenSummary;
  summary: NgrokAuthtokenPoolSummary;
}

interface NgrokAuthtokenPool {
  tokens: string[];
  activeIndex: number | null;
  quotaExhausted: Record<string, string>;
  environmentOverride: boolean;
}

export function validateNgrokAuthtoken(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a valid ngrok authtoken.");
  const token = value.trim();
  if (token.length < 16 || token.length > 512) {
    throw new Error("ngrok authtokens must be between 16 and 512 characters.");
  }
  if (/\s|[\u0000-\u001f\u007f]/u.test(token)) {
    throw new Error("ngrok authtokens must not contain whitespace or control characters.");
  }
  return token;
}

export function ngrokAuthtokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 10).toUpperCase();
}

export function resolveNgrokAuthtoken(
  files: AuvryntFiles = loadAuvryntFiles(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const override = env.AUVRYNT_NGROK_AUTHTOKEN?.trim();
  if (override) return override;
  const pool = readPool(files, env);
  return pool.activeIndex === null ? undefined : pool.tokens[pool.activeIndex];
}

export function getCurrentNgrokAuthtoken(
  files: AuvryntFiles = loadAuvryntFiles(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveNgrokAuthtoken(files, env);
}

export function summarizeNgrokAuthtokens(
  files: AuvryntFiles = loadAuvryntFiles(),
  env: NodeJS.ProcessEnv = process.env,
): NgrokAuthtokenPoolSummary {
  return summarizePool(readPool(files, env));
}

export function addNgrokAuthtoken(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): NgrokAuthtokenMutationResult {
  const token = validateNgrokAuthtoken(value);
  const files = loadAuvryntFiles(env);
  const pool = readPool(files, env);
  if (pool.tokens.includes(token)) throw new Error("That ngrok authtoken is already saved.");
  if (pool.tokens.length >= MAX_NGROK_AUTHTOKENS) {
    throw new Error(`A maximum of ${MAX_NGROK_AUTHTOKENS} ngrok authtokens can be saved.`);
  }
  const previousActiveToken = activeToken(pool);
  pool.tokens.push(token);
  if (pool.activeIndex === null || activeTokenIsExhausted(pool)) {
    pool.activeIndex = firstAvailableTokenIndex(pool) ?? pool.tokens.length - 1;
  }
  const activeChanged = previousActiveToken !== activeToken(pool);
  persistPool(files, pool, env);
  return { summary: summarizePool(pool), activeChanged };
}

export function removeNgrokAuthtoken(
  index: unknown,
  env: NodeJS.ProcessEnv = process.env,
): NgrokAuthtokenMutationResult {
  const files = loadAuvryntFiles(env);
  const pool = readPool(files, env);
  const tokenIndex = parseTokenIndex(index, pool.tokens.length);
  const previousActive = pool.activeIndex;
  const previousActiveToken = activeToken(pool);
  const [removed] = pool.tokens.splice(tokenIndex, 1);
  if (removed) delete pool.quotaExhausted[ngrokAuthtokenFingerprint(removed)];

  if (pool.tokens.length === 0) {
    pool.activeIndex = null;
  } else if (previousActive === null) {
    pool.activeIndex = 0;
  } else if (tokenIndex < previousActive) {
    pool.activeIndex = previousActive - 1;
  } else if (tokenIndex === previousActive) {
    pool.activeIndex = Math.min(tokenIndex, pool.tokens.length - 1);
  }

  if (activeTokenIsExhausted(pool)) {
    pool.activeIndex = firstAvailableTokenIndex(pool) ?? pool.activeIndex;
  }
  const activeChanged = previousActiveToken !== activeToken(pool);
  persistPool(files, pool, env);
  return { summary: summarizePool(pool), activeChanged };
}

export function activateNgrokAuthtoken(
  index: unknown,
  env: NodeJS.ProcessEnv = process.env,
): NgrokAuthtokenMutationResult {
  if (env.AUVRYNT_NGROK_AUTHTOKEN?.trim()) {
    throw new Error("AUVRYNT_NGROK_AUTHTOKEN is overriding the saved token pool. Remove that environment variable before switching tokens here.");
  }
  const files = loadAuvryntFiles(env);
  const pool = readPool(files, env);
  const tokenIndex = parseTokenIndex(index, pool.tokens.length);
  const fingerprint = ngrokAuthtokenFingerprint(pool.tokens[tokenIndex]!);
  const activeChanged = pool.activeIndex !== tokenIndex || Boolean(pool.quotaExhausted[fingerprint]);
  pool.activeIndex = tokenIndex;
  delete pool.quotaExhausted[fingerprint];
  persistPool(files, pool, env);
  return { summary: summarizePool(pool), activeChanged };
}

export function markActiveNgrokAuthtokenQuotaExceeded(
  exhaustedAt = new Date().toISOString(),
  env: NodeJS.ProcessEnv = process.env,
): NgrokQuotaRotationResult {
  const files = loadAuvryntFiles(env);
  const pool = readPool(files, env);
  if (pool.environmentOverride) {
    return {
      environmentOverride: true,
      summary: summarizePool(pool),
    };
  }
  if (pool.activeIndex === null || pool.tokens.length === 0) {
    return {
      environmentOverride: false,
      summary: summarizePool(pool),
    };
  }

  const currentIndex = pool.activeIndex;
  const currentToken = pool.tokens[currentIndex]!;
  const currentFingerprint = ngrokAuthtokenFingerprint(currentToken);
  pool.quotaExhausted[currentFingerprint] = exhaustedAt;

  let nextIndex: number | null = null;
  for (let offset = 1; offset < pool.tokens.length; offset++) {
    const candidateIndex = (currentIndex + offset) % pool.tokens.length;
    const candidateFingerprint = ngrokAuthtokenFingerprint(pool.tokens[candidateIndex]!);
    if (!pool.quotaExhausted[candidateFingerprint]) {
      nextIndex = candidateIndex;
      break;
    }
  }
  if (nextIndex !== null) pool.activeIndex = nextIndex;
  persistPool(files, pool, env);
  const summary = summarizePool(pool);
  return {
    environmentOverride: false,
    current: summary.tokens.find((token) => token.fingerprint === currentFingerprint),
    next: nextIndex === null ? undefined : summary.tokens.find((token) => token.index === nextIndex),
    summary,
  };
}

function readPool(files: AuvryntFiles, env: NodeJS.ProcessEnv): NgrokAuthtokenPool {
  const environmentOverride = Boolean(env.AUVRYNT_NGROK_AUTHTOKEN?.trim());
  const saved = Array.isArray(files.auth.ngrokAuthtokens)
    ? files.auth.ngrokAuthtokens.map((token) => token.trim()).filter(Boolean)
    : [];
  const legacy = files.config.ngrokAuthtoken?.trim();
  const tokens = deduplicate(legacy ? [...saved, legacy] : saved);
  const configuredIndex = files.auth.ngrokActiveAuthtokenIndex;
  const activeIndex = tokens.length === 0
    ? null
    : Number.isInteger(configuredIndex) && configuredIndex! >= 0 && configuredIndex! < tokens.length
      ? configuredIndex!
      : 0;
  return {
    tokens,
    activeIndex,
    quotaExhausted: { ...(files.auth.ngrokQuotaExhausted ?? {}) },
    environmentOverride,
  };
}

function persistPool(
  files: AuvryntFiles,
  pool: NgrokAuthtokenPool,
  env: NodeJS.ProcessEnv,
): void {
  const validFingerprints = new Set(pool.tokens.map(ngrokAuthtokenFingerprint));
  const quotaExhausted = Object.fromEntries(
    Object.entries(pool.quotaExhausted).filter(([fingerprint]) => validFingerprints.has(fingerprint)),
  );
  const nextAuth = {
    ...files.auth,
    ngrokAuthtokens: pool.tokens,
    ngrokQuotaExhausted: quotaExhausted,
  };
  if (pool.activeIndex === null) delete nextAuth.ngrokActiveAuthtokenIndex;
  else nextAuth.ngrokActiveAuthtokenIndex = pool.activeIndex;
  writeAuvryntAuth(nextAuth, env);
  if (files.config.ngrokAuthtoken !== undefined) {
    const nextConfig = { ...files.config };
    delete nextConfig.ngrokAuthtoken;
    writeAuvryntConfig(nextConfig, env);
  }
}

function summarizePool(pool: NgrokAuthtokenPool): NgrokAuthtokenPoolSummary {
  return {
    enabled: pool.tokens.length > 0,
    environmentOverride: pool.environmentOverride,
    activeIndex: pool.environmentOverride ? null : pool.activeIndex,
    tokens: pool.tokens.map((token, index) => {
      const fingerprint = ngrokAuthtokenFingerprint(token);
      return {
        index,
        fingerprint,
        active: !pool.environmentOverride && index === pool.activeIndex,
        ...(pool.quotaExhausted[fingerprint]
          ? { quotaExhaustedAt: pool.quotaExhausted[fingerprint] }
          : {}),
      };
    }),
  };
}

function activeToken(pool: NgrokAuthtokenPool): string | undefined {
  return pool.activeIndex === null ? undefined : pool.tokens[pool.activeIndex];
}

function activeTokenIsExhausted(pool: NgrokAuthtokenPool): boolean {
  const token = activeToken(pool);
  return Boolean(token && pool.quotaExhausted[ngrokAuthtokenFingerprint(token)]);
}

function firstAvailableTokenIndex(pool: NgrokAuthtokenPool): number | null {
  const index = pool.tokens.findIndex(
    (token) => !pool.quotaExhausted[ngrokAuthtokenFingerprint(token)],
  );
  return index >= 0 ? index : null;
}

function parseTokenIndex(value: unknown, length: number): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error("Select a valid saved ngrok token.");
  }
  return index;
}

function deduplicate(tokens: string[]): string[] {
  return Array.from(new Set(tokens));
}
