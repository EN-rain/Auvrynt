import assert from "node:assert/strict";
import { questionSchema } from "./arbiter-tools-registration.js";

const base = { instructions: "Decide from this text." };

const valid = [
  { ...base, type: "choice", criteria: { yes: "true", no: "false" } },
  { ...base, type: "choice", criteria: ["yes", "no"] },
  { ...base, type: "score", criteria: ["low", "medium", "high"] },
  { ...base, type: "noul" },
  { ...base, type: "noul", criteria: { true: "yes", false: "no" } },
];
for (const value of valid) {
  assert.equal(questionSchema.safeParse(value).success, true, `Expected valid ${value.type} criteria`);
}

const invalid = [
  { ...base, type: "choice" },
  { ...base, type: "choice", criteria: { only: "one option" } },
  { ...base, type: "choice", criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), "option"])) },
  { ...base, type: "choice", instructions: "   ", criteria: { yes: "true", no: "false" } },
  { ...base, type: "score" },
  { ...base, type: "score", criteria: { low: "0", high: "1" } },
  { ...base, type: "score", criteria: Array.from({ length: 11 }, (_, i) => String(i)) },
  { ...base, type: "noul", criteria: ["true", "false"] },
  { ...base, type: "noul", criteria: { maybe: "unknown" } },
];
for (const value of invalid) {
  assert.equal(questionSchema.safeParse(value).success, false, `Expected invalid ${value.type} criteria`);
}

console.log("Arbiter question schema tests passed!");
