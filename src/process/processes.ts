import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceRegistry } from "../workspaces.js";

const execFileAsync = promisify(execFile);

const SECRET_KEYWORD_REGEX = /(TOKEN|SECRET|PASSWORD|PASSWD|PWD|KEY|CONNECTION_STRING|DATABASE_URL|AUTH|COOKIE|CREDENTIAL)/i;
const URL_REGEX = /https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/[^\s]*)?/gi;
const MAX_RUNNING_PROCESSES = 24;
const MAX_RUNNING_PROCESSES_PER_WORKSPACE = 8;
const MAX_TRACKED_PROCESSES = 128;
const MAX_LOG_LINES = 1000;
const MAX_LOG_BYTES_PER_STREAM = 512 * 1024;
const MAX_LOG_LINE_CHARS = 16 * 1024;
const MAX_COMMAND_CHARS = 16 * 1024;
const MAX_ENV_OVERRIDES = 64;
const MAX_ENV_VALUE_CHARS = 32 * 1024;

function secretValues(environment?: Record<string, string>): string[] {
  return Object.entries({ ...process.env, ...(environment ?? {}) })
    .filter(([key, value]) => SECRET_KEYWORD_REGEX.test(key) && Boolean(value) && value!.length >= 4)
    .map(([, value]) => value!)
    .sort((a, b) => b.length - a.length);
}

export function redactProcessText(text: string, environment?: Record<string, string>): string {
  let redacted = secretValues(environment).reduce(
    (result, secret) => result.split(secret).join("[REDACTED]"),
    text,
  );
  redacted = redacted.replace(
    /\b(authorization\s*:\s*bearer\s+)[^\s]+/gi,
    "$1[REDACTED]",
  );
  redacted = redacted.replace(
    /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|cookie|credential|database[_-]?url|connection[_-]?string|auth)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&;]+)/gi,
    "$1[REDACTED]",
  );
  redacted = redacted.replace(
    /(--(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|cookie|credential)\s+)("[^"]*"|'[^']*'|[^\s]+)/gi,
    "$1[REDACTED]",
  );
  redacted = redacted.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi,
    "$1[REDACTED]@",
  );
  return redacted;
}

export interface TrackedProcess {
  id: string;
  workspaceId: string;
  ownerClientId?: string;
  command: string;
  workingDirectory: string;
  startTime: string;
  child: ChildProcess;
  pid: number | undefined;
  status: "running" | "exited";
  exitCode?: number;
  stdoutLogs: string[];
  stderrLogs: string[];
  combinedLogs: string[];
  stdoutLogBytes: number;
  stderrLogBytes: number;
  combinedLogBytes: number;
  detectedUrls: Set<string>;
  maxLogLines: number;
}

export interface StartProcessInput {
  workspaceId: string;
  ownerClientId?: string;
  command: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  useShell?: boolean;
}

export interface GetProcessLogsInput {
  workspaceId: string;
  processId: string;
  lines?: number;
  stream?: "stdout" | "stderr" | "both";
  ownerClientId?: string;
}

export interface ListProcessesInput {
  workspaceId: string;
  ownerClientId?: string;
}

export interface StopProcessInput {
  workspaceId: string;
  processId: string;
  force?: boolean;
  ownerClientId?: string;
}

export function sanitizeEnv(env?: Record<string, string>): Record<string, string> {
  if (!env) return {};
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    sanitized[key] = SECRET_KEYWORD_REGEX.test(key) ? "[REDACTED]" : value;
  }
  return sanitized;
}

function validateEnvironment(environment?: Record<string, string>): void {
  if (!environment) return;
  const entries = Object.entries(environment);
  if (entries.length > MAX_ENV_OVERRIDES) {
    throw new Error(`Too many environment overrides (max ${MAX_ENV_OVERRIDES}).`);
  }
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    if (value.length > MAX_ENV_VALUE_CHARS) {
      throw new Error(`Environment variable ${key} exceeds ${MAX_ENV_VALUE_CHARS} characters.`);
    }
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface DirectSpawnCommand {
  executable: string;
  args: string[];
}

function directWindowsCommand(command: string, useShell: boolean | undefined): DirectSpawnCommand | undefined {
  if (process.platform !== "win32" || useShell === true) return undefined;
  if (/%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!/.test(command)) return undefined;
  const tokens = splitSimpleCommandLine(command);
  if (!tokens || tokens.length === 0) return undefined;
  const executable = tokens[0];
  const executableName = executable.replace(/^.*[\\/]/, "").toLowerCase();
  if (executableName === "node" || executableName === "node.exe") {
    return { executable: process.execPath, args: tokens.slice(1) };
  }
  if (executableName === "npm" || executableName === "npm.cmd") {
    const cli = resolveNpmCli("npm-cli.js");
    return cli ? { executable: process.execPath, args: [cli, ...tokens.slice(1)] } : undefined;
  }
  if (executableName === "npx" || executableName === "npx.cmd") {
    const cli = resolveNpmCli("npx-cli.js");
    return cli ? { executable: process.execPath, args: [cli, ...tokens.slice(1)] } : undefined;
  }
  const directExecutables = new Set([
    "bash", "bash.exe", "git", "git.exe", "powershell", "powershell.exe",
    "pwsh", "pwsh.exe", "python", "python.exe", "py", "py.exe",
    "dotnet", "dotnet.exe", "java", "java.exe",
  ]);
  if (!directExecutables.has(executableName) && !executableName.endsWith(".exe")) return undefined;
  return { executable, args: tokens.slice(1) };
}

function resolveNpmCli(fileName: "npm-cli.js" | "npx-cli.js"): string | undefined {
  const candidates = [
    join(dirname(process.execPath), "node_modules", "npm", "bin", fileName),
    ...(process.env.APPDATA
      ? [join(process.env.APPDATA, "npm", "node_modules", "npm", "bin", fileName)]
      : []),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function splitSimpleCommandLine(command: string): string[] | undefined {
  const tokens: string[] = [];
  const trimmed = command.trim();
  let current = "";
  let quote: "'" | '"' | undefined;
  let tokenStarted = false;

  const flush = () => {
    if (!tokenStarted) return;
    tokens.push(current);
    current = "";
    tokenStarted = false;
  };

  for (let index = 0; index < trimmed.length; index++) {
    const character = trimmed[index];
    if (quote === '"' && character === "\\") {
      let slashCount = 1;
      while (trimmed[index + slashCount] === "\\") slashCount++;
      const following = trimmed[index + slashCount];
      if (following === '"') {
        current += "\\".repeat(Math.floor(slashCount / 2));
        tokenStarted = true;
        index += slashCount;
        if (slashCount % 2 === 0) quote = undefined;
        else current += '"';
        continue;
      }
      current += "\\".repeat(slashCount);
      tokenStarted = true;
      index += slashCount - 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      tokenStarted = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    if (character === "&" || character === "|" || character === "<" || character === ">") {
      return undefined;
    }
    current += character;
    tokenStarted = true;
  }

  if (quote) return undefined;
  flush();
  return tokens;
}

export class ProcessManager {
  private readonly processes = new Map<string, TrackedProcess>();

  constructor(private readonly registry: WorkspaceRegistry) {}

  startProcess(input: StartProcessInput): {
    processId: string;
    status: "running" | "exited";
    exitCode?: number;
    detectedUrls: string[];
    recentOutput: string[];
  } {
    const command = input.command.trim();
    if (!command) throw new Error("Process command must not be empty.");
    if (command.length > MAX_COMMAND_CHARS) {
      throw new Error(`Process command exceeds ${MAX_COMMAND_CHARS} characters.`);
    }
    validateEnvironment(input.environment);
    this.pruneHistory();

    const running = Array.from(this.processes.values()).filter((tracked) => tracked.status === "running");
    if (running.length >= MAX_RUNNING_PROCESSES) {
      throw new Error(`Process capacity reached (max ${MAX_RUNNING_PROCESSES} running processes).`);
    }
    const workspaceRunning = running.filter((tracked) => tracked.workspaceId === input.workspaceId).length;
    if (workspaceRunning >= MAX_RUNNING_PROCESSES_PER_WORKSPACE) {
      throw new Error(
        `Workspace process capacity reached (max ${MAX_RUNNING_PROCESSES_PER_WORKSPACE} running processes).`,
      );
    }

    const workspace = this.registry.getWorkspace(input.workspaceId);
    const cwd = this.registry.resolveWorkingDirectory(workspace, input.workingDirectory);
    const processId = `proc_${randomUUID()}`;
    const childEnv = { ...process.env, ...(input.environment ?? {}) };
    const redactionEnvironment = input.environment;
    const directCommand = directWindowsCommand(command, input.useShell);
    const useShell = input.useShell ?? !directCommand;
    const spawnOptions: SpawnOptions = {
      cwd,
      env: childEnv,
      shell: useShell,
      windowsHide: process.platform === "win32",
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    };
    const child: ChildProcess = directCommand
      ? spawn(directCommand.executable, directCommand.args, spawnOptions)
      : spawn(command, spawnOptions);

    const tracked: TrackedProcess = {
      id: processId,
      workspaceId: input.workspaceId,
      ownerClientId: input.ownerClientId,
      command: redactProcessText(command, redactionEnvironment),
      workingDirectory: cwd,
      startTime: new Date().toISOString(),
      child,
      pid: child.pid,
      status: "running",
      stdoutLogs: [],
      stderrLogs: [],
      combinedLogs: [],
      stdoutLogBytes: 0,
      stderrLogBytes: 0,
      combinedLogBytes: 0,
      detectedUrls: new Set<string>(),
      maxLogLines: MAX_LOG_LINES,
    };

    let stdoutBuffer = "";
    let stderrBuffer = "";

    const appendArray = (lines: string[], value: string, byteField: "stdoutLogBytes" | "stderrLogBytes" | "combinedLogBytes") => {
      lines.push(value);
      tracked[byteField] += Buffer.byteLength(value, "utf8");
      while (lines.length > MAX_LOG_LINES || tracked[byteField] > MAX_LOG_BYTES_PER_STREAM) {
        const removed = lines.shift();
        if (removed === undefined) break;
        tracked[byteField] -= Buffer.byteLength(removed, "utf8");
      }
    };

    const appendLog = (line: string, stream: "stdout" | "stderr") => {
      const limited = line.length > MAX_LOG_LINE_CHARS
        ? `${line.slice(0, MAX_LOG_LINE_CHARS)}… [truncated]`
        : line;
      const trimmed = redactProcessText(limited.trimEnd(), redactionEnvironment);
      if (!trimmed) return;

      const matches = trimmed.match(URL_REGEX);
      if (matches) {
        for (const match of matches) tracked.detectedUrls.add(match);
      }

      appendArray(tracked.combinedLogs, `[${stream}] ${trimmed}`, "combinedLogBytes");
      if (stream === "stdout") appendArray(tracked.stdoutLogs, trimmed, "stdoutLogBytes");
      else appendArray(tracked.stderrLogs, trimmed, "stderrLogBytes");
    };

    const consumeChunk = (chunk: Buffer, stream: "stdout" | "stderr") => {
      let buffer = (stream === "stdout" ? stdoutBuffer : stderrBuffer) + chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) appendLog(line, stream);
      if (buffer.length > MAX_LOG_LINE_CHARS * 2) {
        appendLog(buffer.slice(0, MAX_LOG_LINE_CHARS), stream);
        buffer = buffer.slice(MAX_LOG_LINE_CHARS);
      }
      if (stream === "stdout") stdoutBuffer = buffer;
      else stderrBuffer = buffer;
    };

    const flushBuffers = () => {
      if (stdoutBuffer) appendLog(stdoutBuffer, "stdout");
      if (stderrBuffer) appendLog(stderrBuffer, "stderr");
      stdoutBuffer = "";
      stderrBuffer = "";
    };

    child.stdout?.on("data", (data: Buffer) => consumeChunk(data, "stdout"));
    child.stderr?.on("data", (data: Buffer) => consumeChunk(data, "stderr"));

    child.on("exit", (code) => {
      flushBuffers();
      tracked.status = "exited";
      tracked.exitCode = code ?? undefined;
    });

    child.on("error", (err) => {
      appendLog(`Process error: ${err.message}`, "stderr");
      tracked.status = "exited";
      tracked.exitCode = 1;
    });

    this.processes.set(processId, tracked);

    return {
      processId,
      status: tracked.status,
      exitCode: tracked.exitCode,
      detectedUrls: Array.from(tracked.detectedUrls),
      recentOutput: tracked.combinedLogs.slice(-20),
    };
  }

  getProcessLogs(input: GetProcessLogsInput): {
    processId: string;
    lines: string[];
    totalLinesAvailable: number;
  } {
    const tracked = this.getTrackedProcess(input.workspaceId, input.processId, input.ownerClientId);
    const stream = input.stream ?? "both";
    const sourceLogs = stream === "stdout"
      ? tracked.stdoutLogs
      : stream === "stderr"
        ? tracked.stderrLogs
        : tracked.combinedLogs;
    const limit = Math.min(Math.max(input.lines ?? 100, 1), 500);

    return {
      processId: tracked.id,
      lines: sourceLogs.slice(-limit),
      totalLinesAvailable: sourceLogs.length,
    };
  }

  listProcesses(input: ListProcessesInput): Array<{
    processId: string;
    command: string;
    workingDirectory: string;
    startTime: string;
    status: "running" | "exited";
    exitCode?: number;
    detectedUrls: string[];
  }> {
    const list = [] as Array<{
      processId: string;
      command: string;
      workingDirectory: string;
      startTime: string;
      status: "running" | "exited";
      exitCode?: number;
      detectedUrls: string[];
    }>;

    for (const tracked of this.processes.values()) {
      if (tracked.workspaceId !== input.workspaceId) continue;
      if (input.ownerClientId !== undefined && tracked.ownerClientId !== input.ownerClientId) continue;
      list.push({
        processId: tracked.id,
        command: tracked.command,
        workingDirectory: tracked.workingDirectory,
        startTime: tracked.startTime,
        status: tracked.status,
        exitCode: tracked.exitCode,
        detectedUrls: Array.from(tracked.detectedUrls),
      });
    }
    return list;
  }

  async stopProcess(input: StopProcessInput): Promise<{
    processId: string;
    stopped: boolean;
    exitCode?: number;
  }> {
    const tracked = this.getTrackedProcess(input.workspaceId, input.processId, input.ownerClientId);
    if (tracked.status === "exited") {
      return { processId: tracked.id, stopped: true, exitCode: tracked.exitCode };
    }

    const pid = tracked.pid;
    if (!pid) {
      const killed = tracked.child.kill(input.force ? "SIGKILL" : "SIGTERM");
      if (!killed) return { processId: tracked.id, stopped: false, exitCode: tracked.exitCode };
      const exited = await this.waitForExit(tracked, 2000);
      return { processId: tracked.id, stopped: exited, exitCode: tracked.exitCode };
    }

    await this.signalProcessTree(pid, input.force ? "SIGKILL" : "SIGTERM", Boolean(input.force));
    let exited = await this.waitForExit(tracked, input.force ? 2000 : 1500);

    if (!exited && !input.force) {
      await this.signalProcessTree(pid, "SIGKILL", true);
      exited = await this.waitForExit(tracked, 2000);
    }

    if (!exited && !isPidRunning(pid)) {
      tracked.status = "exited";
      exited = true;
    }

    return { processId: tracked.id, stopped: exited, exitCode: tracked.exitCode };
  }

  async stopAllProcesses(): Promise<void> {
    const running = Array.from(this.processes.values()).filter((tracked) => tracked.status === "running");
    const results = await Promise.allSettled(
      running.map((tracked) => this.stopProcess({
        workspaceId: tracked.workspaceId,
        processId: tracked.id,
        force: true,
      })),
    );
    const failures: unknown[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push(result.reason);
        return;
      }
      if (!result.value.stopped) {
        failures.push(new Error(`Process ${running[index]?.id ?? "unknown"} did not stop during shutdown.`));
      }
    });
    if (failures.length > 0) {
      throw new AggregateError(failures, `Failed to stop ${failures.length} process(es) during shutdown.`);
    }
  }

  async stopAllProcessesForWorkspace(workspaceId: string, ownerClientId?: string): Promise<number> {
    const targets = Array.from(this.processes.values()).filter((tracked) => {
      if (tracked.workspaceId !== workspaceId || tracked.status !== "running") return false;
      return ownerClientId === undefined || tracked.ownerClientId === ownerClientId;
    });
    const results = await Promise.allSettled(
      targets.map((tracked) => this.stopProcess({
        workspaceId,
        processId: tracked.id,
        force: false,
      })),
    );
    const failures: unknown[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push(result.reason);
        return;
      }
      if (!result.value.stopped) {
        failures.push(new Error(`Process ${targets[index]?.id ?? "unknown"} did not stop.`));
      }
    });
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to stop ${failures.length} process(es) for workspace ${workspaceId}.`,
      );
    }
    return targets.length;
  }

  runningCount(): number {
    return Array.from(this.processes.values()).filter((p) => p.status === "running").length;
  }

  getTrackedProcess(workspaceId: string, processId: string, ownerClientId?: string): TrackedProcess {
    const tracked = this.processes.get(processId);
    if (!tracked || tracked.workspaceId !== workspaceId) {
      throw new Error(`Process ${processId} not found in workspace ${workspaceId}`);
    }
    if (ownerClientId !== undefined && tracked.ownerClientId !== ownerClientId) {
      throw new Error(`Process ${processId} does not belong to this client`);
    }
    return tracked;
  }

  private pruneHistory(): void {
    if (this.processes.size < MAX_TRACKED_PROCESSES) return;
    const exited = Array.from(this.processes.values())
      .filter((tracked) => tracked.status === "exited")
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
    while (this.processes.size >= MAX_TRACKED_PROCESSES && exited.length > 0) {
      const oldest = exited.shift();
      if (oldest) this.processes.delete(oldest.id);
    }
    if (this.processes.size >= MAX_TRACKED_PROCESSES) {
      throw new Error(`Tracked process capacity reached (max ${MAX_TRACKED_PROCESSES}). Stop existing processes first.`);
    }
  }

  private async waitForExit(tracked: TrackedProcess, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (tracked.status === "exited") return true;
      if (tracked.pid && !isPidRunning(tracked.pid)) {
        tracked.status = "exited";
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return tracked.status === "exited";
  }

  private async signalProcessTree(pid: number, signal: NodeJS.Signals, force: boolean): Promise<void> {
    if (!isPidRunning(pid)) return;

    if (process.platform === "win32") {
      const args = ["/T", "/PID", String(pid)];
      if (force) args.unshift("/F");
      try {
        await execFileAsync("taskkill", args, { windowsHide: true });
      } catch (error) {
        if (!isPidRunning(pid)) return;
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to terminate process tree ${pid}: ${reason}`);
      }
      return;
    }

    try {
      process.kill(-pid, signal);
    } catch (groupError) {
      try {
        process.kill(pid, signal);
      } catch (processError) {
        if (!isPidRunning(pid)) return;
        const reason = processError instanceof Error ? processError.message : String(processError);
        throw new Error(`Failed to signal process ${pid}: ${reason}; group signal error: ${String(groupError)}`);
      }
    }
  }
}
