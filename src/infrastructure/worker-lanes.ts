export interface WorkerLaneLease {
  leaseId: string;
  workerId: string;
  taskKey: string;
  acquiredAt: string;
  updatedAt: string;
}

export interface WorkerLaneSnapshot {
  workerId: string;
  busy: boolean;
  taskKey?: string;
  acquiredAt?: string;
}

export interface WorkerLanePoolSnapshot {
  capacity: number;
  active: number;
  available: number;
  elastic: true;
  lanes: WorkerLaneSnapshot[];
}

export class WorkerLanePool {
  private readonly lanes = new Map<string, WorkerLaneLease | undefined>();
  private nextLease = 1;
  private nextWorkerIndex = 1;

  constructor(initialCapacity = 4) {
    if (!Number.isInteger(initialCapacity) || initialCapacity < 0) {
      throw new Error("Initial worker lane capacity must be a non-negative integer");
    }
    this.growBy(initialCapacity);
  }

  reserve(taskKey: string): WorkerLaneLease {
    return this.reserveMany([taskKey])[0]!;
  }

  reserveMany(taskKeys: string[]): WorkerLaneLease[] {
    if (taskKeys.length === 0) return [];
    const normalized = taskKeys.map(normalizeTaskKey);
    if (new Set(normalized).size !== normalized.length) {
      throw new Error("Worker lane task keys must be unique within a reservation batch");
    }
    for (const taskKey of normalized) {
      if (this.leaseForTask(taskKey)) throw new Error(`Worker lane task is already reserved: ${taskKey}`);
    }
    const free = [...this.lanes.entries()].filter(([, lease]) => lease === undefined).map(([workerId]) => workerId);
    if (free.length < normalized.length) {
      this.growBy(normalized.length - free.length);
      free.push(
        ...[...this.lanes.entries()]
          .filter(([workerId, lease]) => lease === undefined && !free.includes(workerId))
          .map(([workerId]) => workerId),
      );
    }
    const now = new Date().toISOString();
    const leases = normalized.map((taskKey, index) => ({
      leaseId: `lane_${this.nextLease++}`,
      workerId: free[index]!,
      taskKey,
      acquiredAt: now,
      updatedAt: now,
    }));
    for (const lease of leases) this.lanes.set(lease.workerId, lease);
    return leases.map((lease) => ({ ...lease }));
  }

  restore(workerId: string, taskKey: string): WorkerLaneLease {
    const id = workerId.trim();
    const key = normalizeTaskKey(taskKey);
    if (!this.lanes.has(id)) this.ensureRestorableWorkerId(id);
    if (this.lanes.get(id)) throw new Error(`Worker lane ${id} is already occupied`);
    if (this.leaseForTask(key)) throw new Error(`Worker lane task is already reserved: ${key}`);
    const now = new Date().toISOString();
    const lease = { leaseId: `lane_${this.nextLease++}`, workerId: id, taskKey: key, acquiredAt: now, updatedAt: now };
    this.lanes.set(id, lease);
    return { ...lease };
  }

  rebind(leaseId: string, taskKey: string): WorkerLaneLease {
    const found = this.findByLease(leaseId);
    if (!found) throw new Error("Worker lane lease not found");
    const key = normalizeTaskKey(taskKey);
    const existing = this.leaseForTask(key);
    if (existing && existing.leaseId !== leaseId) throw new Error(`Worker lane task is already reserved: ${key}`);
    const updated = { ...found, taskKey: key, updatedAt: new Date().toISOString() };
    this.lanes.set(updated.workerId, updated);
    return { ...updated };
  }

  release(leaseId: string): boolean {
    const found = this.findByLease(leaseId);
    if (!found) return false;
    this.lanes.set(found.workerId, undefined);
    return true;
  }

  releaseByTask(taskKey: string): boolean {
    const lease = this.leaseForTask(taskKey);
    if (!lease) return false;
    this.lanes.set(lease.workerId, undefined);
    return true;
  }

  leaseForTask(taskKey: string): WorkerLaneLease | undefined {
    const key = normalizeTaskKey(taskKey);
    for (const lease of this.lanes.values()) {
      if (lease?.taskKey === key) return { ...lease };
    }
    return undefined;
  }

  availableCount(): number {
    return [...this.lanes.values()].filter((lease) => lease === undefined).length;
  }

  snapshot(): WorkerLanePoolSnapshot {
    const lanes = [...this.lanes.entries()].map(([workerId, lease]) => lease
      ? { workerId, busy: true, taskKey: lease.taskKey, acquiredAt: lease.acquiredAt }
      : { workerId, busy: false });
    const active = lanes.filter((lane) => lane.busy).length;
    return {
      capacity: this.lanes.size,
      active,
      available: this.lanes.size - active,
      elastic: true,
      lanes,
    };
  }

  private findByLease(leaseId: string): WorkerLaneLease | undefined {
    for (const lease of this.lanes.values()) {
      if (lease?.leaseId === leaseId) return lease;
    }
    return undefined;
  }

  private growBy(count: number): void {
    for (let index = 0; index < count; index++) {
      const workerId = `W${this.nextWorkerIndex++}`;
      this.lanes.set(workerId, undefined);
    }
  }

  private ensureRestorableWorkerId(workerId: string): void {
    const match = /^W([1-9]\d*)$/.exec(workerId);
    if (!match) throw new Error(`Unknown worker lane: ${workerId}`);
    const workerIndex = Number(match[1]);
    if (!Number.isSafeInteger(workerIndex)) throw new Error(`Unknown worker lane: ${workerId}`);
    this.lanes.set(workerId, undefined);
    this.nextWorkerIndex = Math.max(this.nextWorkerIndex, workerIndex + 1);
  }
}

function normalizeTaskKey(taskKey: string): string {
  const normalized = taskKey.trim();
  if (!normalized || normalized.length > 512) throw new Error("Worker lane task key must be between 1 and 512 characters");
  return normalized;
}
