import type { JobCandidate, JobInput, RemoteStatus } from "./types.js";

export function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

export function normalizeUrl(value: string | undefined): string | undefined {
  const text = normalizeText(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return text.toLowerCase();
  }
}

export function normalizeRemoteStatus(value: string | undefined): RemoteStatus {
  const text = value?.toLowerCase() ?? "";
  if (text.includes("remote") || text.includes("work from home") || text.includes("wfh")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("on-site") || text.includes("onsite") || text.includes("office")) return "onsite";
  return "unknown";
}

export function candidateFromManualInput(input: JobInput): JobCandidate {
  return {
    provider: "manual",
    sourceType: "manual",
    sourceUrl: normalizeUrl(input.url),
    title: normalizeText(input.title),
    company: normalizeText(input.company),
    description: normalizeText(input.description) ?? "",
    location: normalizeText(input.location),
    remoteStatus: input.remoteStatus ?? normalizeRemoteStatus(`${input.location ?? ""} ${input.description}`),
    employmentType: normalizeText(input.employmentType),
    salary: normalizeText(input.salary),
    deadline: normalizeText(input.deadline),
  };
}

export function normalizedComparisonText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
