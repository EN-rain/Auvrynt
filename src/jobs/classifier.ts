import type { JobCandidate, JobClassification } from "./types.js";

export function classifyCandidate(candidate: JobCandidate): JobClassification {
  const text = `${candidate.title ?? ""} ${candidate.description} ${candidate.employmentType ?? ""}`.toLowerCase();
  if (!candidate.title && !candidate.description) return "UNKNOWN";
  if (/\bscam\b|registration fee|pay before|crypto deposit|account rental/.test(text)) return "SCAM_SUSPECTED";
  if (/\bintern(ship)?\b/.test(text)) return "INTERNSHIP";
  if (/\bfreelance|gig\b/.test(text)) return "FREELANCE_GIG";
  if (/\bcontract(or)?\b|fixed[- ]term/.test(text)) return "CONTRACT";
  if (/recruiter|talent acquisition|staffing/.test(text) && !/we're hiring|we are hiring|job opening/.test(text)) return "RECRUITER_POST";
  if (/hiring|job opening|open position|vacancy|looking for|we're hiring|we are hiring|now hiring|position/.test(text)) return "JOB";
  return "UNKNOWN";
}
