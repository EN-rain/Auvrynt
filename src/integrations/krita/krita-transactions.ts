export const KRITA_TRANSACTION_STEPS = [
  "check_window",
  "check_dialogs",
  "ensure_calibration_if_needed",
  "foreground_restore",
  "execute",
  "capture_result",
  "verify",
] as const;

export type KritaTransactionStep = (typeof KRITA_TRANSACTION_STEPS)[number];
export type KritaTransactionOperation = "capture" | "save" | "undo" | "redo" | "create_layer" | "delete_layer" | "duplicate_layer";

export interface KritaTransactionRequest {
  goal: string;
  steps: KritaTransactionStep[];
  operation?: KritaTransactionOperation;
}

export interface KritaTransactionResult {
  goal: string;
  operation?: KritaTransactionOperation;
  completedSteps: KritaTransactionStep[];
  failedStep?: KritaTransactionStep;
  sideEffects: string[];
  stateChanges: string[];
  verification: Record<string, unknown>;
  recoveryRequired: boolean;
}

export function validateKritaTransactionRequest(input: KritaTransactionRequest): KritaTransactionRequest {
  if (!input || typeof input !== "object") throw new Error("A Krita transaction request is required.");
  if (typeof input.goal !== "string" || !input.goal.trim() || input.goal.length > 256 || /[\r\n\0]/.test(input.goal)) throw new Error("Krita transaction goal is invalid.");
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > KRITA_TRANSACTION_STEPS.length) throw new Error("Krita transactions require between 1 and 7 allowlisted steps.");
  for (const step of input.steps) if (!(KRITA_TRANSACTION_STEPS as readonly string[]).includes(step)) throw new Error(`Unknown Krita transaction step "${step}".`);
  if (input.steps.includes("execute") && !input.operation) throw new Error("Krita transaction execute step requires an allowlisted operation.");
  return { goal: input.goal.trim(), steps: [...input.steps], operation: input.operation };
}

