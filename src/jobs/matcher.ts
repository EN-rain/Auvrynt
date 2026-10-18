import type { JobCandidate, JobMatch, JobProfile, MatchLevel } from "./types.js";
import { asJobId } from "./types.js";

const STOP_WORDS = new Set(["and", "the", "for", "with", "developer", "engineer", "role", "job", "position", "of", "a", "an"]);

export function matchCandidate(jobId: string, candidate: JobCandidate, profile: JobProfile, evaluatedAt = new Date().toISOString()): JobMatch {
  const text = `${candidate.title ?? ""} ${candidate.description}`.toLowerCase();
  const scores = { role: 0, requiredSkills: 0, experience: 0, location: 0, preferredSkills: 0, industry: 0, other: 0 };
  let evaluatedWeights = 0;
  const reasons: string[] = [];

  if (profile.targetRoles.length > 0 && candidate.title?.trim()) {
    evaluatedWeights += 25;
    scores.role = Math.max(...profile.targetRoles.map((role) => similarity(role, candidate.title ?? ""))) * 25;
    if (scores.role >= 20) reasons.push("target role is a strong match");
    else if (scores.role > 0) reasons.push("target role partially matches");
  }

  const primary = skillMatches(profile.primarySkills, text);
  if (profile.primarySkills.length > 0 && text.trim()) {
    evaluatedWeights += 30;
    scores.requiredSkills = (primary.matched.length / profile.primarySkills.length) * 30;
    if (primary.matched.length > 0) reasons.push(`${primary.matched.length} primary skill${primary.matched.length === 1 ? "" : "s"} matched`);
  }

  if (profile.experienceLevels.length > 0) {
    const marker = profile.experienceLevels.find((level) => text.includes(level.toLowerCase()));
    const genericMarker = /entry|junior|mid|senior|lead|principal/.test(text);
    if (marker || genericMarker) {
      evaluatedWeights += 15;
      scores.experience = marker ? 15 : 6;
      reasons.push(marker ? "experience level matches" : "experience level needs review");
    }
  }

  if ((profile.country || profile.remote || profile.hybridAcceptable || profile.onsiteOptional)
    && ((candidate.remoteStatus && candidate.remoteStatus !== "unknown") || candidate.location?.trim())) {
    evaluatedWeights += 10;
    const remote = candidate.remoteStatus ?? "unknown";
    const countryMatch = profile.country && candidate.location?.toLowerCase().includes(profile.country.toLowerCase());
    scores.location = countryMatch || (remote === "remote" && profile.remote) || (remote === "hybrid" && profile.hybridAcceptable) || (remote === "onsite" && profile.onsiteOptional) ? 10 : remote === "unknown" ? 5 : 0;
    reasons.push(scores.location >= 8 ? "work arrangement is compatible" : "work arrangement needs review");
  }

  const preferred = skillMatches(profile.secondarySkills, text);
  if (profile.secondarySkills.length > 0 && text.trim()) {
    evaluatedWeights += 10;
    scores.preferredSkills = (preferred.matched.length / profile.secondarySkills.length) * 10;
  }

  const totalScore = evaluatedWeights === 0 ? 0 : Math.round((Object.values(scores).reduce((sum, value) => sum + value, 0) / evaluatedWeights) * 100);
  const rounded = Math.max(0, Math.min(100, totalScore));
  return {
    jobId: asJobId(jobId), profileId: profile.id, matchedSkills: [...primary.matched, ...preferred.matched], partialSkills: [...primary.partial, ...preferred.partial],
    missingSkills: [...primary.missing, ...preferred.missing], scores: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, Math.round(value)])) as JobMatch["scores"],
    evaluatedWeights, totalScore: rounded, level: matchLevel(rounded), explanation: reasons.length > 0 ? reasons.join("; ") : "Add target roles or skills to improve match scoring.", evaluatedAt,
  };
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function similarity(left: string, right: string): number {
  const a = tokenize(left); const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;
  let matches = 0; for (const token of a) if (b.has(token)) matches++;
  return matches / Math.max(a.size, b.size);
}

function skillMatches(skills: string[], text: string): { matched: string[]; partial: string[]; missing: string[] } {
  const matched: string[] = []; const partial: string[] = []; const missing: string[] = [];
  for (const skill of skills) {
    const normalized = skill.toLowerCase().trim();
    if (!normalized) continue;
    if (text.includes(normalized)) matched.push(skill);
    else if (similarity(skill, text) > 0) partial.push(skill);
    else missing.push(skill);
  }
  return { matched, partial, missing };
}

function matchLevel(score: number): MatchLevel {
  if (score >= 90) return "EXCELLENT";
  if (score >= 80) return "STRONG";
  if (score >= 70) return "POSSIBLE";
  if (score >= 60) return "WEAK";
  return "LOW";
}
