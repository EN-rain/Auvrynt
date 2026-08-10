import assert from "node:assert/strict";
import { RoomRegistry } from "./room-registry.js";

{
  const registry = new RoomRegistry();
  const room = registry.create("owner1", "ws1");

  assert.ok(room.roomId.startsWith("room_"));
  assert.equal(room.ownerClientId, "owner1");
  assert.equal(room.workspaceId, "ws1");
  assert.equal(room.state, "active");
  assert.ok(room.createdAt);
  assert.equal(room.closedAt, undefined);
}

{
  const registry = new RoomRegistry();
  const room = registry.create("owner1", "ws2");

  const found = registry.getByWorkspace("ws2");
  assert.equal(found?.roomId, room.roomId);
}

{
  const registry = new RoomRegistry();
  const room = registry.create("owner1", "ws3");

  const byId = registry.get(room.roomId);
  assert.equal(byId?.roomId, room.roomId);
  assert.equal(registry.get("nonexistent"), undefined);
}

{
  const registry = new RoomRegistry();
  const room = registry.create("owner1", "ws4");
  registry.close(room.roomId);

  assert.equal(room.state, "closed");
  assert.ok(room.closedAt);
  assert.equal(registry.get(room.roomId), undefined);
}

{
  const registry = new RoomRegistry();
  assert.doesNotThrow(() => registry.close("nonexistent-room-id"));
}

{
  const registry = new RoomRegistry();
  const roomA = registry.create("ownerA", "wsA");
  registry.create("ownerB", "wsB");

  registry.close(roomA.roomId);
  assert.equal(registry.get(roomA.roomId), undefined);
  assert.equal(registry.get("room_wsB")?.state, "active");
}

{
  const registry = new RoomRegistry();
  registry.create("owner1", "ws-list");
  registry.create("owner1", "ws-list-2");

  const owned = registry.findByOwner("owner1");
  assert.equal(owned.length, 2);
  assert.ok(owned.every((r) => r.ownerClientId === "owner1"));

  assert.equal(registry.findByOwner("other").length, 0);
}

{
  const registry = new RoomRegistry();
  const r1 = registry.create("owner1", "same-ws");

  assert.throws(
    () => registry.create("owner2", "same-ws"),
    /different OAuth client/,
  );
  assert.equal(registry.requireWorkspaceAccess("owner1", "same-ws").roomId, r1.roomId);
  assert.throws(
    () => registry.requireWorkspaceAccess("owner2", "same-ws"),
    /different OAuth client/,
  );

  registry.closeOwned("owner1", "same-ws");
  assert.throws(
    () => registry.requireWorkspaceAccess("owner1", "same-ws"),
    /Unknown or closed workspace room/,
  );
}

{
  const registry = new RoomRegistry();
  registry.create("owner1", "ws-exists");
  assert.throws(() => registry.closeOwned("owner2", "ws-exists"), /different OAuth client/);
  assert.equal(registry.requireWorkspaceAccess("owner1", "ws-exists").state, "active");
}

{
  const registry = new RoomRegistry();
  registry.create("owner1", "ws-all");
  registry.create("owner2", "ws-all-2");

  const all = registry.allRooms();
  assert.equal(all.length, 2);
}

console.log("Room registry tests passed!");
