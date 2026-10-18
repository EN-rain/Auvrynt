import type { JobSourceAdapter } from "./types.js";
import { facebookSource } from "./facebook/facebook-source.js";
import { manualSource } from "./manual/manual-source.js";

export class JobSourceRegistry {
  private readonly adapters = new Map<string, JobSourceAdapter>();

  constructor(adapters: JobSourceAdapter[] = [manualSource, facebookSource]) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: JobSourceAdapter): void {
    if (!/^[a-z][a-z0-9_-]*$/.test(adapter.id)) throw new Error("Invalid job source id.");
    if (this.adapters.has(adapter.id)) throw new Error(`Job source already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): JobSourceAdapter | undefined { return this.adapters.get(id); }
  list(): JobSourceAdapter[] { return [...this.adapters.values()]; }
}

export function createJobSourceRegistry(): JobSourceRegistry {
  return new JobSourceRegistry();
}
