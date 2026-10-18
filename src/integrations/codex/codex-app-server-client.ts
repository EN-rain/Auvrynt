import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import type {
  CodexAppNotification,
  CodexAppServerRequest,
  CodexThreadStartOptions,
  CodexTurnStartOptions,
} from "./codex-types.js";

export type CodexLaunchSource =
  | "explicit"
  | "npm-global-shim"
  | "codex-sandbox-bin"
  | "path";

export interface CodexLaunchResolution {
  executable: string;
  useShell: boolean;
  source: CodexLaunchSource;
}

export interface ResolveCodexLaunchOptions {
  explicitExecutable?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  fileExists?: (path: string) => boolean;
}

export function resolveCodexLaunch(
  options: ResolveCodexLaunchOptions = {},
): CodexLaunchResolution {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const fileExists = options.fileExists ?? existsSync;
  const explicitExecutable =
    options.explicitExecutable?.trim() ||
    environment.AUVRYNT_CODEX_EXECUTABLE?.trim();

  if (explicitExecutable) {
    return {
      executable: explicitExecutable,
      useShell: requiresWindowsShell(platform, explicitExecutable),
      source: "explicit",
    };
  }

  if (platform === "win32") {
    const appData = environment.APPDATA?.trim();
    if (appData) {
      const npmShim = join(appData, "npm", "codex.cmd");
      if (fileExists(npmShim)) {
        return {
          executable: npmShim,
          useShell: true,
          source: "npm-global-shim",
        };
      }
    }

    const sandboxExecutable = join(
      homeDirectory,
      ".codex",
      ".sandbox-bin",
      "codex.exe",
    );
    if (fileExists(sandboxExecutable)) {
      return {
        executable: sandboxExecutable,
        useShell: false,
        source: "codex-sandbox-bin",
      };
    }
  }

  return {
    executable: "codex",
    useShell: platform === "win32",
    source: "path",
  };
}

function requiresWindowsShell(platform: NodeJS.Platform, executable: string): boolean {
  if (platform !== "win32") return false;
  return !/\.(?:exe|com)$/i.test(executable.trim());
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

interface JsonRpcLikeMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  emittedAtMs?: number;
}

export class CodexAppServerClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private lineReader?: ReadLineInterface;
  private readonly pending = new Map<string | number, PendingRequest>();
  private nextRequestId = 1;
  private starting?: Promise<void>;
  private stopped = false;
  private stderrTail = "";

  private readonly executable: string;
  private readonly useShell: boolean;

  constructor(executable?: string) {
    super();
    const launch = resolveCodexLaunch({ explicitExecutable: executable });
    this.executable = launch.executable;
    this.useShell = launch.useShell;
  }

  isRunning(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  async ensureStarted(): Promise<void> {
    if (this.stopped) throw new Error("Codex App Server client is closed");
    if (this.isRunning()) return;
    if (this.starting) return this.starting;

    this.starting = this.startProcess();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  async startThread(options: CodexThreadStartOptions): Promise<Record<string, unknown>> {
    return this.request("thread/start", {
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      ...(options.developerInstructions ? { developerInstructions: options.developerInstructions } : {}),
      approvalPolicy: options.approvalPolicy ?? "on-request",
      sandbox: options.sandbox ?? "workspace-write",
      ephemeral: options.ephemeral ?? false,
    });
  }

  async setThreadName(threadId: string, name: string): Promise<Record<string, unknown>> {
    return this.request("thread/name/set", { threadId, name });
  }

  async startTurn(options: CodexTurnStartOptions): Promise<Record<string, unknown>> {
    return this.request("turn/start", {
      threadId: options.threadId,
      input: [{ type: "text", text: options.task, text_elements: [] }],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
    });
  }

  async steerTurn(threadId: string, turnId: string, instruction: string): Promise<Record<string, unknown>> {
    return this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text: instruction, text_elements: [] }],
    });
  }

  async interruptTurn(threadId: string, turnId: string): Promise<Record<string, unknown>> {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  async readThread(threadId: string, includeTurns = true): Promise<Record<string, unknown>> {
    return this.request("thread/read", { threadId, includeTurns });
  }

  async archiveThread(threadId: string): Promise<Record<string, unknown>> {
    return this.request("thread/archive", { threadId });
  }

  async deleteThread(threadId: string): Promise<Record<string, unknown>> {
    return this.request("thread/delete", { threadId });
  }

  async respondToServerRequest(id: string | number, result: unknown): Promise<void> {
    await this.ensureStarted();
    this.writeLine({ id, result });
  }

  async request<T = Record<string, unknown>>(
    method: string,
    params: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    await this.ensureStarted();
    return this.requestInternal<T>(method, params, timeoutMs);
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.lineReader?.close();
    this.lineReader = undefined;
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      this.child.kill();
    }
    this.child = undefined;
    this.rejectPending(new Error("Codex App Server client closed"));
  }

  private async startProcess(): Promise<void> {
    const child = spawn(this.executable, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: this.useShell,
      env: process.env,
    });
    this.child = child;
    this.stderrTail = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-16_384);
    });

    const lineReader = createInterface({ input: child.stdout });
    this.lineReader = lineReader;
    lineReader.on("line", (line) => this.handleLine(line));

    child.once("error", (error) => this.handleProcessFailure(error));
    child.once("exit", (code, signal) => {
      const suffix = this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : "";
      this.handleProcessFailure(
        new Error(`Codex App Server exited (code=${code ?? "null"}, signal=${signal ?? "none"})${suffix}`),
      );
    });

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });

    await this.requestInternal("initialize", {
      clientInfo: {
        name: "auvrynt",
        title: "Auvrynt Codex Orchestrator",
        version: "1",
      },
      capabilities: null,
    }, 15_000);
  }

  private requestInternal<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMs);
      timeout.unref();
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        this.writeLine({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private writeLine(message: unknown): void {
    if (!this.child || this.child.exitCode !== null || this.child.killed) {
      throw new Error("Codex App Server is not running");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: JsonRpcLikeMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcLikeMessage;
    } catch {
      this.emit("warning", new Error(`Codex App Server emitted non-JSON output: ${trimmed.slice(0, 512)}`));
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(new Error(`Codex App Server error: ${JSON.stringify(message.error)}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.emit("serverRequest", {
        id: message.id,
        method: message.method,
        params: message.params,
      } satisfies CodexAppServerRequest);
      return;
    }

    if (message.method) {
      this.emit("notification", {
        method: message.method,
        params: message.params,
        emittedAtMs: message.emittedAtMs,
      } satisfies CodexAppNotification);
    }
  }

  private handleProcessFailure(error: Error): void {
    this.lineReader?.close();
    this.lineReader = undefined;
    this.child = undefined;
    this.rejectPending(error);
    if (!this.stopped) this.emit("exit", error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
