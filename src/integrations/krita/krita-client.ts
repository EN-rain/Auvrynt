import { discoverKritaBridge, type KritaBridgeDiscovery } from "./krita-discovery.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const LONG_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface KritaHealthResult {
  online: boolean;
  bridge: Omit<KritaBridgeDiscovery, "token">;
  data: unknown;
}

export interface KritaCanvasImage {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  metadata: Record<string, unknown>;
}

export class KritaBridgeClient {
  constructor(private readonly discovery: KritaBridgeDiscovery) {}

  static async connect(env: NodeJS.ProcessEnv = process.env): Promise<KritaBridgeClient> {
    return new KritaBridgeClient(await discoverKritaBridge(env));
  }

  bridgeInfo(): Omit<KritaBridgeDiscovery, "token"> {
    const { token: _token, ...safe } = this.discovery;
    return safe;
  }

  async health(): Promise<KritaHealthResult> {
    const response = await this.fetchJson("/health", { method: "GET" }, 5_000);
    return { online: true, bridge: this.bridgeInfo(), data: response };
  }

  async call(operation: string, args: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    validateOperation(operation);
    const primary = await this.tryCall(
      "/command",
      { operation, args },
      timeoutMs,
    );
    if (!primary.fallback) return normalizeBridgeResult(primary.value);

    const legacy = await this.tryCall(
      "/",
      { action: operation, params: args },
      timeoutMs,
    );
    return normalizeBridgeResult(legacy.value);
  }

  async getCanvas(args: Record<string, unknown> = {}): Promise<KritaCanvasImage> {
    const result = await this.call("get_image", args, LONG_TIMEOUT_MS);
    return extractCanvasImage(result);
  }

  async save(args: Record<string, unknown> = {}): Promise<unknown> {
    return this.call("save_document", args, LONG_TIMEOUT_MS);
  }

  async export(args: Record<string, unknown> = {}): Promise<unknown> {
    return this.call("export_document", args, LONG_TIMEOUT_MS);
  }

  private async tryCall(
    pathname: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ value: unknown; fallback: boolean }> {
    const response = await this.fetchJson(pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, timeoutMs, true);
    if (isFallbackResponse(response)) return { value: response, fallback: true };
    return { value: response, fallback: false };
  }

  private async fetchJson(
    pathname: string,
    init: RequestInit,
    timeoutMs: number,
    allowFallbackStatus = false,
  ): Promise<unknown> {
    const url = new URL(pathname, `${this.discovery.url}/`);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.discovery.token}`);
    headers.set("X-Auvrynt-Token", this.discovery.token);
    headers.set("X-Krita-MCP-Token", this.discovery.token);
    headers.set("X-Auth-Token", this.discovery.token);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach the Krita bridge at ${this.discovery.url}: ${message}`);
    }

    if (allowFallbackStatus && (response.status === 404 || response.status === 405)) {
      return { __auvryntFallback: true, status: response.status };
    }
    if (!response.ok) {
      const body = await readBoundedText(response, 64 * 1024).catch(() => "");
      throw new Error(`Krita bridge HTTP ${response.status}${body ? `: ${body}` : ""}`);
    }

    const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Krita bridge returned invalid JSON.");
    }
  }
}

function isFallbackResponse(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { __auvryntFallback?: unknown }).__auvryntFallback === true);
}

function normalizeBridgeResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    throw new Error(errorMessage(record.error ?? record.message ?? "Krita bridge operation failed."));
  }
  if (record.error !== undefined && record.error !== null && record.error !== false) {
    throw new Error(errorMessage(record.error));
  }
  if ("result" in record) return record.result;
  return value;
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return JSON.stringify(value);
}

function extractCanvasImage(value: unknown): KritaCanvasImage {
  if (typeof value === "string") {
    return decodeCanvasString(value, {});
  }
  if (!value || typeof value !== "object") {
    throw new Error("Krita get_image returned no image payload.");
  }

  const record = value as Record<string, unknown>;
  const candidates = [record.pngBase64, record.imageBase64, record.image, record.data, record.base64];
  const payload = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  if (!payload) throw new Error("Krita get_image response did not contain a supported base64 image field.");

  const metadata: Record<string, unknown> = { ...record };
  delete metadata.pngBase64;
  delete metadata.imageBase64;
  delete metadata.image;
  delete metadata.data;
  delete metadata.base64;
  return decodeCanvasString(payload, metadata);
}

function decodeCanvasString(value: string, metadata: Record<string, unknown>): KritaCanvasImage {
  let base64 = value.trim();
  let mimeType: "image/png" | "image/jpeg" = "image/png";
  const dataUrl = /^data:(image\/(?:png|jpeg));base64,(.+)$/s.exec(base64);
  if (dataUrl) {
    mimeType = dataUrl[1] === "image/jpeg" ? "image/jpeg" : "image/png";
    base64 = dataUrl[2]!;
  } else if (typeof metadata.mimeType === "string" && metadata.mimeType === "image/jpeg") {
    mimeType = "image/jpeg";
  }

  if (base64.length > MAX_RESPONSE_BYTES * 2) throw new Error("Krita image payload exceeds the response safety limit.");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) throw new Error("Krita image payload decoded to an empty buffer.");
  if (buffer.length > MAX_RESPONSE_BYTES) throw new Error("Krita image payload exceeds the response safety limit.");
  return { buffer, mimeType, metadata };
}

function validateOperation(operation: string): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(operation)) {
    throw new Error(`Invalid Krita bridge operation "${operation}".`);
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Krita bridge response exceeds ${maxBytes} bytes.`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Krita bridge response exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}
