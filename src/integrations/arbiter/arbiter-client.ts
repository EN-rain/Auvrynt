export type ArbiterQuestion = {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: Record<string, string> | string[];
};

export interface ArbiterDecisionRequest {
  state: unknown;
  questions: Record<string, ArbiterQuestion>;
  model?: string;
}

export interface ArbiterDecisionResponse {
  model?: string;
  answers: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ArbiterClientOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export type ArbiterClientErrorKind =
  | "unconfigured"
  | "unauthorized"
  | "timeout"
  | "unavailable"
  | "invalid_request"
  | "invalid_response";

export class ArbiterClientError extends Error {
  readonly kind: ArbiterClientErrorKind;
  readonly status?: number;

  constructor(kind: ArbiterClientErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ArbiterClientError";
    this.kind = kind;
    this.status = status;
  }
}

export class ArbiterClient {
  private readonly baseUrl: URL;

  constructor(private readonly options: ArbiterClientOptions) {
    this.baseUrl = parseEndpoint(options.endpoint);
    if (!options.apiKey.trim()) {
      throw new ArbiterClientError("unconfigured", "Arbiter API authentication is not configured.");
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120_000) {
      throw new ArbiterClientError("unconfigured", "Arbiter timeout must be between 250 and 120000 milliseconds.");
    }
  }

  async health(): Promise<Record<string, unknown>> {
    return this.getJson("healthz");
  }

  async ready(): Promise<Record<string, unknown>> {
    return this.getJson("readyz");
  }

  async models(): Promise<Record<string, unknown>> {
    return this.getJson("v1/models");
  }

  async decide(request: ArbiterDecisionRequest): Promise<ArbiterDecisionResponse> {
    if (!request.questions || Object.keys(request.questions).length === 0) {
      throw new ArbiterClientError("invalid_request", "Arbiter requires at least one typed question.");
    }
    const body = {
      state: request.state,
      questions: request.questions,
      model: request.model ?? this.options.model,
    };
    const value = await this.requestJson("v1/systemone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!isRecord(value) || !isRecord(value.answers)) {
      throw new ArbiterClientError("invalid_response", "Arbiter returned an invalid typed-decision response.");
    }
    return value as ArbiterDecisionResponse;
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const value = await this.requestJson(path, { method: "GET" });
    if (!isRecord(value)) throw new ArbiterClientError("invalid_response", "Arbiter returned an invalid status response.");
    return value;
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("authorization", `Bearer ${this.options.apiKey}`);
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new ArbiterClientError("timeout", "Arbiter request timed out.");
      }
      throw new ArbiterClientError("unavailable", "Arbiter could not be reached.");
    }

    if (!response.ok) throw errorForStatus(response.status);
    try {
      return await response.json();
    } catch {
      throw new ArbiterClientError("invalid_response", "Arbiter returned malformed JSON.", response.status);
    }
  }
}

function parseEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ArbiterClientError("unconfigured", "Arbiter endpoint must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ArbiterClientError("unconfigured", "Arbiter endpoint must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ArbiterClientError("unconfigured", "Arbiter endpoint must not contain credentials, query, or fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function errorForStatus(status: number): ArbiterClientError {
  if (status === 401 || status === 403) return new ArbiterClientError("unauthorized", "Arbiter rejected the API credential.", status);
  if (status === 422) return new ArbiterClientError("invalid_request", "Arbiter rejected the typed-decision request.", status);
  if (status === 408 || status === 429 || status === 529 || status >= 500) return new ArbiterClientError("unavailable", `Arbiter is unavailable (HTTP ${status}).`, status);
  return new ArbiterClientError("unavailable", `Arbiter request failed (HTTP ${status}).`, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
