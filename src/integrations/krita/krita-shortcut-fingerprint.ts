import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bump when the semantics of the shortcut registry or probe change. */
export const KRITA_SHORTCUT_SCHEMA_VERSION = 1;

export interface KritaInstallationFingerprintInput {
  executablePath?: string;
  executableVersion?: string;
  keyboardLayout?: string;
  schemaVersion?: number;
}

/**
 * Build a stable, non-secret fingerprint for the local Krita installation and
 * keyboard environment. The raw values are never returned or persisted.
 */
export function createKritaInstallationFingerprint(
  input: KritaInstallationFingerprintInput = {},
): string {
  const normalized = {
    executablePath: normalizeFingerprintPart(input.executablePath),
    executableVersion: normalizeFingerprintPart(input.executableVersion),
    keyboardLayout: normalizeFingerprintPart(input.keyboardLayout),
    schemaVersion: input.schemaVersion ?? KRITA_SHORTCUT_SCHEMA_VERSION,
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}

export function createKritaShortcutBindingFingerprint(
  installationFingerprint: string,
  keys: readonly string[],
): string {
  if (!/^sha256:[0-9a-f]{64}$/i.test(installationFingerprint)) {
    throw new Error("A valid Krita installation fingerprint is required.");
  }
  const normalizedKeys = keys.map((key) => key.trim().toUpperCase());
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ installationFingerprint, keys: normalizedKeys, schemaVersion: KRITA_SHORTCUT_SCHEMA_VERSION }))
    .digest("hex")}`;
}

/**
 * Resolve installation details without focusing Krita or reading the desktop.
 * Windows process metadata is best-effort; unknown values remain explicit in
 * the fingerprint so validation can safely require a fresh probe.
 */
export async function detectKritaInstallationFingerprint(processName = "krita"): Promise<string> {
  const override = process.env.AUVRYNT_KRITA_INSTALLATION_FINGERPRINT?.trim();
  if (override && /^sha256:[0-9a-f]{64}$/i.test(override)) return override.toLowerCase();

  const normalizedProcess = processName.trim().replace(/\.exe$/i, "");
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(normalizedProcess)) {
    throw new Error("Krita process name is invalid for fingerprint detection.");
  }

  let details: KritaInstallationFingerprintInput = {
    executablePath: "unknown",
    executableVersion: "unknown",
    keyboardLayout: process.env.AUVRYNT_KRITA_KEYBOARD_LAYOUT?.trim() || "unknown",
  };
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", buildFingerprintProbeScript(normalizedProcess)],
        { encoding: "utf8", timeout: 5_000, windowsHide: true, maxBuffer: 64 * 1024 },
      );
      const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
      details = {
        executablePath: typeof parsed.executablePath === "string" ? parsed.executablePath : "unknown",
        executableVersion: typeof parsed.executableVersion === "string" ? parsed.executableVersion : "unknown",
        keyboardLayout: typeof parsed.keyboardLayout === "string"
          ? parsed.keyboardLayout
          : details.keyboardLayout,
      };
    } catch {
      // Unknown installation metadata is deliberately fail-closed at prepare
      // time; it must not make an old validation look newly trusted.
    }
  }
  return createKritaInstallationFingerprint(details);
}

function normalizeFingerprintPart(value: string | undefined): string {
  const normalized = value?.trim().normalize("NFKC");
  return normalized ? normalized.slice(0, 1024) : "unknown";
}

function buildFingerprintProbeScript(processName: string): string {
  const escaped = processName.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$p = Get-Process -Name '${escaped}' -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "$path = if ($p) { [string]$p.Path } else { 'unknown' }",
    "$version = if ($p) { try { [string]$p.FileVersionInfo.FileVersion } catch { 'unknown' } } else { 'unknown' }",
    "$layout = try { ((Get-WinUserLanguageList | ForEach-Object { $_.LanguageTag }) -join ',') } catch { 'unknown' }",
    "[pscustomobject]@{ executablePath = $path; executableVersion = $version; keyboardLayout = $layout } | ConvertTo-Json -Compress",
  ].join("; ");
}

