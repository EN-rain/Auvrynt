import { MAX_MCP_SESSIONS } from "../infrastructure/session-limits.js";

export interface SessionLimits {
  maxSessions: number;
  maxSessionsPerClient: number;
}

export function normalizeSessionLimits(
  requestedMaxSessions: number,
  requestedMaxSessionsPerClient: number | undefined,
  currentMaxSessions: number,
  currentMaxSessionsPerClient: number,
): SessionLimits {
  const maxSessions = Number.isInteger(requestedMaxSessions) && requestedMaxSessions > 0
    ? Math.min(MAX_MCP_SESSIONS, requestedMaxSessions)
    : currentMaxSessions;
  const maxSessionsPerClient = typeof requestedMaxSessionsPerClient === "number"
    && Number.isInteger(requestedMaxSessionsPerClient) && requestedMaxSessionsPerClient > 0
    ? Math.min(maxSessions, requestedMaxSessionsPerClient)
    : Math.min(maxSessions, currentMaxSessionsPerClient);
  return { maxSessions, maxSessionsPerClient };
}
