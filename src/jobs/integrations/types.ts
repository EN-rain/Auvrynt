import type { IntegrationSummary, JobCandidate } from "../types.js";

export interface JobSourceContext {
  readonly store: unknown;
}

export interface JobSourceScanOptions {
  query?: string;
  since?: string;
}

export interface JobSourceAdapter {
  id: string;
  label: string;
  getStatus(): Promise<IntegrationSummary>;
  connect?(context: JobSourceContext): Promise<IntegrationSummary>;
  disconnect?(context: JobSourceContext): Promise<void>;
  scan?(context: JobSourceContext, options: JobSourceScanOptions): Promise<JobCandidate[]>;
}
