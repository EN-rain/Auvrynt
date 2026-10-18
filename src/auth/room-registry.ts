import { eq } from "drizzle-orm";
import type { DatabaseHandle } from "../db/client.js";
import { rooms, type RoomRow, type NewRoomRow } from "../db/schema.js";

export type RoomState = "active" | "disconnected" | "closing" | "closed";

export interface RoomRecord {
  roomId: string;
  ownerClientId: string;
  workspaceId: string;
  state: RoomState;
  createdAt: number;
  closedAt?: number;
}

function rowToRecord(row: RoomRow): RoomRecord {
  return {
    roomId: row.id,
    ownerClientId: row.ownerClientId,
    workspaceId: row.workspaceId,
    state: row.state as RoomState,
    createdAt: new Date(row.createdAt).getTime(),
    closedAt: row.closedAt ? new Date(row.closedAt).getTime() : undefined,
  };
}

function nowISO(): string {
  return new Date().toISOString();
}

export class RoomRegistry {
  private readonly rooms = new Map<string, RoomRecord>();

  constructor(private readonly database?: DatabaseHandle) {
    if (database) {
      this.loadActiveRooms();
    }
  }

  private loadActiveRooms(): void {
    const activeRows = this.database!.db
      .select()
      .from(rooms)
      .where(eq(rooms.state, "active"))
      .all();
    for (const row of activeRows) {
      this.rooms.set(row.id, rowToRecord(row));
    }
  }

  create(ownerClientId: string, workspaceId: string): RoomRecord {
    const roomId = `room_${workspaceId}`;
    const existing = this.get(roomId);
    if (existing && existing.state !== "closed") {
      if (existing.ownerClientId !== ownerClientId) {
        throw new Error(`Forbidden: workspace ${workspaceId} belongs to a different OAuth client`);
      }
      return existing;
    }

    const record: RoomRecord = {
      roomId,
      ownerClientId,
      workspaceId,
      state: "active",
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, record);

    if (this.database) {
      this.database.db
        .insert(rooms)
        .values({
          id: roomId,
          ownerClientId,
          workspaceId,
          state: "active",
          createdAt: nowISO(),
          lastActivityAt: nowISO(),
        })
        .run();
    }

    return record;
  }

  get(roomId: string): RoomRecord | undefined {
    const cached = this.rooms.get(roomId);
    if (cached) return cached;

    if (this.database) {
      const row = this.database.db
        .select()
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .get();
      if (row) {
        const record = rowToRecord(row);
        if (record.state !== "closed") this.rooms.set(roomId, record);
        return record;
      }
    }
    return undefined;
  }

  getByWorkspace(workspaceId: string): RoomRecord | undefined {
    const roomId = `room_${workspaceId}`;
    const record = this.get(roomId);
    return record?.state === "closed" ? undefined : record;
  }

  requireWorkspaceAccess(ownerClientId: string, workspaceId: string): RoomRecord {
    const record = this.getByWorkspace(workspaceId);
    if (!record || record.state !== "active") {
      throw new Error(`Unknown or closed workspace room: ${workspaceId}`);
    }
    if (record.ownerClientId !== ownerClientId) {
      throw new Error(`Forbidden: workspace ${workspaceId} belongs to a different OAuth client`);
    }
    return record;
  }

  closeOwned(ownerClientId: string, workspaceId: string): void {
    const record = this.requireWorkspaceAccess(ownerClientId, workspaceId);
    this.close(record.roomId);
  }

  closeWorkspace(workspaceId: string): boolean {
    const record = this.getByWorkspace(workspaceId);
    if (!record) return false;
    this.close(record.roomId);
    return true;
  }

  close(roomId: string): void {
    const record = this.rooms.get(roomId);
    if (record) {
      record.state = "closed";
      record.closedAt = Date.now();
      this.rooms.delete(roomId);
    }
    if (this.database) {
      this.database.db
        .update(rooms)
        .set({ state: "closed", closedAt: nowISO() })
        .where(eq(rooms.id, roomId))
        .run();
    }
  }

  findByOwner(ownerClientId: string): RoomRecord[] {
    const result: RoomRecord[] = [];
    for (const record of this.rooms.values()) {
      if (record.ownerClientId === ownerClientId) result.push(record);
    }
    return result;
  }

  allRooms(): RoomRecord[] {
    return Array.from(this.rooms.values());
  }
}
