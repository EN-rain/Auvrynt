export interface OwnedBrowserSessionRecord {
  id: string;
  ownerClientId: string;
  workspaceId: string;
}

export class OwnedBrowserSessionRegistry<T extends OwnedBrowserSessionRecord> {
  private readonly sessions = new Map<string, T>();

  get size(): number {
    return this.sessions.size;
  }

  add(session: T): void {
    if (this.sessions.has(session.id)) {
      throw new Error(`Duplicate browser session id: ${session.id}`);
    }
    this.sessions.set(session.id, session);
  }

  getOwned(sessionId: string, ownerClientId: string): T {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerClientId !== ownerClientId) {
      throw new Error(`Unknown browser session: ${sessionId}. Open one with browser_open first.`);
    }
    return session;
  }

  listOwned(ownerClientId: string, workspaceId?: string): T[] {
    return Array.from(this.sessions.values()).filter((session) =>
      session.ownerClientId === ownerClientId
      && (!workspaceId || session.workspaceId === workspaceId));
  }

  hasOwned(sessionId: string, ownerClientId: string): boolean {
    const session = this.sessions.get(sessionId);
    return Boolean(session && session.ownerClientId === ownerClientId);
  }

  deleteOwned(sessionId: string, ownerClientId: string): T | undefined {
    if (!this.hasOwned(sessionId, ownerClientId)) return undefined;
    return this.deleteInternal(sessionId);
  }

  getInternal(sessionId: string): T | undefined {
    return this.sessions.get(sessionId);
  }

  deleteInternal(sessionId: string): T | undefined {
    const session = this.sessions.get(sessionId);
    if (session) this.sessions.delete(sessionId);
    return session;
  }

  values(): IterableIterator<T> {
    return this.sessions.values();
  }
}
