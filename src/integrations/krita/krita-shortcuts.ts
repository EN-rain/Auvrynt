import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createKritaShortcutBindingFingerprint,
  KRITA_SHORTCUT_SCHEMA_VERSION,
} from "./krita-shortcut-fingerprint.js";

export const KRITA_SHORTCUT_COMMANDS = [
  "new_document",
  "open_document",
  "save",
  "save_as",
  "undo",
  "redo",
  "brush_tool",
  "eraser_toggle",
  "deselect",
  "swap_foreground_background",
  "reset_foreground_background",
  "reset_canvas_rotation",
  "new_layer",
  "delete_layer",
  "duplicate_layer",
  "transform_tool",
  "fill_tool",
  "select_rect",
  "select_ellipse",
  "export",
  "zoom_in",
  "zoom_out",
  "fit_canvas",
  "select_all",
  "invert_selection",
  "rename_layer",
  "move_layer_up",
  "move_layer_down",
  "toggle_layer_visibility",
  "toggle_layer_lock",
  "select_previous_layer",
  "select_next_layer",
] as const;

export type KritaShortcutCommand = (typeof KRITA_SHORTCUT_COMMANDS)[number];
export type KritaShortcutSource = "builtin" | "override";

export interface KritaShortcutBinding {
  command: KritaShortcutCommand;
  keys: string[];
  source: KritaShortcutSource;
  validated: boolean;
  validatedAt?: string;
  /** Fingerprint of the installation, keyboard layout, schema, and keys used during validation. */
  validationFingerprint?: string;
  updatedAt: string;
}

export interface KritaShortcutProfile {
  workspaceId: string;
  bindings: Partial<Record<KritaShortcutCommand, KritaShortcutBinding>>;
  missingCommands: KritaShortcutCommand[];
  unvalidatedCommands: KritaShortcutCommand[];
  updatedAt: string;
}

export interface KritaShortcutProbe {
  probeId: string;
  workspaceId: string;
  command: KritaShortcutCommand;
  keys: string[];
  windowTitle: string;
  windowHandle: string;
  performedAt: string;
  expiresAt: string;
  installationFingerprint?: string;
  requiresVisualConfirmation: true;
}

export interface KritaShortcutPreparation {
  workspaceId: string;
  schemaVersion: number;
  installationFingerprint: string;
  ready: KritaShortcutCommand[];
  needsProbe: KritaShortcutCommand[];
  missingBinding: KritaShortcutCommand[];
  invalidated: KritaShortcutCommand[];
  persisted: boolean;
  preparedAt: string;
}

export type KritaRecommendedShortcuts = Partial<Record<KritaShortcutCommand, string[]>>;

const BUILTIN_SHORTCUTS: Partial<Record<KritaShortcutCommand, readonly string[]>> = {
  new_document: ["CTRL", "N"],
  open_document: ["CTRL", "O"],
  save: ["CTRL", "S"],
  save_as: ["CTRL", "SHIFT", "S"],
  undo: ["CTRL", "Z"],
  redo: ["CTRL", "SHIFT", "Z"],
  brush_tool: ["B"],
  eraser_toggle: ["E"],
  deselect: ["CTRL", "SHIFT", "A"],
  swap_foreground_background: ["X"],
  reset_foreground_background: ["D"],
  reset_canvas_rotation: ["5"],
  select_all: ["CTRL", "A"],
  invert_selection: ["CTRL", "SHIFT", "I"],
};

/** Recommendations are deliberately separate from bindings; accepting one
 * still requires the user/app to set and visually probe it in Krita. */
const RECOMMENDED_SHORTCUTS: KritaRecommendedShortcuts = {
  new_document: ["CTRL", "N"],
  open_document: ["CTRL", "O"],
  save: ["CTRL", "S"],
  save_as: ["CTRL", "SHIFT", "S"],
  undo: ["CTRL", "Z"],
  redo: ["CTRL", "SHIFT", "Z"],
  brush_tool: ["B"],
  eraser_toggle: ["E"],
  deselect: ["CTRL", "SHIFT", "A"],
  swap_foreground_background: ["X"],
  reset_foreground_background: ["D"],
  reset_canvas_rotation: ["5"],
  new_layer: ["INSERT"],
  delete_layer: ["SHIFT", "DELETE"],
  duplicate_layer: ["CTRL", "J"],
  transform_tool: ["CTRL", "T"],
  fill_tool: ["F"],
  // Krita's rectangular selection tool is bound to Ctrl+R by default. `R`
  // rotates the canvas in the default workspace and must not be recommended
  // for selection automation.
  select_rect: ["CTRL", "R"],
  select_ellipse: ["J"],
  export: ["CTRL", "ALT", "SHIFT", "S"],
  zoom_in: ["+"],
  zoom_out: ["-"],
  fit_canvas: ["2"],
  select_all: ["CTRL", "A"],
  invert_selection: ["CTRL", "SHIFT", "I"],
  rename_layer: ["F2"],
  move_layer_up: ["CTRL", "PAGEUP"],
  move_layer_down: ["CTRL", "PAGEDOWN"],
  select_previous_layer: ["PAGEUP"],
  select_next_layer: ["PAGEDOWN"],
};

const profiles = new Map<string, KritaShortcutProfile>();
const shortcutProbes = new Map<string, KritaShortcutProbe>();
const SHORTCUT_PROBE_TTL_MS = 5 * 60 * 1000;
const PERSISTENCE_VERSION = 1;
let shortcutPersistencePath: string | undefined;
let persistedBindings: Partial<Record<KritaShortcutCommand, KritaShortcutBinding>> = {};
let persistenceLoaded = false;

/** Configure the private, restart-safe registry. Passing undefined disables
 * disk writes, which keeps pure/unit callers isolated and in-memory. */
export function configureKritaShortcutPersistence(stateDirOrFile?: string): void {
  const nextPath = stateDirOrFile ? resolveShortcutPersistencePath(stateDirOrFile) : undefined;
  if (nextPath === shortcutPersistencePath && persistenceLoaded) return;
  profiles.clear();
  shortcutProbes.clear();
  shortcutPersistencePath = nextPath;
  persistedBindings = {};
  persistenceLoaded = false;
  loadPersistence();
}

export function getKritaShortcutPersistencePath(): string | undefined {
  return shortcutPersistencePath;
}

export function clearKritaShortcutPersistence(): void {
  if (shortcutPersistencePath && existsSync(shortcutPersistencePath)) unlinkSync(shortcutPersistencePath);
  persistedBindings = {};
  persistenceLoaded = true;
  profiles.clear();
}

export function getKritaRecommendedShortcuts(): KritaRecommendedShortcuts {
  const result: KritaRecommendedShortcuts = {};
  for (const command of KRITA_SHORTCUT_COMMANDS) {
    const keys = RECOMMENDED_SHORTCUTS[command];
    if (keys) result[command] = [...keys];
  }
  return result;
}

/**
 * Compare persisted validation evidence with the current installation. This
 * only changes local readiness metadata; it never sends a shortcut.
 */
export function prepareKritaShortcuts(
  workspaceId: string,
  installationFingerprint: string,
): KritaShortcutPreparation {
  validateWorkspaceId(workspaceId);
  validateFingerprint(installationFingerprint);
  const profile = ensureProfile(workspaceId);
  const invalidated: KritaShortcutCommand[] = [];
  const needsProbe: KritaShortcutCommand[] = [];
  const ready: KritaShortcutCommand[] = [];
  for (const command of KRITA_SHORTCUT_COMMANDS) {
    const binding = profile.bindings[command];
    if (!binding) continue;
    if (!binding.validated) {
      needsProbe.push(command);
      continue;
    }
    const expected = createKritaShortcutBindingFingerprint(installationFingerprint, binding.keys);
    if (binding.validationFingerprint !== expected) {
      binding.validated = false;
      delete binding.validatedAt;
      delete binding.validationFingerprint;
      binding.updatedAt = new Date().toISOString();
      invalidated.push(command);
      needsProbe.push(command);
    } else {
      ready.push(command);
    }
  }
  if (invalidated.length > 0) {
    profile.updatedAt = new Date().toISOString();
    refreshDerivedLists(profile);
    persistProfile(profile);
  }
  return {
    workspaceId,
    schemaVersion: KRITA_SHORTCUT_SCHEMA_VERSION,
    installationFingerprint,
    ready,
    needsProbe,
    missingBinding: [...profile.missingCommands],
    invalidated,
    persisted: Boolean(shortcutPersistencePath),
    preparedAt: new Date().toISOString(),
  };
}

export function getKritaShortcutProfile(workspaceId: string): KritaShortcutProfile {
  validateWorkspaceId(workspaceId);
  return cloneProfile(ensureProfile(workspaceId));
}

export function setKritaShortcutBinding(
  workspaceId: string,
  command: KritaShortcutCommand,
  keys: string[],
): KritaShortcutProfile {
  validateWorkspaceId(workspaceId);
  validateCommand(command);
  const profile = ensureProfile(workspaceId);
  const normalizedKeys = normalizeKeys(keys);
  invalidateProbes(workspaceId, command);
  const timestamp = new Date().toISOString();
  profile.bindings[command] = {
    command,
    keys: normalizedKeys,
    source: "override",
    validated: false,
    updatedAt: timestamp,
  };
  profile.updatedAt = timestamp;
  refreshDerivedLists(profile);
  persistProfile(profile);
  return cloneProfile(profile);
}

export function resetKritaShortcutBinding(
  workspaceId: string,
  command: KritaShortcutCommand,
): KritaShortcutProfile {
  validateWorkspaceId(workspaceId);
  validateCommand(command);
  const profile = ensureProfile(workspaceId);
  const timestamp = new Date().toISOString();
  invalidateProbes(workspaceId, command);
  const builtin = BUILTIN_SHORTCUTS[command];
  if (builtin) {
    profile.bindings[command] = createBinding(command, builtin, "builtin", timestamp);
  } else {
    delete profile.bindings[command];
  }
  profile.updatedAt = timestamp;
  refreshDerivedLists(profile);
  persistProfile(profile);
  return cloneProfile(profile);
}

export function markKritaShortcutsValidated(
  workspaceId: string,
  commands: KritaShortcutCommand[],
  installationFingerprint?: string,
): KritaShortcutProfile {
  validateWorkspaceId(workspaceId);
  if (commands.length === 0) throw new Error("At least one Krita shortcut command is required for validation.");
  if (installationFingerprint !== undefined) validateFingerprint(installationFingerprint);
  const profile = ensureProfile(workspaceId);
  const timestamp = new Date().toISOString();
  for (const command of new Set(commands)) {
    validateCommand(command);
    invalidateProbes(workspaceId, command);
    const binding = profile.bindings[command];
    if (!binding) throw new Error(`Krita shortcut ${command} has no configured binding to validate.`);
    binding.validated = true;
    binding.validatedAt = timestamp;
    if (installationFingerprint) {
      binding.validationFingerprint = createKritaShortcutBindingFingerprint(installationFingerprint, binding.keys);
    } else {
      // Direct/manual confirmation is retained for compatibility but does not
      // claim restart-safe installation evidence. prepareKritaShortcuts will
      // conservatively request a fresh probe when persistence is enabled.
      delete binding.validationFingerprint;
    }
    binding.updatedAt = timestamp;
  }
  profile.updatedAt = timestamp;
  refreshDerivedLists(profile);
  persistProfile(profile);
  return cloneProfile(profile);
}

export function markKritaShortcutsUnvalidated(
  workspaceId: string,
  commands: KritaShortcutCommand[] = [...KRITA_SHORTCUT_COMMANDS],
): KritaShortcutProfile {
  validateWorkspaceId(workspaceId);
  const profile = ensureProfile(workspaceId);
  const timestamp = new Date().toISOString();
  for (const command of new Set(commands)) {
    validateCommand(command);
    invalidateProbes(workspaceId, command);
    const binding = profile.bindings[command];
    if (!binding) continue;
    binding.validated = false;
    delete binding.validatedAt;
    binding.updatedAt = timestamp;
  }
  profile.updatedAt = timestamp;
  refreshDerivedLists(profile);
  persistProfile(profile);
  return cloneProfile(profile);
}

export function resolveKritaShortcut(
  workspaceId: string,
  command: KritaShortcutCommand,
  options: { requireValidated?: boolean } = {},
): KritaShortcutBinding {
  validateWorkspaceId(workspaceId);
  validateCommand(command);
  const profile = ensureProfile(workspaceId);
  const binding = profile.bindings[command];
  if (!binding) {
    throw new Error(`Krita shortcut ${command} is not configured. Add a shortcut binding before using it.`);
  }
  if ((options.requireValidated ?? true) && !binding.validated) {
    throw new Error(`Krita shortcut ${command} is configured but not validated for this workspace.`);
  }
  return { ...binding, keys: [...binding.keys] };
}

/**
 * Record that an explicitly requested, bounded raw-key probe was sent to the
 * current Krita window. A probe never validates a shortcut by itself; callers
 * must visually review the result and pass its probeId to confirmation.
 */
export function recordKritaShortcutProbe(
  workspaceId: string,
  command: KritaShortcutCommand,
  keys: string[],
  windowTitle: string,
  windowHandle: string,
  installationFingerprint?: string,
): KritaShortcutProbe {
  validateWorkspaceId(workspaceId);
  validateCommand(command);
  const profile = ensureProfile(workspaceId);
  const binding = profile.bindings[command];
  if (!binding) throw new Error(`Krita shortcut ${command} has no configured binding to probe.`);
  const normalizedKeys = normalizeKeys(keys);
  if (!sameKeys(binding.keys, normalizedKeys)) {
    throw new Error(`Krita shortcut ${command} changed before its probe could be recorded.`);
  }
  const title = windowTitle.trim();
  const handle = windowHandle.trim();
  if (!title || title.length > 256 || /[\r\n\0]/.test(title)) {
    throw new Error("A valid Krita window title is required for shortcut probing.");
  }
  if (!/^[0-9]+$/.test(handle) || BigInt(handle) <= 0n) {
    throw new Error("A valid Krita window handle is required for shortcut probing.");
  }
  if (installationFingerprint !== undefined) validateFingerprint(installationFingerprint);
  const performedAt = new Date();
  const probe: KritaShortcutProbe = {
    probeId: `krita-probe-${randomUUID()}`,
    workspaceId,
    command,
    keys: normalizedKeys,
    windowTitle: title,
    windowHandle: handle,
    performedAt: performedAt.toISOString(),
    expiresAt: new Date(performedAt.getTime() + SHORTCUT_PROBE_TTL_MS).toISOString(),
    installationFingerprint,
    requiresVisualConfirmation: true,
  };
  shortcutProbes.set(probe.probeId, probe);
  return cloneProbe(probe);
}

/**
 * Consume probe records only after the caller has reviewed the live result.
 * Binding changes invalidate old probes, preventing confirmation of a key that
 * was not the key actually sent to Krita.
 */
export function confirmKritaShortcutProbes(workspaceId: string, probeIds: string[]): KritaShortcutProfile {
  validateWorkspaceId(workspaceId);
  if (!Array.isArray(probeIds) || probeIds.length === 0) {
    throw new Error("At least one Krita shortcut probeId is required for probe confirmation.");
  }
  const now = Date.now();
  const uniqueIds = [...new Set(probeIds)];
  const profile = ensureProfile(workspaceId);
  const probes: KritaShortcutProbe[] = [];
  for (const probeId of uniqueIds) {
    if (typeof probeId !== "string" || probeId.length > 128 || /[\r\n\0]/.test(probeId)) {
      throw new Error("Krita shortcut probeId is invalid.");
    }
    const probe = shortcutProbes.get(probeId);
    if (!probe || probe.workspaceId !== workspaceId || Date.parse(probe.expiresAt) <= now) {
      if (probe && Date.parse(probe.expiresAt) <= now) shortcutProbes.delete(probeId);
      throw new Error(`Krita shortcut probe ${probeId} is missing, expired, or belongs to another workspace.`);
    }
    const binding = profile.bindings[probe.command];
    if (!binding || !sameKeys(binding.keys, probe.keys)) {
      throw new Error(`Krita shortcut probe ${probeId} no longer matches the configured ${probe.command} binding.`);
    }
    probes.push(probe);
  }
  const fingerprints = new Set(probes.map((probe) => probe.installationFingerprint).filter(Boolean));
  if (fingerprints.size > 1) throw new Error("Krita shortcut probes were captured under different installation fingerprints.");
  const confirmed = markKritaShortcutsValidated(
    workspaceId,
    probes.map((probe) => probe.command),
    fingerprints.values().next().value as string | undefined,
  );
  for (const probe of probes) shortcutProbes.delete(probe.probeId);
  return confirmed;
}

export function clearKritaShortcutProfile(workspaceId: string): { cleared: boolean } {
  validateWorkspaceId(workspaceId);
  for (const [probeId, probe] of shortcutProbes) {
    if (probe.workspaceId === workspaceId) shortcutProbes.delete(probeId);
  }
  return { cleared: profiles.delete(workspaceId) };
}

function invalidateProbes(workspaceId: string, command: KritaShortcutCommand): void {
  for (const [probeId, probe] of shortcutProbes) {
    if (probe.workspaceId === workspaceId && probe.command === command) shortcutProbes.delete(probeId);
  }
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function ensureProfile(workspaceId: string): KritaShortcutProfile {
  const existing = profiles.get(workspaceId);
  if (existing) return existing;
  loadPersistence();
  const timestamp = new Date().toISOString();
  const bindings: Partial<Record<KritaShortcutCommand, KritaShortcutBinding>> = {};
  for (const command of KRITA_SHORTCUT_COMMANDS) {
    const persisted = persistedBindings[command];
    if (persisted) {
      bindings[command] = { ...persisted, keys: [...persisted.keys] };
      continue;
    }
    const keys = BUILTIN_SHORTCUTS[command];
    if (keys) bindings[command] = createBinding(command, keys, "builtin", timestamp);
  }
  const profile: KritaShortcutProfile = {
    workspaceId,
    bindings,
    missingCommands: [],
    unvalidatedCommands: [],
    updatedAt: timestamp,
  };
  refreshDerivedLists(profile);
  profiles.set(workspaceId, profile);
  return profile;
}

function createBinding(
  command: KritaShortcutCommand,
  keys: readonly string[],
  source: KritaShortcutSource,
  timestamp: string,
): KritaShortcutBinding {
  return {
    command,
    keys: normalizeKeys([...keys]),
    source,
    validated: false,
    updatedAt: timestamp,
  };
}

function persistProfile(profile: KritaShortcutProfile): void {
  if (!shortcutPersistencePath) return;
  loadPersistence();
  for (const command of KRITA_SHORTCUT_COMMANDS) {
    const binding = profile.bindings[command];
    if (binding) persistedBindings[command] = { ...binding, keys: [...binding.keys] };
    else delete persistedBindings[command];
  }
  writePersistence();
}

interface PersistedShortcutFile {
  version: number;
  updatedAt: string;
  bindings: Partial<Record<KritaShortcutCommand, KritaShortcutBinding>>;
}

function resolveShortcutPersistencePath(stateDirOrFile: string): string {
  const resolved = resolve(stateDirOrFile);
  return resolved.toLowerCase().endsWith(".json") ? resolved : join(resolved, "krita-shortcuts.json");
}

function loadPersistence(): void {
  if (persistenceLoaded) return;
  persistenceLoaded = true;
  persistedBindings = {};
  if (!shortcutPersistencePath || !existsSync(shortcutPersistencePath)) return;
  try {
    const raw = JSON.parse(readFileSync(shortcutPersistencePath, "utf8")) as unknown;
    persistedBindings = parsePersistedBindings(raw);
  } catch {
    // Corrupt or legacy state must never make Krita unavailable. Preserve the
    // evidence for diagnosis and start with built-ins marked unvalidated.
    try {
      const backup = `${shortcutPersistencePath}.invalid-${Date.now()}.bak`;
      renameSync(shortcutPersistencePath, backup);
    } catch {
      // Best effort backup; fail closed through an empty registry either way.
    }
  }
}

function parsePersistedBindings(value: unknown): Partial<Record<KritaShortcutCommand, KritaShortcutBinding>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid persisted shortcut registry");
  const record = value as Record<string, unknown>;
  if (record.version !== PERSISTENCE_VERSION || !record.bindings || typeof record.bindings !== "object" || Array.isArray(record.bindings)) {
    throw new Error("unsupported persisted shortcut registry version");
  }
  const bindings: Partial<Record<KritaShortcutCommand, KritaShortcutBinding>> = {};
  for (const [command, candidate] of Object.entries(record.bindings as Record<string, unknown>)) {
    if (!(KRITA_SHORTCUT_COMMANDS as readonly string[]).includes(command)) continue;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    try {
      const keys = normalizeKeys(item.keys as string[]);
      const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString();
      const source = item.source === "override" ? "override" : "builtin";
      const binding: KritaShortcutBinding = {
        command: command as KritaShortcutCommand,
        keys,
        source,
        validated: item.validated === true,
        updatedAt,
      };
      if (typeof item.validatedAt === "string") binding.validatedAt = item.validatedAt;
      if (typeof item.validationFingerprint === "string" && /^sha256:[0-9a-f]{64}$/i.test(item.validationFingerprint)) {
        binding.validationFingerprint = item.validationFingerprint.toLowerCase();
      } else if (binding.validated) {
        // An old record without evidence is intentionally downgraded during
        // load; a restart must not silently trust unverifiable keys.
        binding.validated = false;
      }
      bindings[command as KritaShortcutCommand] = binding;
    } catch {
      // Ignore one malformed command while retaining the rest of the registry.
    }
  }
  return bindings;
}

function writePersistence(): void {
  if (!shortcutPersistencePath) return;
  const directory = dirname(shortcutPersistencePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* Windows may not expose POSIX bits. */ }
  const value: PersistedShortcutFile = {
    version: PERSISTENCE_VERSION,
    updatedAt: new Date().toISOString(),
    bindings: persistedBindings,
  };
  const tempPath = join(directory, `.${basename(shortcutPersistencePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { chmodSync(tempPath, 0o600); } catch { /* Best effort on Windows. */ }
    renameSync(tempPath, shortcutPersistencePath);
    try { chmodSync(shortcutPersistencePath, 0o600); } catch { /* Best effort on Windows. */ }
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch { /* Do not mask the original error. */ }
    }
  }
}

function refreshDerivedLists(profile: KritaShortcutProfile): void {
  profile.missingCommands = KRITA_SHORTCUT_COMMANDS.filter((command) => !profile.bindings[command]);
  profile.unvalidatedCommands = KRITA_SHORTCUT_COMMANDS.filter((command) => {
    const binding = profile.bindings[command];
    return Boolean(binding && !binding.validated);
  });
}

function normalizeKeys(keys: string[]): string[] {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 8) {
    throw new Error("Krita shortcut bindings require between 1 and 8 keys.");
  }
  const normalized = keys.map((key) => {
    if (typeof key !== "string") throw new Error("Krita shortcut keys must be strings.");
    const value = key.trim().toUpperCase();
    if (!value || value.length > 32 || /[\r\n\0]/.test(value)) throw new Error("Krita shortcut key names are invalid.");
    return value;
  });
  if (new Set(normalized).size !== normalized.length) throw new Error("Krita shortcut bindings cannot repeat the same key.");
  return normalized;
}

function validateCommand(value: string): asserts value is KritaShortcutCommand {
  if (!(KRITA_SHORTCUT_COMMANDS as readonly string[]).includes(value)) {
    throw new Error(`Unknown Krita shortcut command "${value}".`);
  }
}

function validateFingerprint(value: string): void {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new Error("A valid Krita installation fingerprint is required.");
  }
}

function validateWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 256 || /[\r\n\0]/.test(workspaceId)) {
    throw new Error("A valid workspaceId is required for Krita shortcut configuration.");
  }
}

function cloneProfile(profile: KritaShortcutProfile): KritaShortcutProfile {
  const bindings: Partial<Record<KritaShortcutCommand, KritaShortcutBinding>> = {};
  for (const command of KRITA_SHORTCUT_COMMANDS) {
    const binding = profile.bindings[command];
    if (binding) bindings[command] = { ...binding, keys: [...binding.keys] };
  }
  return {
    ...profile,
    bindings,
    missingCommands: [...profile.missingCommands],
    unvalidatedCommands: [...profile.unvalidatedCommands],
  };
}

function cloneProbe(probe: KritaShortcutProbe): KritaShortcutProbe {
  return { ...probe, keys: [...probe.keys] };
}
