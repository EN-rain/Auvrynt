import { randomUUID } from "node:crypto";
import { classifyCandidate } from "./classifier.js";
import { matchCandidate } from "./matcher.js";
import { candidateFromManualInput, normalizeText, normalizeUrl } from "./normalize.js";
import { detectRisk } from "./risk-detector.js";
import { JobsStore } from "./store.js";
import type { JobInput, JobRecord, JobUpdateInput } from "./types.js";
import { asJobId } from "./types.js";

export interface ManualIngestionResult {
  job: JobRecord;
  duplicate: boolean;
}

export function ingestManualJob(store: JobsStore, input: JobInput): ManualIngestionResult {
  const candidate = candidateFromManualInput(input);
  const profile = store.getProfile();
  const existing = store.findDuplicate({ sourceUrl: candidate.sourceUrl, title: candidate.title ?? "", company: candidate.company, location: candidate.location, description: candidate.description });
  if (existing) {
    const job = store.markDuplicate(existing.id, {
      provider: "manual", sourceType: "manual", sourceUrl: candidate.sourceUrl, metadata: { source: "manual" },
    }) ?? existing;
    return { job, duplicate: true };
  }
  const now = new Date().toISOString();
  const risk = detectRisk(candidate, profile);
  const match = matchCandidate(randomUUID(), candidate, profile, now);
  const id = match.jobId;
  const status = risk.level === "HIGH_RISK" || risk.level === "AUTO_SKIP" ? "REVIEW" : input.initialStatus ?? "NEW";
  const job = store.createJob({
    id, title: candidate.title ?? "Untitled opportunity", company: candidate.company, description: candidate.description,
    location: candidate.location, remoteStatus: candidate.remoteStatus ?? "unknown", employmentType: candidate.employmentType, salary: candidate.salary,
    deadline: candidate.deadline, firstSeenAt: now, lastSeenAt: now, classification: classifyCandidate(candidate), matchScore: match.totalScore,
    matchLevel: match.level, riskScore: risk.score, riskLevel: risk.level, riskSignals: risk.signals, status, applicationUrl: candidate.sourceUrl,
    notes: normalizeText(input.notes), createdAt: now, updatedAt: now,
  }, {
    provider: "manual", sourceType: "manual", sourceUrl: candidate.sourceUrl, metadata: { source: "manual" },
  }, match, { jobId: id, status, notes: normalizeText(input.notes), updatedAt: now });
  return { job, duplicate: false };
}

export function updateManualJob(store: JobsStore, id: string, input: JobUpdateInput): JobRecord | undefined {
  const existing = store.getJob(asJobId(id));
  if (!existing) return undefined;
  const next = {
    title: input.title ?? existing.title, company: input.company === undefined ? existing.company : normalizeText(input.company), description: input.description ?? existing.description,
    location: input.location === undefined ? existing.location : normalizeText(input.location), remoteStatus: input.remoteStatus ?? existing.remoteStatus, employmentType: input.employmentType === undefined ? existing.employmentType : normalizeText(input.employmentType),
    salary: input.salary === undefined ? existing.salary : normalizeText(input.salary), deadline: input.deadline === undefined ? existing.deadline : normalizeText(input.deadline), applicationUrl: input.url === undefined ? existing.applicationUrl : normalizeUrl(input.url),
    notes: input.notes === undefined ? existing.notes : normalizeText(input.notes),
  };
  const candidate = { provider: "manual", sourceType: "manual", sourceUrl: next.applicationUrl, title: next.title, company: next.company, description: next.description, location: next.location, remoteStatus: next.remoteStatus, employmentType: next.employmentType, salary: next.salary, deadline: next.deadline };
  const profile = store.getProfile();
  const match = matchCandidate(id, candidate, profile);
  const risk = detectRisk(candidate, profile);
  const updated = store.updateJob(asJobId(id), { ...next, matchScore: match.totalScore, matchLevel: match.level, riskScore: risk.score, riskLevel: risk.level, riskSignals: risk.signals });
  if (updated) {
    store.saveMatch(match);
    store.addActivity({ jobId: updated.id, type: "job_updated", message: "Job details updated.", createdAt: updated.updatedAt });
  }
  return updated;
}

export function refreshProfileMatches(store: JobsStore): void {
  const profile = store.getProfile();
  for (const job of store.listAllJobs(false)) {
    const candidate = { provider: "manual", sourceType: "manual", sourceUrl: job.applicationUrl, title: job.title, company: job.company, description: job.description, location: job.location, remoteStatus: job.remoteStatus, employmentType: job.employmentType, salary: job.salary, deadline: job.deadline };
    const match = matchCandidate(job.id, candidate, profile);
    const risk = detectRisk(candidate, profile);
    store.updateJob(job.id, { matchScore: match.totalScore, matchLevel: match.level, riskScore: risk.score, riskLevel: risk.level, riskSignals: risk.signals });
    store.saveMatch(match);
  }
}
