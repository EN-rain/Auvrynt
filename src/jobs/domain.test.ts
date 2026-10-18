import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyCandidate } from "./classifier.js";
import { createJobSourceRegistry } from "./integrations/registry.js";
import { matchCandidate } from "./matcher.js";
import { ingestManualJob, refreshProfileMatches } from "./pipeline.js";
import { detectRisk } from "./risk-detector.js";
import { JobsStore } from "./store.js";
import { asProfileId } from "./types.js";

const profile = {
  id: asProfileId("default"), targetRoles: ["Unity Developer"], primarySkills: ["Unity", "C#"], secondarySkills: ["Blender"],
  experienceLevels: ["junior", "mid"], country: "Philippines", remote: true, hybridAcceptable: true, onsiteOptional: false,
  negativeKeywords: ["MLM"], minimumMatchScore: 60, updatedAt: new Date().toISOString(),
};
const candidate = { provider: "manual", sourceType: "manual", title: "Unity Developer", company: "Good Studio", description: "We are hiring a junior Unity developer with Unity and C# skills.", location: "Remote", remoteStatus: "remote" as const };
assert.equal(classifyCandidate(candidate), "JOB");
assert.equal(matchCandidate("job_test", candidate, profile).level, "STRONG");
assert.equal(detectRisk({ ...candidate, description: "Pay a registration fee and send your OTP to start." }, profile).level, "AUTO_SKIP");
assert.equal(detectRisk(candidate, profile).level, "NORMAL");

const stateDir = mkdtempSync(join(tmpdir(), "auvrynt-jobs-domain-"));
try {
  const store = new JobsStore(stateDir);
  store.saveProfile(profile);
  const first = ingestManualJob(store, { title: candidate.title!, company: candidate.company, description: candidate.description, location: candidate.location, remoteStatus: candidate.remoteStatus, url: "https://jobs.example/unity" });
  assert.equal(first.duplicate, false);
  const duplicate = ingestManualJob(store, { title: candidate.title!, company: candidate.company, description: candidate.description, location: candidate.location, remoteStatus: candidate.remoteStatus, url: "https://jobs.example/unity#apply" });
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.listAllJobs().length, 1);
  const risky = ingestManualJob(store, { title: "Remote Assistant", company: "Questionable Studio", description: "Pay a registration fee before you can start this remote job.", url: "https://jobs.example/risky", initialStatus: "APPLIED" });
  assert.equal(risky.job.status, "REVIEW");
  store.saveProfile({ ...profile, targetRoles: ["Gameplay Programmer"], primarySkills: ["C++"], secondarySkills: [] });
  refreshProfileMatches(store);
  assert.equal(store.getJob(first.job.id)?.matchLevel, "LOW");
  store.close();
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}

const registry = createJobSourceRegistry();
assert.deepEqual(registry.list().map((source) => source.id), ["manual", "facebook"]);
assert.equal((await registry.get("facebook")?.getStatus())?.status, "disabled");
console.log("jobs domain tests passed");
