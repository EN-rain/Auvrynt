import type { JobCandidate, JobProfile, RiskLevel, RiskResult } from "./types.js";

const CRITICAL_SIGNALS: Array<[RegExp, string]> = [
  [/password|login credentials|account credentials/i, "asks for a password or login credentials"],
  [/\botp\b|one[- ]time code|verification code/i, "asks for an OTP or verification code"],
  [/account rental|rent your account/i, "mentions account rental"],
  [/\.exe\b|download (this|an) (file|app)/i, "requests a suspicious executable or download"],
];
const HIGH_SIGNALS: Array<[RegExp, string]> = [
  [/registration fee|processing fee|pay (before|to) (start|apply|work)/i, "requires payment before employment"],
  [/crypto|bitcoin|investment|deposit/i, "requests an investment, crypto payment, or deposit"],
];
const REVIEW_SIGNALS: Array<[RegExp, string]> = [
  [/guaranteed income|guaranteed salary|no experience necessary/i, "promises unusually guaranteed income"],
  [/bit\.ly|tinyurl|t\.co\//i, "uses a shortened URL"],
  [/urgent hiring|act now|limited spots/i, "uses high-pressure language"],
];

export function detectRisk(candidate: JobCandidate, profile: JobProfile): RiskResult {
  const text = `${candidate.title ?? ""} ${candidate.company ?? ""} ${candidate.description} ${candidate.applicationUrl ?? candidate.sourceUrl ?? ""}`;
  let score = 0;
  const signals: string[] = [];
  for (const [pattern, message] of CRITICAL_SIGNALS) if (pattern.test(text)) { score += 80; signals.push(message); }
  for (const [pattern, message] of HIGH_SIGNALS) if (pattern.test(text)) { score += 60; signals.push(message); }
  for (const [pattern, message] of REVIEW_SIGNALS) if (pattern.test(text)) { score += 15; signals.push(message); }
  for (const keyword of profile.negativeKeywords) {
    if (keyword.trim() && text.toLowerCase().includes(keyword.toLowerCase())) { score += 40; signals.push(`matches negative keyword “${keyword}”`); }
  }
  if (!candidate.company && !candidate.applicationUrl) { score += 10; signals.push("has no identifiable company or application URL"); }
  score = Math.min(100, score);
  const level: RiskLevel = score >= 80 ? "AUTO_SKIP" : score >= 60 ? "HIGH_RISK" : score >= 30 ? "REVIEW" : "NORMAL";
  return { score, level, signals, explanation: signals.length > 0 ? signals.join("; ") : "No known scam signals detected." };
}
