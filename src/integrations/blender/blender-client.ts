import { createConnection, type Socket } from "node:net";

export interface BlenderClientConfig {
  host?: string;
  port?: number;
  timeoutMs?: number;
  longTaskTimeoutMs?: number;
}

export class BlenderClient {
  private static readonly MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  private static activeExecutionPromise: Promise<unknown> = Promise.resolve();
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly longTaskTimeoutMs: number;

  constructor(config: BlenderClientConfig = {}) {
    this.host = config.host || "127.0.0.1";
    this.port = config.port ?? Number(process.env.AUVRYNT_BLENDER_MCP_PORT ?? 9876);
    this.timeoutMs = config.timeoutMs ?? 180000;
    this.longTaskTimeoutMs = config.longTaskTimeoutMs ?? 7200000;

    const normalizedHost = this.host.toLowerCase().replace(/^\[|\]$/g, "");
    if (!["127.0.0.1", "localhost", "::1"].includes(normalizedHost)) {
      throw new Error(`Forbidden host: ${this.host}. Only loopback connection is allowed for Blender MCP.`);
    }
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      throw new Error(`Invalid Blender MCP port: ${this.port}`);
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || !Number.isFinite(this.longTaskTimeoutMs) || this.longTaskTimeoutMs < 1) {
      throw new Error("Blender MCP timeouts must be positive numbers.");
    }
  }

  async sendExecute(code: string, strictJson = true, isLongTask = false): Promise<any> {
    const action = () => this.sendExecuteInternal(code, strictJson, isLongTask);
    const execution = BlenderClient.activeExecutionPromise.then(action, action);
    BlenderClient.activeExecutionPromise = execution.then(() => undefined, () => undefined);
    return execution;
  }

  private async sendExecuteInternal(code: string, strictJson: boolean, isLongTask: boolean): Promise<any> {
    const timeout = isLongTask ? this.longTaskTimeoutMs : this.timeoutMs;
    const request = { type: "execute", code, strict_json: strictJson };
    const payload = Buffer.concat([Buffer.from(JSON.stringify(request), "utf8"), Buffer.from([0])]);
    if (payload.length > 1024 * 1024) throw new Error("Payload size limit exceeded (max 1 MB)");

    return new Promise((resolve, reject) => {
      let client: Socket | null = null;
      let buffer = Buffer.alloc(0);
      let timeoutId: NodeJS.Timeout | null = null;
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (client) {
          client.destroy();
          client = null;
        }
      };

      try {
        client = createConnection({ host: this.host, port: this.port }, () => client?.write(payload));
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error(`Blender connection timed out after ${timeout}ms`));
        }, timeout);
        client.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)]);
          if (buffer.length > BlenderClient.MAX_RESPONSE_BYTES) {
            cleanup();
            reject(new Error("Blender response exceeded the 8 MB limit"));
            return;
          }
          const nullIndex = buffer.indexOf(0);
          if (nullIndex !== -1) {
            const raw = buffer.subarray(0, nullIndex).toString("utf8").trim();
            cleanup();
            try {
              const parsed = JSON.parse(raw);
              if (parsed.status === "ok") {
                if (strictJson && !Object.prototype.hasOwnProperty.call(parsed, "result")) {
                  reject(new Error("Blender execution completed without an explicit result; set result before retrying."));
                  return;
                }
                resolve(Object.prototype.hasOwnProperty.call(parsed, "result") ? parsed.result : {});
              }
              else reject(new Error(parsed.message || "Unknown Blender execution error"));
            } catch (error) {
              reject(new Error(`Failed to parse Blender JSON response: ${error instanceof Error ? error.message : String(error)}`));
            }
          }
        });
        client.on("error", (error) => {
          cleanup();
          reject(new Error(`Blender connection error: ${error.message}`));
        });
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

const activeBlenderClients = new Map<string, BlenderClient>();

export function getBlenderClient(workspaceId: string, config?: BlenderClientConfig): BlenderClient {
  let client = activeBlenderClients.get(workspaceId);
  if (!client) {
    if (activeBlenderClients.size >= 32) throw new Error("Blender client capacity reached (max 32 workspaces).");
    client = new BlenderClient(config);
    activeBlenderClients.set(workspaceId, client);
  }
  return client;
}

export function clearBlenderClients(): void {
  activeBlenderClients.clear();
}
