export interface McpRequestTimingSample {
  authMs?: number;
  preDispatchMs?: number;
  dispatchMs?: number;
  totalMs: number;
}

export interface TimingPercentiles {
  count: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface McpRequestTimingBucket {
  samples: number;
  authMs?: TimingPercentiles;
  preDispatchMs?: TimingPercentiles;
  dispatchMs?: TimingPercentiles;
  totalMs: TimingPercentiles;
}

export interface McpRequestTimingSnapshot {
  maxSamplesPerKind: number;
  kinds: Record<string, McpRequestTimingBucket>;
}

export interface McpRequestTimingTracker {
  markAuthFinished(): void;
  markDispatchStarted(): void;
  finish(): void;
}

export interface TimingResponseLike {
  once(event: "finish" | "close", listener: () => void): unknown;
}

export function attachMcpRequestTiming(
  response: TimingResponseLike,
  window: McpRequestTimingWindow,
  body: unknown,
  method = "POST",
): McpRequestTimingTracker {
  const startedAt = performance.now();
  const kind = mcpRequestKind(body, method);
  const includeInRpcAggregate = method.toUpperCase() === "POST";
  let authFinishedAt: number | undefined;
  let dispatchStartedAt: number | undefined;
  let recorded = false;
  const finish = () => {
    if (recorded) return;
    recorded = true;
    const finishedAt = performance.now();
    const sample = {
      authMs: authFinishedAt === undefined ? undefined : authFinishedAt - startedAt,
      preDispatchMs: authFinishedAt === undefined || dispatchStartedAt === undefined ? undefined : dispatchStartedAt - authFinishedAt,
      dispatchMs: dispatchStartedAt === undefined ? undefined : finishedAt - dispatchStartedAt,
      totalMs: finishedAt - startedAt,
    };
    if (includeInRpcAggregate) window.record("all", sample);
    if (kind !== "all") window.record(kind, sample);
  };
  response.once("finish", () => setImmediate(finish));
  response.once("close", () => setImmediate(finish));
  return {
    markAuthFinished: () => { authFinishedAt = performance.now(); },
    markDispatchStarted: () => { dispatchStartedAt = performance.now(); },
    finish,
  };
}

export class McpRequestTimingWindow {
  private readonly samples = new Map<string, McpRequestTimingSample[]>();

  constructor(readonly maxSamplesPerKind = 256) {
    if (!Number.isInteger(maxSamplesPerKind) || maxSamplesPerKind < 8 || maxSamplesPerKind > 10_000) {
      throw new Error("maxSamplesPerKind must be an integer between 8 and 10000");
    }
  }

  record(kind: string, sample: McpRequestTimingSample): void {
    const normalizedKind = kind.trim() || "unknown";
    const normalized = normalizeSample(sample);
    const bucket = this.samples.get(normalizedKind) ?? [];
    bucket.push(normalized);
    if (bucket.length > this.maxSamplesPerKind) {
      bucket.splice(0, bucket.length - this.maxSamplesPerKind);
    }
    this.samples.set(normalizedKind, bucket);
  }

  snapshot(): McpRequestTimingSnapshot {
    const kinds: Record<string, McpRequestTimingBucket> = {};
    for (const [kind, samples] of [...this.samples.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const auth = metric(samples, "authMs");
      const preDispatch = metric(samples, "preDispatchMs");
      const dispatch = metric(samples, "dispatchMs");
      kinds[kind] = {
        samples: samples.length,
        ...(auth ? { authMs: auth } : {}),
        ...(preDispatch ? { preDispatchMs: preDispatch } : {}),
        ...(dispatch ? { dispatchMs: dispatch } : {}),
        totalMs: percentiles(samples.map((sample) => sample.totalMs)),
      };
    }
    return { maxSamplesPerKind: this.maxSamplesPerKind, kinds };
  }
}

export function mcpRequestKind(body: unknown, method = "POST"): string {
  if (method.toUpperCase() !== "POST") return `transport:${method.toLowerCase()}`;
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length > 1) return `batch:${messages.length}`;
  const message = messages[0];
  if (!message || typeof message !== "object" || Array.isArray(message)) return "unknown";
  const record = message as Record<string, unknown>;
  if (typeof record.method !== "string" || !record.method) return "unknown";
  if (record.method !== "tools/call") return record.method;
  const params = record.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return "tools/call";
  const name = (params as Record<string, unknown>).name;
  return typeof name === "string" && name ? `tools/call:${name}` : "tools/call";
}

function normalizeSample(sample: McpRequestTimingSample): McpRequestTimingSample {
  return {
    ...(finiteDuration(sample.authMs) !== undefined ? { authMs: finiteDuration(sample.authMs) } : {}),
    ...(finiteDuration(sample.preDispatchMs) !== undefined ? { preDispatchMs: finiteDuration(sample.preDispatchMs) } : {}),
    ...(finiteDuration(sample.dispatchMs) !== undefined ? { dispatchMs: finiteDuration(sample.dispatchMs) } : {}),
    totalMs: finiteDuration(sample.totalMs) ?? 0,
  };
}

function finiteDuration(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100) / 100;
}

function metric(samples: McpRequestTimingSample[], key: "authMs" | "preDispatchMs" | "dispatchMs"): TimingPercentiles | undefined {
  const values = samples.flatMap((sample) => sample[key] === undefined ? [] : [sample[key]!]);
  return values.length > 0 ? percentiles(values) : undefined;
}

function percentiles(values: number[]): TimingPercentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.50),
    p90: percentile(sorted, 0.90),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index]!;
}
