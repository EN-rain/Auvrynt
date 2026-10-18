import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { backupJobsDatabase, openJobsDatabase, type JobsDatabaseHandle } from "./database.js";
import { FacebookTokenVault } from "./integrations/facebook/facebook-token-vault.js";
import {
  asJobId,
  asProfileId,
  type IntegrationSummary,
  type JobActivityEvent,
  type JobApplication,
  type JobId,
  type JobListQuery,
  type JobMatch,
  type JobProfile,
  type JobRecord,
  type JobSourceLink,
  type JobsSummary,
  type MatchLevel,
  type Paginated,
  type ProfileId,
  type RiskLevel,
  type TrackerStatus,
  TRACKER_STATUSES,
} from "./types.js";

interface StoredJobInput {
  id: JobId;
  title: string;
  company?: string;
  description: string;
  location?: string;
  remoteStatus: string;
  employmentType?: string;
  salary?: string;
  postedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  deadline?: string;
  classification: string;
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

const DEFAULT_PROFILE: Omit<JobProfile, "updatedAt"> = {
  id: asProfileId("default"),
  targetRoles: [],
  primarySkills: [],
  secondarySkills: [],
  experienceLevels: [],
  remote: true,
  hybridAcceptable: true,
  onsiteOptional: false,
  salaryPreference: undefined,
  employmentPreference: undefined,
  country: undefined,
  negativeKeywords: [],
  minimumMatchScore: 60,
};

const INTEGRATION_SEEDS = [
  {
    provider: "manual",
    label: "Manual",
    enabled: true,
    status: "available",
    capabilities: { connect: false, disconnect: false, scan: false, manualRefresh: false, backgroundScan: false, sourceManagement: false },
  },
  {
    provider: "facebook",
    label: "Facebook",
    enabled: false,
    status: "disabled",
    capabilities: { connect: true, disconnect: true, scan: true, manualRefresh: true, backgroundScan: false, sourceManagement: true },
  },
] as const;

export class JobsStore {
  private readonly database: JobsDatabaseHandle;
  private readonly facebookTokenVault: FacebookTokenVault;
  private closed = false;

  constructor(private readonly stateDir: string) {
    this.database = openJobsDatabase(stateDir);
    this.facebookTokenVault = new FacebookTokenVault(stateDir);
    this.migrate();
    this.seedIntegrations();
  }

  get sqlite(): Database.Database {
    return this.database.sqlite;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  getProfile(): JobProfile {
    const row = this.sqlite.prepare("select * from job_profiles where id = ?").get("default") as Record<string, unknown> | undefined;
    if (!row) {
      const profile = { ...DEFAULT_PROFILE, updatedAt: new Date().toISOString() };
      this.saveProfile(profile);
      return profile;
    }
    return profileFromRow(row);
  }

  saveProfile(profile: Omit<JobProfile, "updatedAt"> | JobProfile): JobProfile {
    const saved: JobProfile = { ...profile, id: asProfileId("default"), updatedAt: new Date().toISOString() };
    this.sqlite.prepare(`
      insert into job_profiles (id, target_roles_json, primary_skills_json, secondary_skills_json, experience_levels_json,
        country, remote, hybrid_acceptable, onsite_optional, salary_preference, employment_preference,
        negative_keywords_json, minimum_match_score, updated_at)
      values (@id, @targetRoles, @primarySkills, @secondarySkills, @experienceLevels, @country, @remote,
        @hybridAcceptable, @onsiteOptional, @salaryPreference, @employmentPreference, @negativeKeywords,
        @minimumMatchScore, @updatedAt)
      on conflict(id) do update set
        target_roles_json = excluded.target_roles_json,
        primary_skills_json = excluded.primary_skills_json,
        secondary_skills_json = excluded.secondary_skills_json,
        experience_levels_json = excluded.experience_levels_json,
        country = excluded.country,
        remote = excluded.remote,
        hybrid_acceptable = excluded.hybrid_acceptable,
        onsite_optional = excluded.onsite_optional,
        salary_preference = excluded.salary_preference,
        employment_preference = excluded.employment_preference,
        negative_keywords_json = excluded.negative_keywords_json,
        minimum_match_score = excluded.minimum_match_score,
        updated_at = excluded.updated_at
    `).run({
      id: saved.id,
      targetRoles: JSON.stringify(saved.targetRoles),
      primarySkills: JSON.stringify(saved.primarySkills),
      secondarySkills: JSON.stringify(saved.secondarySkills),
      experienceLevels: JSON.stringify(saved.experienceLevels),
      country: saved.country ?? null,
      remote: saved.remote ? 1 : 0,
      hybridAcceptable: saved.hybridAcceptable ? 1 : 0,
      onsiteOptional: saved.onsiteOptional ? 1 : 0,
      salaryPreference: saved.salaryPreference ?? null,
      employmentPreference: saved.employmentPreference ?? null,
      negativeKeywords: JSON.stringify(saved.negativeKeywords),
      minimumMatchScore: saved.minimumMatchScore,
      updatedAt: saved.updatedAt,
    });
    return saved;
  }

  createJob(job: StoredJobInput, source: Omit<JobSourceLink, "jobId" | "id" | "firstSeenAt" | "lastSeenAt">, match: JobMatch, application: JobApplication): JobRecord {
    const sourceId = randomUUID();
    const now = job.createdAt;
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare(`
        insert into jobs (id, title, company, description, location, remote_status, employment_type, salary, posted_at,
          first_seen_at, last_seen_at, deadline, classification, match_score, match_level, risk_score, risk_level,
          risk_signals_json, status, application_url, notes, created_at, updated_at, archived_at)
        values (@id, @title, @company, @description, @location, @remoteStatus, @employmentType, @salary, @postedAt,
          @firstSeenAt, @lastSeenAt, @deadline, @classification, @matchScore, @matchLevel, @riskScore, @riskLevel,
          @riskSignals, @status, @applicationUrl, @notes, @createdAt, @updatedAt, @archivedAt)
      `).run({
        id: job.id,
        title: job.title,
        company: job.company ?? null,
        description: job.description,
        location: job.location ?? null,
        remoteStatus: job.remoteStatus,
        employmentType: job.employmentType ?? null,
        salary: job.salary ?? null,
        postedAt: job.postedAt ?? null,
        firstSeenAt: job.firstSeenAt,
        lastSeenAt: job.lastSeenAt,
        deadline: job.deadline ?? null,
        classification: job.classification,
        matchScore: job.matchScore,
        matchLevel: job.matchLevel,
        riskScore: job.riskScore,
        riskLevel: job.riskLevel,
        riskSignals: JSON.stringify(job.riskSignals),
        status: job.status,
        applicationUrl: job.applicationUrl ?? null,
        notes: job.notes ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        archivedAt: job.archivedAt ?? null,
      });
      this.sqlite.prepare(`
        insert into job_source_links (id, job_id, provider, source_type, source_url, external_id, first_seen_at, last_seen_at, metadata_json)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sourceId, job.id, source.provider, source.sourceType, source.sourceUrl ?? null, source.externalId ?? null, now, now, JSON.stringify(source.metadata ?? {}));
      this.saveMatch(match);
      this.sqlite.prepare(`
        insert into job_applications (job_id, status, applied_at, reply_at, interview_at, offer_at, rejected_at, follow_up_at, notes, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(application.jobId, application.status, application.appliedAt ?? (application.status === "APPLIED" ? application.updatedAt : null), application.replyAt ?? (application.status === "REPLIED" ? application.updatedAt : null), application.interviewAt ?? (application.status === "INTERVIEW" ? application.updatedAt : null), application.offerAt ?? (application.status === "OFFER" ? application.updatedAt : null), application.rejectedAt ?? (application.status === "REJECTED" ? application.updatedAt : null), application.followUpAt ?? null, application.notes ?? null, application.updatedAt);
      this.addActivity({ jobId: job.id, type: "job_added", message: "Job added to Jobs.", createdAt: now });
    });
    transaction();
    return this.getJob(job.id)!;
  }

  getJob(id: JobId): JobRecord | undefined {
    const row = this.sqlite.prepare("select * from jobs where id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? jobFromRow(row) : undefined;
  }

  listAllJobs(includeArchived = true): JobRecord[] {
    const rows = this.sqlite.prepare(includeArchived ? "select * from jobs order by first_seen_at desc" : "select * from jobs where status <> 'ARCHIVED' order by first_seen_at desc").all() as Record<string, unknown>[];
    return rows.map(jobFromRow);
  }

  findDuplicate(input: { sourceUrl?: string; title: string; company?: string; location?: string; description: string }): JobRecord | undefined {
    if (input.sourceUrl) {
      const row = this.sqlite.prepare("select jobs.* from jobs join job_source_links on job_source_links.job_id = jobs.id where job_source_links.source_url = ? limit 1").get(input.sourceUrl) as Record<string, unknown> | undefined;
      if (row) return jobFromRow(row);
    }
    const rows = this.sqlite.prepare(`
      select * from jobs where lower(title) = lower(?)
        and lower(coalesce(company, '')) = lower(coalesce(?, ''))
        and lower(coalesce(location, '')) = lower(coalesce(?, ''))
    `).all(input.title, input.company ?? null, input.location ?? null) as Record<string, unknown>[];
    const description = normalizeLookup(input.description);
    return rows.map(jobFromRow).find((job) => normalizeLookup(job.description) === description);
  }

  addSourceLink(source: Omit<JobSourceLink, "id">): JobSourceLink {
    const link = { ...source, id: randomUUID() };
    this.sqlite.prepare(`
      insert or ignore into job_source_links (id, job_id, provider, source_type, source_url, external_id, first_seen_at, last_seen_at, metadata_json)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(link.id, link.jobId, link.provider, link.sourceType, link.sourceUrl ?? null, link.externalId ?? null, link.firstSeenAt, link.lastSeenAt, JSON.stringify(link.metadata ?? {}));
    return link;
  }

  markDuplicate(jobId: JobId, source: Omit<JobSourceLink, "id" | "jobId" | "firstSeenAt" | "lastSeenAt">, now = new Date().toISOString()): JobRecord | undefined {
    this.sqlite.transaction(() => {
      this.sqlite.prepare("update jobs set last_seen_at = ?, updated_at = ? where id = ?").run(now, now, jobId);
      this.addSourceLink({ ...source, jobId, firstSeenAt: now, lastSeenAt: now });
      this.addActivity({ jobId, type: "job_duplicate_merged", message: "A duplicate source was linked to this job.", metadata: { provider: source.provider }, createdAt: now });
    })();
    return this.getJob(jobId);
  }

  listJobs(query: JobListQuery = {}): Paginated<JobRecord> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 50)));
    const conditions: string[] = ["1 = 1"];
    const params: Record<string, unknown> = {};
    if (query.query?.trim()) {
      conditions.push("(lower(title) like @query or lower(coalesce(company, '')) like @query or lower(description) like @query or lower(coalesce(notes, '')) like @query)");
      params.query = `%${query.query.trim().toLowerCase()}%`;
    }
    if (query.status) { conditions.push("status = @status"); params.status = query.status; }
    if (query.minimumMatchScore !== undefined) { conditions.push("match_score >= @minimumMatchScore"); params.minimumMatchScore = query.minimumMatchScore; }
    if (query.risk) { conditions.push("risk_level = @risk"); params.risk = query.risk; }
    if (query.source) {
      conditions.push("exists (select 1 from job_source_links source_filter where source_filter.job_id = jobs.id and source_filter.provider = @source)");
      params.source = query.source;
    }
    const where = conditions.join(" and ");
    const total = (this.sqlite.prepare(`select count(*) as count from jobs where ${where}`).get(params) as { count: number }).count;
    const order = sortSql(query.sortBy, query.sortOrder);
    const rows = this.sqlite.prepare(`select * from jobs where ${where} order by ${order} limit @limit offset @offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[];
    return { data: rows.map(jobFromRow), pagination: { page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  updateJob(id: JobId, updates: Partial<StoredJobInput>): JobRecord | undefined {
    const current = this.getJob(id);
    if (!current) return undefined;
    const next = { ...current, ...updates, id, updatedAt: new Date().toISOString() };
    this.sqlite.prepare(`
      update jobs set title=@title, company=@company, description=@description, location=@location, remote_status=@remoteStatus,
        employment_type=@employmentType, salary=@salary, deadline=@deadline, application_url=@applicationUrl, notes=@notes,
        match_score=@matchScore, match_level=@matchLevel, risk_score=@riskScore, risk_level=@riskLevel, risk_signals_json=@riskSignals,
        status=@status, updated_at=@updatedAt, archived_at=@archivedAt where id=@id
    `).run({
      id, title: next.title, company: next.company ?? null, description: next.description, location: next.location ?? null,
      remoteStatus: next.remoteStatus, employmentType: next.employmentType ?? null, salary: next.salary ?? null,
      deadline: next.deadline ?? null, applicationUrl: next.applicationUrl ?? null, notes: next.notes ?? null,
      matchScore: next.matchScore, matchLevel: next.matchLevel, riskScore: next.riskScore, riskLevel: next.riskLevel,
      riskSignals: JSON.stringify(next.riskSignals), status: next.status, updatedAt: next.updatedAt, archivedAt: next.archivedAt ?? null,
    });
    return this.getJob(id);
  }

  setStatus(id: JobId, status: TrackerStatus): JobRecord | undefined {
    const current = this.getJob(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const archivedAt = status === "ARCHIVED" ? now : undefined;
    this.sqlite.transaction(() => {
      this.sqlite.prepare("update jobs set status = ?, archived_at = ?, updated_at = ? where id = ?").run(status, archivedAt ?? null, now, id);
      this.sqlite.prepare("update job_applications set status = ?, updated_at = ? where job_id = ?").run(status, now, id);
      const timestampColumn = applicationTimestampColumn(status);
      if (timestampColumn) this.sqlite.prepare(`update job_applications set ${timestampColumn} = coalesce(${timestampColumn}, ?), updated_at = ? where job_id = ?`).run(now, now, id);
      this.addActivity({ jobId: id, type: "job_status_changed", message: `Status changed to ${status}.`, metadata: { status }, createdAt: now });
    })();
    return this.getJob(id);
  }

  archiveJob(id: JobId): JobRecord | undefined {
    return this.setStatus(id, "ARCHIVED");
  }

  saveMatch(match: JobMatch): void {
    this.sqlite.prepare(`
      insert into job_matches (job_id, profile_id, matched_skills_json, partial_skills_json, missing_skills_json,
        role_score, required_skill_score, experience_score, location_score, preferred_skill_score, industry_score,
        other_score, evaluated_weights, total_score, match_level, explanation, evaluated_at)
      values (@jobId, @profileId, @matched, @partial, @missing, @role, @required, @experience, @location, @preferred,
        @industry, @other, @evaluatedWeights, @total, @level, @explanation, @evaluatedAt)
      on conflict(job_id, profile_id) do update set matched_skills_json=excluded.matched_skills_json,
        partial_skills_json=excluded.partial_skills_json, missing_skills_json=excluded.missing_skills_json,
        role_score=excluded.role_score, required_skill_score=excluded.required_skill_score, experience_score=excluded.experience_score,
        location_score=excluded.location_score, preferred_skill_score=excluded.preferred_skill_score, industry_score=excluded.industry_score,
        other_score=excluded.other_score, evaluated_weights=excluded.evaluated_weights, total_score=excluded.total_score,
        match_level=excluded.match_level, explanation=excluded.explanation, evaluated_at=excluded.evaluated_at
    `).run({
      jobId: match.jobId, profileId: match.profileId, matched: JSON.stringify(match.matchedSkills), partial: JSON.stringify(match.partialSkills), missing: JSON.stringify(match.missingSkills),
      role: match.scores.role, required: match.scores.requiredSkills, experience: match.scores.experience, location: match.scores.location,
      preferred: match.scores.preferredSkills, industry: match.scores.industry, other: match.scores.other, evaluatedWeights: match.evaluatedWeights,
      total: match.totalScore, level: match.level, explanation: match.explanation, evaluatedAt: match.evaluatedAt,
    });
  }

  addActivity(event: Omit<JobActivityEvent, "id">): JobActivityEvent {
    const saved = { ...event, id: randomUUID() };
    this.sqlite.prepare("insert into job_activity (id, job_id, type, message, metadata_json, created_at) values (?, ?, ?, ?, ?, ?)").run(saved.id, saved.jobId ?? null, saved.type, saved.message, JSON.stringify(saved.metadata ?? {}), saved.createdAt);
    return saved;
  }

  listActivity(limit = 20): JobActivityEvent[] {
    const rows = this.sqlite.prepare("select * from job_activity order by created_at desc limit ?").all(Math.min(100, Math.max(1, limit))) as Record<string, unknown>[];
    return rows.map(activityFromRow);
  }

  listIntegrations(): IntegrationSummary[] {
    const rows = this.sqlite.prepare("select * from integration_connections order by case provider when 'manual' then 0 else 1 end, provider").all() as Record<string, unknown>[];
    return rows.map((row) => {
      const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
      return {
        provider: String(row.provider), label: String(row.label), enabled: Number(row.enabled) === 1,
        status: String(row.status) as IntegrationSummary["status"], capabilities: parseJson(row.capabilities_json, {
        connect: false, disconnect: false, scan: false, manualRefresh: false, backgroundScan: false, sourceManagement: false,
        }),
        accountLabel: typeof metadata.accountName === "string" ? metadata.accountName : undefined,
        connectedAt: row.connected_at ? String(row.connected_at) : undefined,
        lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : undefined,
        lastError: row.last_error ? String(row.last_error) : undefined,
      };
    });
  }

  connectFacebook(input: { accountId: string; accountName?: string; accessToken: string; tokenExpiresAt?: string }): IntegrationSummary {
    if (!/^[^\s]{1,256}$/.test(input.accountId) || !input.accessToken || input.accessToken.length > 16_384) throw new Error("Invalid Facebook connection.");
    if (input.accountName !== undefined && input.accountName.length > 256) throw new Error("Invalid Facebook connection.");
    const now = new Date().toISOString();
    const metadata = {
      accountId: input.accountId,
      accountName: input.accountName,
      tokenExpiresAt: input.tokenExpiresAt,
      accessTokenCiphertext: this.facebookTokenVault.encrypt(input.accessToken),
    };
    const result = this.sqlite.prepare(`
      update integration_connections
      set enabled = 1, status = 'connected', connected_at = ?, last_checked_at = ?, last_error = null, metadata_json = ?
      where provider = 'facebook'
    `).run(now, now, JSON.stringify(metadata));
    if (result.changes !== 1) throw new Error("Facebook integration is unavailable.");
    const integration = this.listIntegrations().find((item) => item.provider === "facebook");
    if (!integration) throw new Error("Facebook integration is unavailable.");
    return integration;
  }

  getFacebookAccessToken(): string | undefined {
    const row = this.sqlite.prepare("select metadata_json from integration_connections where provider = 'facebook'").get() as { metadata_json?: unknown } | undefined;
    if (!row) return undefined;
    const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
    const ciphertext = metadata.accessTokenCiphertext;
    if (typeof ciphertext !== "string") return undefined;
    try { return this.facebookTokenVault.decrypt(ciphertext); } catch { return undefined; }
  }

  disconnectFacebook(): IntegrationSummary | undefined {
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      update integration_connections
      set enabled = 0, status = 'disabled', connected_at = null, last_checked_at = ?, last_error = null, metadata_json = '{}'
      where provider = 'facebook'
    `).run(now);
    return this.listIntegrations().find((item) => item.provider === "facebook");
  }

  summary(): JobsSummary {
    const count = (sql: string, params: unknown[] = []) => Number((this.sqlite.prepare(sql).get(...params) as { count: number }).count);
    const total = count("select count(*) as count from jobs where status <> 'ARCHIVED'");
    const average = Number((this.sqlite.prepare("select coalesce(avg(match_score), 0) as average from jobs where status <> 'ARCHIVED'").get() as { average: number }).average.toFixed(1));
    const newToday = count("select count(*) as count from jobs where first_seen_at >= ?", [new Date(Date.now() - 86_400_000).toISOString()]);
    return {
      total, newJobs: count("select count(*) as count from jobs where status = 'NEW'"), excellentMatches: count("select count(*) as count from jobs where match_level = 'EXCELLENT' and status <> 'ARCHIVED'"),
      strongMatches: count("select count(*) as count from jobs where match_level = 'STRONG' and status <> 'ARCHIVED'"), shortlisted: count("select count(*) as count from jobs where status = 'SHORTLISTED'"),
      applicationsSent: count("select count(*) as count from jobs where status in ('APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER')"), waitingForReply: count("select count(*) as count from jobs where status = 'APPLIED'"),
      interviews: count("select count(*) as count from jobs where status = 'INTERVIEW'"), offers: count("select count(*) as count from jobs where status = 'OFFER'"), rejected: count("select count(*) as count from jobs where status = 'REJECTED'"),
      archived: count("select count(*) as count from jobs where status = 'ARCHIVED'"), newToday, averageMatchScore: average, sourcesConnected: count("select count(*) as count from integration_connections where enabled = 1 and status in ('connected', 'available')"),
    };
  }

  private migrate(): void {
    this.sqlite.exec("create table if not exists jobs_migrations (name text primary key, applied_at text not null)");
    const applied = new Set((this.sqlite.prepare("select name from jobs_migrations").all() as Array<{ name: string }>).map((row) => row.name));
    if (applied.has("v1_jobs_core")) return;
    backupJobsDatabase(this.stateDir);
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.exec(`
        create table if not exists job_profiles (
          id text primary key, target_roles_json text not null, primary_skills_json text not null,
          secondary_skills_json text not null, experience_levels_json text not null, country text,
          remote integer not null default 1, hybrid_acceptable integer not null default 1, onsite_optional integer not null default 0,
          salary_preference text, employment_preference text, negative_keywords_json text not null,
          minimum_match_score integer not null default 60, updated_at text not null
        );
        create table if not exists jobs (
          id text primary key, title text not null, company text, description text not null, location text,
          remote_status text not null, employment_type text, salary text, posted_at text, first_seen_at text not null,
          last_seen_at text not null, deadline text, classification text not null, match_score integer not null,
          match_level text not null, risk_score integer not null, risk_level text not null, risk_signals_json text not null,
          status text not null, application_url text, notes text, created_at text not null, updated_at text not null, archived_at text
        );
        create index if not exists jobs_status_idx on jobs(status);
        create index if not exists jobs_match_idx on jobs(match_score);
        create index if not exists jobs_seen_idx on jobs(first_seen_at);
        create index if not exists jobs_company_idx on jobs(company);
        create table if not exists job_source_links (
          id text primary key, job_id text not null references jobs(id) on delete cascade, provider text not null,
          source_type text not null, source_url text, external_id text, first_seen_at text not null, last_seen_at text not null,
          metadata_json text not null
        );
        create index if not exists job_source_links_job_idx on job_source_links(job_id);
        create index if not exists job_source_links_provider_idx on job_source_links(provider);
        create unique index if not exists job_source_links_url_idx on job_source_links(provider, source_url) where source_url is not null;
        create table if not exists job_matches (
          job_id text not null references jobs(id) on delete cascade, profile_id text not null references job_profiles(id) on delete cascade,
          matched_skills_json text not null, partial_skills_json text not null, missing_skills_json text not null,
          role_score integer not null, required_skill_score integer not null, experience_score integer not null,
          location_score integer not null, preferred_skill_score integer not null, industry_score integer not null,
          other_score integer not null, evaluated_weights integer not null, total_score integer not null,
          match_level text not null, explanation text not null, evaluated_at text not null,
          primary key(job_id, profile_id)
        );
        create table if not exists job_applications (
          job_id text primary key references jobs(id) on delete cascade, status text not null, applied_at text,
          reply_at text, interview_at text, offer_at text, rejected_at text, follow_up_at text, notes text, updated_at text not null
        );
        create table if not exists job_activity (
          id text primary key, job_id text references jobs(id) on delete cascade, type text not null,
          message text not null, metadata_json text not null, created_at text not null
        );
        create index if not exists job_activity_created_idx on job_activity(created_at);
        create table if not exists integration_connections (
          provider text primary key, label text not null, enabled integer not null default 0, status text not null,
          capabilities_json text not null, connected_at text, last_checked_at text, last_error text, metadata_json text not null
        );
      `);
      this.sqlite.prepare("insert into jobs_migrations (name, applied_at) values (?, ?)").run("v1_jobs_core", new Date().toISOString());
    });
    transaction();
  }

  private seedIntegrations(): void {
    const statement = this.sqlite.prepare(`insert into integration_connections (provider, label, enabled, status, capabilities_json, metadata_json) values (?, ?, ?, ?, ?, ?) on conflict(provider) do nothing`);
    const transaction = this.sqlite.transaction(() => {
      for (const seed of INTEGRATION_SEEDS) statement.run(seed.provider, seed.label, seed.enabled ? 1 : 0, seed.status, JSON.stringify(seed.capabilities), "{}");
    });
    transaction();
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function profileFromRow(row: Record<string, unknown>): JobProfile {
  return {
    id: asProfileId(String(row.id)), targetRoles: parseJson(row.target_roles_json, []), primarySkills: parseJson(row.primary_skills_json, []),
    secondarySkills: parseJson(row.secondary_skills_json, []), experienceLevels: parseJson(row.experience_levels_json, []), country: row.country ? String(row.country) : undefined,
    remote: Number(row.remote) === 1, hybridAcceptable: Number(row.hybrid_acceptable) === 1, onsiteOptional: Number(row.onsite_optional) === 1,
    salaryPreference: row.salary_preference ? String(row.salary_preference) : undefined, employmentPreference: row.employment_preference ? String(row.employment_preference) : undefined,
    negativeKeywords: parseJson(row.negative_keywords_json, []), minimumMatchScore: Number(row.minimum_match_score), updatedAt: String(row.updated_at),
  };
}

function jobFromRow(row: Record<string, unknown>): JobRecord {
  return {
    id: asJobId(String(row.id)), title: String(row.title), company: row.company ? String(row.company) : undefined, description: String(row.description),
    location: row.location ? String(row.location) : undefined, remoteStatus: String(row.remote_status) as JobRecord["remoteStatus"], employmentType: row.employment_type ? String(row.employment_type) : undefined,
    salary: row.salary ? String(row.salary) : undefined, postedAt: row.posted_at ? String(row.posted_at) : undefined, firstSeenAt: String(row.first_seen_at), lastSeenAt: String(row.last_seen_at),
    deadline: row.deadline ? String(row.deadline) : undefined, classification: String(row.classification) as JobRecord["classification"], matchScore: Number(row.match_score), matchLevel: String(row.match_level) as MatchLevel,
    riskScore: Number(row.risk_score), riskLevel: String(row.risk_level) as RiskLevel, riskSignals: parseJson(row.risk_signals_json, []), status: String(row.status) as TrackerStatus,
    applicationUrl: row.application_url ? String(row.application_url) : undefined, notes: row.notes ? String(row.notes) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at), archivedAt: row.archived_at ? String(row.archived_at) : undefined,
  };
}

function activityFromRow(row: Record<string, unknown>): JobActivityEvent {
  return { id: String(row.id), jobId: row.job_id ? asJobId(String(row.job_id)) : undefined, type: String(row.type), message: String(row.message), metadata: parseJson(row.metadata_json, {}), createdAt: String(row.created_at) };
}

function sortSql(sortBy: JobListQuery["sortBy"], order: JobListQuery["sortOrder"]): string {
  const direction = order === "asc" ? "asc" : "desc";
  switch (sortBy) {
    case "match": return `match_score ${direction}, first_seen_at desc`;
    case "deadline": return `deadline is null, deadline ${direction}, first_seen_at desc`;
    case "company": return `lower(coalesce(company, '')) ${direction}, first_seen_at desc`;
    case "status": return `status ${direction}, first_seen_at desc`;
    default: return `first_seen_at ${direction}`;
  }
}

function applicationTimestampColumn(status: TrackerStatus): "applied_at" | "reply_at" | "interview_at" | "offer_at" | "rejected_at" | undefined {
  switch (status) {
    case "APPLIED": return "applied_at";
    case "REPLIED": return "reply_at";
    case "INTERVIEW": return "interview_at";
    case "OFFER": return "offer_at";
    case "REJECTED": return "rejected_at";
    default: return undefined;
  }
}

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
