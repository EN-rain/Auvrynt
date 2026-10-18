export type KritaStateConfidence = "known" | "expected" | "visually_verified" | "unknown";

export const KRITA_TRACKED_STATE_FIELDS = [
  "documentName",
  "documentPath",
  "activeTool",
  "brushPreset",
  "brushSize",
  "foregroundColor",
  "activeLayerName",
  "zoom",
  "rotation",
  "mirrored",
  "eraserMode",
  "modified",
] as const;

export type KritaTrackedStateField = (typeof KRITA_TRACKED_STATE_FIELDS)[number];
export type KritaStateValue = string | number | boolean;

export interface KritaStateField {
  value?: KritaStateValue;
  confidence: KritaStateConfidence;
  updatedAt: string;
  source?: string;
}

export interface KritaExpectedState {
  workspaceId: string;
  fields: Record<KritaTrackedStateField, KritaStateField>;
  uncertainFields: KritaTrackedStateField[];
  updatedAt: string;
}

export interface KritaStatePatchOptions {
  confidence?: Exclude<KritaStateConfidence, "unknown">;
  source?: string;
}

const expectedStates = new Map<string, KritaExpectedState>();

export function getKritaExpectedState(workspaceId: string): KritaExpectedState {
  validateWorkspaceId(workspaceId);
  return cloneState(ensureState(workspaceId));
}

export function updateKritaExpectedState(
  workspaceId: string,
  patch: Partial<Record<KritaTrackedStateField, KritaStateValue>>,
  options: KritaStatePatchOptions = {},
): KritaExpectedState {
  validateWorkspaceId(workspaceId);
  const entries = Object.entries(patch) as Array<[KritaTrackedStateField, KritaStateValue]>;
  if (entries.length === 0) throw new Error("Krita expected-state update requires at least one field.");
  const state = ensureState(workspaceId);
  const confidence = options.confidence ?? "expected";
  const timestamp = new Date().toISOString();
  for (const [field, value] of entries) {
    validateTrackedField(field);
    state.fields[field] = {
      value: normalizeStateValue(field, value),
      confidence,
      updatedAt: timestamp,
      source: normalizeSource(options.source),
    };
  }
  state.updatedAt = timestamp;
  state.uncertainFields = collectUncertainFields(state.fields);
  return cloneState(state);
}

export function markKritaStateUnknown(
  workspaceId: string,
  fields: KritaTrackedStateField[] = [...KRITA_TRACKED_STATE_FIELDS],
  source?: string,
): KritaExpectedState {
  validateWorkspaceId(workspaceId);
  if (fields.length === 0) throw new Error("At least one Krita state field is required.");
  const state = ensureState(workspaceId);
  const timestamp = new Date().toISOString();
  for (const field of uniqueFields(fields)) {
    validateTrackedField(field);
    state.fields[field] = {
      confidence: "unknown",
      updatedAt: timestamp,
      source: normalizeSource(source),
    };
  }
  state.updatedAt = timestamp;
  state.uncertainFields = collectUncertainFields(state.fields);
  return cloneState(state);
}

export function markKritaStateVisuallyVerified(
  workspaceId: string,
  fields: KritaTrackedStateField[],
  source = "calibrated-ui-review",
): KritaExpectedState {
  validateWorkspaceId(workspaceId);
  if (fields.length === 0) throw new Error("At least one Krita state field is required for visual verification.");
  const state = ensureState(workspaceId);
  const timestamp = new Date().toISOString();
  for (const field of uniqueFields(fields)) {
    validateTrackedField(field);
    const current = state.fields[field];
    if (current.value === undefined) {
      throw new Error(`Cannot visually verify ${field} because no expected value is recorded.`);
    }
    state.fields[field] = {
      ...current,
      confidence: "visually_verified",
      updatedAt: timestamp,
      source: normalizeSource(source),
    };
  }
  state.updatedAt = timestamp;
  state.uncertainFields = collectUncertainFields(state.fields);
  return cloneState(state);
}

export function resetKritaExpectedState(workspaceId: string): KritaExpectedState {
  validateWorkspaceId(workspaceId);
  const state = createEmptyState(workspaceId);
  expectedStates.set(workspaceId, state);
  return cloneState(state);
}

export function clearKritaExpectedState(workspaceId: string): { cleared: boolean } {
  validateWorkspaceId(workspaceId);
  return { cleared: expectedStates.delete(workspaceId) };
}

function ensureState(workspaceId: string): KritaExpectedState {
  const existing = expectedStates.get(workspaceId);
  if (existing) return existing;
  const created = createEmptyState(workspaceId);
  expectedStates.set(workspaceId, created);
  return created;
}

function createEmptyState(workspaceId: string): KritaExpectedState {
  const timestamp = new Date().toISOString();
  const fields = {} as Record<KritaTrackedStateField, KritaStateField>;
  for (const field of KRITA_TRACKED_STATE_FIELDS) {
    fields[field] = { confidence: "unknown", updatedAt: timestamp };
  }
  return {
    workspaceId,
    fields,
    uncertainFields: [...KRITA_TRACKED_STATE_FIELDS],
    updatedAt: timestamp,
  };
}

function normalizeStateValue(field: KritaTrackedStateField, value: KritaStateValue): KritaStateValue {
  switch (field) {
    case "documentName":
    case "documentPath":
    case "activeTool":
    case "brushPreset":
    case "activeLayerName": {
      if (typeof value !== "string" || !value.trim() || value.length > 2048 || /[\r\n\0]/.test(value)) {
        throw new Error(`Krita state field ${field} requires a non-empty safe string.`);
      }
      return value.trim();
    }
    case "foregroundColor": {
      if (typeof value !== "string") throw new Error("Krita foregroundColor must be a hexadecimal color string.");
      const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim());
      if (!match) throw new Error("Krita foregroundColor must use #RRGGBB or #RRGGBBAA.");
      return `#${match[1]!.toUpperCase()}`;
    }
    case "brushSize": {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10_000) {
        throw new Error("Krita brushSize must be greater than 0 and at most 10000.");
      }
      return value;
    }
    case "zoom": {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100_000) {
        throw new Error("Krita zoom must be a positive finite number.");
      }
      return value;
    }
    case "rotation": {
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
        throw new Error("Krita rotation must be a finite number.");
      }
      return value;
    }
    case "mirrored":
    case "eraserMode":
    case "modified": {
      if (typeof value !== "boolean") throw new Error(`Krita state field ${field} must be boolean.`);
      return value;
    }
  }
}

function collectUncertainFields(fields: Record<KritaTrackedStateField, KritaStateField>): KritaTrackedStateField[] {
  return KRITA_TRACKED_STATE_FIELDS.filter((field) => {
    const confidence = fields[field].confidence;
    return confidence === "unknown" || confidence === "expected";
  });
}

function uniqueFields(fields: KritaTrackedStateField[]): KritaTrackedStateField[] {
  return Array.from(new Set(fields));
}

function validateTrackedField(value: string): asserts value is KritaTrackedStateField {
  if (!(KRITA_TRACKED_STATE_FIELDS as readonly string[]).includes(value)) {
    throw new Error(`Unknown Krita state field "${value}".`);
  }
}

function normalizeSource(value: string | undefined): string | undefined {
  const source = value?.trim();
  if (!source) return undefined;
  if (source.length > 256 || /[\r\n\0]/.test(source)) throw new Error("Krita state source label is invalid.");
  return source;
}

function validateWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 256 || /[\r\n\0]/.test(workspaceId)) {
    throw new Error("A valid workspaceId is required for Krita expected state.");
  }
}

function cloneState(state: KritaExpectedState): KritaExpectedState {
  const fields = {} as Record<KritaTrackedStateField, KritaStateField>;
  for (const field of KRITA_TRACKED_STATE_FIELDS) fields[field] = { ...state.fields[field] };
  return {
    ...state,
    fields,
    uncertainFields: [...state.uncertainFields],
  };
}
