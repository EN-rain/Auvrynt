import type { IntegrationSummary } from "../../types.js";
import type { JobSourceAdapter } from "../types.js";

const status: IntegrationSummary = {
  provider: "manual", label: "Manual", enabled: true, status: "available",
  capabilities: { connect: false, disconnect: false, scan: false, manualRefresh: false, backgroundScan: false, sourceManagement: false },
};

export const manualSource: JobSourceAdapter = {
  id: "manual", label: "Manual", getStatus: async () => status,
};
