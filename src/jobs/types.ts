export type JobId = string & { readonly __brand: "JobId" };
export type ProfileId = string & { readonly __brand: "ProfileId" };

export const TRACKER_STATUSES = [
  "NEW",
  "REVIEW",
  "SHORTLISTED",
  "READY_TO_APPLY",
  "APPLIED",
  "REPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "CLOSED",
  "ARCHIVED",
] as const;
export type TrackerStatus = (typeof TRACKER_STATUSES)[number];

export const MATCH_LEVELS = ["EXCELLENT", "STRONG", "POSSIBLE", "WEAK", "LOW"] as const;
export type MatchLevel = (typeof MATCH_LEVELS)[number];

export const RISK_LEVELS = ["NORMAL", "REVIEW", "HIGH_RISK", "AUTO_SKIP"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type JobClassification =
  | "JOB"
  | "FREELANCE_GIG"
  | "CONTRACT"
  | "INTERNSHIP"
  | "RECRUITER_POST"
  | "JOB_REPOST"
  | "UNKNOWN"
  | "NOT_A_JOB"
  | "SPAM"
  | "SCAM_SUSPECTED";

export type RemoteStatus = "remote" | "hybrid" | "onsite" | "unknown";

export interface JobCandidate {
  provider: string;
  sourceType: string;
  sourceUrl?: string;
  externalId?: string;
  title?: string;
  company?: string;
  description: string;
  postedAt?: string;
  location?: string;
  remoteStatus?: RemoteStatus;
  employmentType?: string;
  salary?: string;
  deadline?: string;
  applicationUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface JobProfile {
  id: ProfileId;
  targetRoles: string[];
  primarySkills: string[];
  secondarySkills: string[];
  experienceLevels: string[];
  country?: string;
  remote: boolean;
  hybridAcceptable: boolean;
  onsiteOptional: boolean;
  salaryPreference?: string;
  employmentPreference?: string;
  negativeKeywords: string[];
  minimumMatchScore: number;
  updatedAt: string;
}

export interface JobInput {
  title: string;
  company?: string;
  url?: string;
  description: string;
  location?: string;
  remoteStatus?: RemoteStatus;
  employmentType?: string;
  salary?: string;
  deadline?: string;
  notes?: string;
  initialStatus?: TrackerStatus;
}

export interface JobUpdateInput {
  title?: string;
  company?: string;
  url?: string;
  description?: string;
  location?: string;
  remoteStatus?: RemoteStatus;
  employmentType?: string;
  salary?: string;
  deadline?: string;
  notes?: string;
}

export interface JobMatch {
  jobId: JobId;
  profileId: ProfileId;
  matchedSkills: string[];
  partialSkills: string[];
  missingSkills: string[];
  scores: {
    role: number;
    requiredSkills: number;
    experience: number;
    location: number;
    preferredSkills: number;
    industry: number;
    other: number;
  };
  evaluatedWeights: number;
  totalScore: number;
  level: MatchLevel;
  explanation: string;
  evaluatedAt: string;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  signals: string[];
  explanation: string;
}

export interface JobRecord {
  id: JobId;
  title: string;
  company?: string;
  description: string;
  location?: string;
  remoteStatus: RemoteStatus;
  employmentType?: string;
  salary?: string;
  postedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  deadline?: string;
  classification: JobClassification;
  matchScore: number;
  matchLevel: MatchLevel;
  riskScore: number;
  riskLevel: RiskLevel;
  riskSignals: string[];
  status: TrackerStatus;
  applicationUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface JobSourceLink {
  id: string;
  jobId: JobId;
  provider: string;
  sourceType: string;
  sourceUrl?: string;
  externalId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  metadata?: Record<string, unknown>;
}

export interface JobActivityEvent {
  id: string;
  jobId?: JobId;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface JobApplication {
  jobId: JobId;
  status: TrackerStatus;
  appliedAt?: string;
  replyAt?: string;
  interviewAt?: string;
  offerAt?: string;
  rejectedAt?: string;
  followUpAt?: string;
  notes?: string;
  updatedAt: string;
}

export interface IntegrationSummary {
  provider: string;
  label: string;
  enabled: boolean;
  status: "connected" | "needs_login" | "available" | "disabled" | "error";
  /** Whether server-side provider setup is complete; never includes credentials. */
  configuration?: "ready" | "missing";
  /** Safe account label returned by the provider, when connected. */
  accountLabel?: string;
  connectedAt?: string;
  connectUrl?: string;
  disconnectUrl?: string;
  capabilities: {
    connect: boolean;
    disconnect: boolean;
    scan: boolean;
    manualRefresh: boolean;
    backgroundScan: boolean;
    sourceManagement: boolean;
  };
  lastCheckedAt?: string;
  lastError?: string;
}

export interface JobListQuery {
  page?: number;
  pageSize?: number;
  query?: string;
  status?: TrackerStatus;
  source?: string;
  minimumMatchScore?: number;
  risk?: RiskLevel;
  sortBy?: "newest" | "match" | "deadline" | "company" | "status";
  sortOrder?: "asc" | "desc";
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface JobsSummary {
  total: number;
  newJobs: number;
  excellentMatches: number;
  strongMatches: number;
  shortlisted: number;
  applicationsSent: number;
  waitingForReply: number;
  interviews: number;
  offers: number;
  rejected: number;
  archived: number;
  newToday: number;
  averageMatchScore: number;
  sourcesConnected: number;
}

export interface JobsDashboardView {
  summary: JobsSummary;
  opportunities: Paginated<JobRecord>;
  tracker: Record<TrackerStatus, JobRecord[]>;
  integrations: IntegrationSummary[];
  recentActivity: JobActivityEvent[];
  profile: JobProfile;
}

export function asJobId(value: string): JobId {
  return value as JobId;
}

export function asProfileId(value: string): ProfileId {
  return value as ProfileId;
}
