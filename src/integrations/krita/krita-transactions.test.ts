import assert from "node:assert/strict";
import { validateKritaTransactionRequest } from "./krita-transactions.js";

const request = validateKritaTransactionRequest({
  goal: "Capture a checkpoint",
  steps: ["check_window", "ensure_calibration_if_needed", "execute", "capture_result", "verify"],
  operation: "capture",
});
assert.equal(request.operation, "capture");
assert.throws(() => validateKritaTransactionRequest({ goal: "bad", steps: ["execute"] }), /allowlisted operation/i);
assert.throws(() => validateKritaTransactionRequest({ goal: "bad", steps: ["unknown" as never] }), /Unknown Krita transaction step/i);

console.log("Krita transaction tests passed");
