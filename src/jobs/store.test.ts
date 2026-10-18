import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobsStore } from "./store.js";
import { asJobId, asProfileId } from "./types.js";

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-jobs-store-"));
const now = new Date().toISOString();

try {
  const store = new JobsStore(stateDir);
  const profile = store.getProfile();
  assert.equal(profile.id, "default");
  assert.equal(profile.minimumMatchScore, 60);
  assert.deepEqual(store.listIntegrations().map((item) => [item.provider, item.enabled, item.status]), [
    ["manual", true, "available"],
    ["facebook", false, "disabled"],
  ]);

  const savedProfile = store.saveProfile({
    ...profile,
    targetRoles: ["Unity Developer"],
    primarySkills: ["Unity", "C#"],
    minimumMatchScore: 75,
  });
  assert.deepEqual(savedProfile.targetRoles, ["Unity Developer"]);
  assert.equal(store.getProfile().minimumMatchScore, 75);

  const jobId = asJobId("job_store_test");
  store.createJob(
    {
      id: jobId,
      title: "Unity Developer",
      company: "Example Studio",
      description: "Build gameplay systems with Unity and C#.",
      remoteStatus: "remote",
      firstSeenAt: now,
      lastSeenAt: now,
      classification: "JOB",
      matchScore: 92,
      matchLevel: "EXCELLENT",
      riskScore: 0,
      riskLevel: "NORMAL",
      riskSignals: [],
      status: "NEW",
      createdAt: now,
      updatedAt: now,
    },
    { provider: "manual", sourceType: "manual", sourceUrl: "https://jobs.example/1" },
    {
      jobId,
      profileId: asProfileId("default"),
      matchedSkills: ["Unity", "C#"],
      partialSkills: [],
      missingSkills: [],
      scores: { role: 25, requiredSkills: 30, experience: 15, location: 10, preferredSkills: 10, industry: 0, other: 0 },
      evaluatedWeights: 90,
      totalScore: 92,
      level: "EXCELLENT",
      explanation: "Strong role and skill match.",
      evaluatedAt: now,
    },
    { jobId, status: "NEW", updatedAt: now },
  );
  assert.equal(store.getJob(jobId)?.title, "Unity Developer");
  assert.equal(store.listJobs({ pageSize: 1 }).pagination.totalItems, 1);
  assert.equal(store.listJobs({ query: "example studio" }).data[0]?.id, jobId);

  const changed = store.setStatus(jobId, "SHORTLISTED");
  assert.equal(changed?.status, "SHORTLISTED");
  assert.equal(store.listActivity().some((event) => event.type === "job_status_changed"), true);
  store.close();

  const reopened = new JobsStore(stateDir);
  assert.equal(reopened.getJob(jobId)?.status, "SHORTLISTED");
  assert.deepEqual(reopened.getProfile().primarySkills, ["Unity", "C#"]);
  reopened.close();
  console.log("jobs store tests passed");
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
