import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  sessionId: string;
  ownerClientId: string;
  logicalSessionId?: string;
  roomId?: string;
  workspaceId?: string;
  authScopes: readonly string[];
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

export function requireRequestContext(): RequestContext {
  const ctx = als.getStore();
  if (!ctx) throw new Error("No request context available");
  return ctx;
}
