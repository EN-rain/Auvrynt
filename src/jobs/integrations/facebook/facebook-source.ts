import type { IntegrationSummary } from "../../../jobs/types.js";
import type { JobSourceAdapter } from "../types.js";

const status: IntegrationSummary = {
  provider: "facebook", label: "Facebook", enabled: false, status: "disabled",
  capabilities: { connect: true, disconnect: true, scan: true, manualRefresh: true, backgroundScan: false, sourceManagement: true },
};

export const facebookSource: JobSourceAdapter = {
  id: "facebook", label: "Facebook", getStatus: async () => status,
};
