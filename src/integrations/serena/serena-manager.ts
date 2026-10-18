import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { assertAllowedPath } from "../../workspace/roots.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

const execFileAsync = promisify(execFile);

export interface SerenaConfig {
  enabled: boolean;
  executable: string;
  workingDirectory?: string;
  backend: "LSP" | "JetBrains";
  context: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  idleTimeoutMinutes: number;
  maxInstances: number;
}

export interface SerenaEnvironment {
  installed: boolean;
  executable?: string;
  version?: string;
  installationType?: string;
  uvExecutable?: string;
  pythonVersion?: string;
  initializationState: "ready" | "incomplete" | "missing";
  backend: string;
  actionableProblems: string[];
}

export interface SerenaSession {
  sessionId: string;
  workspaceId: string;
  projectRoot: string;
  processPid: number | null;
  mcpInitialized: boolean;
  activatedProject: string | null;
  exposedTools: string[];
  status: "starting" | "active" | "error" | "stopped";
  createdAt: number;
  lastUsedAt: number;
  lastError?: string;
  client: Client;
  transport: StdioClientTransport;
}

interface SerenaToolEntry {
  auvryntName: string;
  serenaName: string;
  inputSchema: Record<string, unknown>;
  mutating: boolean;
  destructive: boolean;
  enabled: boolean;
}

const SERENA_DEFAULT_EXECUTABLE = "serena";
const SERENA_DEFAULT_BACKEND = "LSP";
const SERENA_DEFAULT_CONTEXT = "desktop-app";
const SERENA_DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const SERENA_DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const SERENA_DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const SERENA_DEFAULT_MAX_INSTANCES = 3;

const READ_ONLY_TOOLS = new Set([
  "get_symbols_overview",
  "find_symbol",
  "find_referencing_symbols",
  "find_implementations",
  "find_declaration",
  "get_diagnostics_for_file",
  "search_for_pattern",
  "get_current_config",
  "onboarding",
  "initial_instructions",
  "list_queryable_projects",
  "query_project",
]);

const CONTROLLED_MUTATION_TOOLS = new Set([
  "replace_symbol_body",
  "insert_before_symbol",
  "insert_after_symbol",
  "rename_symbol",
  "safe_delete_symbol",
]);

const MEMORY_TOOLS = new Set([
  "read_memory",
  "list_memories",
  "delete_memory",
  "rename_memory",
  "edit_memory",
]);

const ALWAYS_DISABLED_TOOLS = new Set([
  "execute_shell_command",
  "open_dashboard",
  "remove_project",
  "create_text_file",
  "replace_content",
  "delete_lines",
  "replace_lines",
  "insert_at_line",
  "read_file",
  "list_dir",
  "find_file",
  "restart_language_server",
]);

const JET_BRAINS_TOOLS_PREFIX = "jet_brains_";

export function defaultSerenaConfig(executable?: string): SerenaConfig {
  return {
    enabled: true,
    executable: executable ?? SERENA_DEFAULT_EXECUTABLE,
    backend: SERENA_DEFAULT_BACKEND,
    context: SERENA_DEFAULT_CONTEXT,
    startupTimeoutMs: SERENA_DEFAULT_STARTUP_TIMEOUT_MS,
    requestTimeoutMs: SERENA_DEFAULT_REQUEST_TIMEOUT_MS,
    idleTimeoutMinutes: SERENA_DEFAULT_IDLE_TIMEOUT_MINUTES,
    maxInstances: SERENA_DEFAULT_MAX_INSTANCES,
  };
}

export async function detectSerenaEnvironment(
  config: SerenaConfig,
): Promise<SerenaEnvironment> {
  const problems: string[] = [];

  if (!config.enabled) {
    return {
      installed: false,
      initializationState: "missing",
      backend: config.backend,
      actionableProblems: ["Serena is disabled in Auvrynt configuration."],
    };
  }

  const executable = config.executable;

  try {
    const { stdout } = await execFileAsync(executable, ["--version"], { timeout: 10_000, windowsHide: true });
    const version = stdout.trim();
    const installationType = executable.includes("uvx") ? "uvx" : "uv-tool";

    let uvExecutable: string | undefined;
    let pythonVersion: string | undefined;

    try {
      const uvResult = await execFileAsync("uv", ["--version"], { timeout: 5_000, windowsHide: true });
      uvExecutable = uvResult.stdout.trim();
    } catch {
      problems.push("uv not found in PATH. Serena requires uv for updates.");
    }

    return {
      installed: true,
      executable,
      version,
      installationType,
      uvExecutable,
      pythonVersion,
      initializationState: "ready",
      backend: config.backend,
      actionableProblems: problems,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    problems.push(`Serena executable not found at "${executable}": ${message}`);
    return {
      installed: false,
      initializationState: "missing",
      backend: config.backend,
      actionableProblems: problems,
    };
  }
}

function buildAllowlist(
  serenaTools: ListToolsResult["tools"],
): SerenaToolEntry[] {
  const entries: SerenaToolEntry[] = [];

  for (const tool of serenaTools) {
    const name = tool.name;

    if (ALWAYS_DISABLED_TOOLS.has(name)) continue;
    if (name.startsWith(JET_BRAINS_TOOLS_PREFIX)) continue;

    const isReadOnly =
      READ_ONLY_TOOLS.has(name) || MEMORY_TOOLS.has(name);
    const isControlledMutation = CONTROLLED_MUTATION_TOOLS.has(name);

    if (!isReadOnly && !isControlledMutation) continue;

    entries.push({
      auvryntName: `serena_${name}`,
      serenaName: name,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      mutating: isControlledMutation,
      destructive: name === "safe_delete_symbol",
      enabled: true,
    });
  }

  return entries;
}

function validatePath(
  workspaceRoot: string,
  candidatePath: string,
): string | null {
  try {
    const absolute = isAbsolute(candidatePath)
      ? candidatePath
      : resolve(workspaceRoot, candidatePath);
    return assertAllowedPath(absolute, [workspaceRoot]);
  } catch {
    return null;
  }
}

function validateRelativePath(
  workspaceRoot: string,
  candidatePath: string,
): string | null {
  const absolute = validatePath(workspaceRoot, candidatePath);
  if (!absolute) return null;
  try {
    const canonicalRoot = assertAllowedPath(workspaceRoot, [workspaceRoot]);
    const result = relative(canonicalRoot, absolute).replace(/\\/g, "/");
    if (result === "") return ".";
    if (result === ".." || result.startsWith("../") || isAbsolute(result)) return null;
    return result;
  } catch {
    return null;
  }
}

function compactArgs(entries: Array<[string, unknown]>): Record<string, unknown> {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      typeof error === "object"
      && error
      && "code" in error
      && (error as { code?: unknown }).code === "EPERM",
    );
  }
}

async function terminateOwnedProcess(pid: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return true;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process may have exited between the liveness check and signal.
  }
  for (let attempt = 0; attempt < 10 && isProcessAlive(pid); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!isProcessAlive(pid)) return true;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Re-check below; ESRCH is success, permission errors remain failures.
  }
  for (let attempt = 0; attempt < 20 && isProcessAlive(pid); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessAlive(pid);
}

export function adaptSerenaToolArguments(
  serenaToolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (serenaToolName) {
    case "find_symbol":
      return compactArgs([
        ["name_path_pattern", args.query],
        ["relative_path", args.filePath],
        ["include_body", args.includeBody],
        ["include_info", args.includeInfo],
        ["max_matches", args.maxResults],
      ]);
    case "find_referencing_symbols":
      return compactArgs([
        ["name_path", args.query],
        ["relative_path", args.filePath],
        ["max_answer_chars", args.maxChars],
      ]);
    case "get_symbols_overview":
      return compactArgs([
        ["relative_path", args.filePath],
        ["depth", args.depth],
        ["max_answer_chars", args.maxChars],
      ]);
    case "search_for_pattern":
      return compactArgs([
        ["substring_pattern", args.pattern],
        ["relative_path", args.path],
        ["paths_include_glob", args.filePattern],
        ["context_lines_before", args.contextLinesBefore],
        ["context_lines_after", args.contextLinesAfter],
        ["restrict_search_to_code_files", args.codeOnly],
        ["max_answer_chars", args.maxChars],
      ]);
    case "find_implementations":
      return compactArgs([
        ["name_path", args.query],
        ["relative_path", args.filePath],
        ["include_info", args.includeInfo],
        ["max_answer_chars", args.maxChars],
      ]);
    case "find_declaration":
      return compactArgs([
        ["relative_path", args.filePath],
        ["regex", args.regex],
        ["containing_symbol_name_path", args.containingSymbol],
        ["include_body", args.includeBody],
        ["include_info", args.includeInfo],
      ]);
    case "get_diagnostics_for_file":
      return compactArgs([
        ["relative_path", args.filePath],
        ["start_line", args.startLine],
        ["end_line", args.endLine],
        ["min_severity", args.minSeverity],
        ["max_answer_chars", args.maxChars],
      ]);
    case "replace_symbol_body":
      return compactArgs([
        ["name_path", args.symbol],
        ["relative_path", args.filePath],
        ["body", args.newBody],
      ]);
    case "insert_before_symbol":
    case "insert_after_symbol":
      return compactArgs([
        ["name_path", args.symbol],
        ["relative_path", args.filePath],
        ["body", args.content],
      ]);
    case "rename_symbol":
      return compactArgs([
        ["name_path", args.symbol],
        ["relative_path", args.filePath],
        ["new_name", args.newName],
      ]);
    case "safe_delete_symbol":
      return compactArgs([
        ["name_path_pattern", args.symbol],
        ["relative_path", args.filePath],
      ]);
    case "read_memory":
      return compactArgs([["memory_name", args.name]]);
    case "list_memories":
      return compactArgs([["topic", args.topic]]);
    default:
      return { ...args };
  }
}

function buildTransportArgs(config: SerenaConfig, projectRoot?: string): string[] {
  const args = ["start-mcp-server", "--transport", "stdio"];

  if (projectRoot) {
    args.push("--project", projectRoot);
  }

  if (config.backend) {
    args.push("--language-backend", config.backend);
  }

  args.push("--context", config.context);
  args.push("--enable-web-dashboard", "false");
  args.push("--open-web-dashboard", "false");
  args.push("--log-level", "ERROR");

  return args;
}

export class SerenaManager {
  private config: SerenaConfig;
  private sessions = new Map<string, SerenaSession>();
  private environmentCache: SerenaEnvironment | null = null;
  private environmentCachedAt = 0;
  private environmentInFlight: Promise<SerenaEnvironment> | null = null;
  private environmentGeneration = 0;
  private workspaceOperationTails = new Map<string, Promise<void>>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SerenaConfig) {
    this.config = config;
  }

  updateConfig(config: SerenaConfig): void {
    this.config = config;
    this.environmentCache = null;
    this.environmentInFlight = null;
    this.environmentGeneration += 1;
  }

  getConfig(): SerenaConfig {
    return { ...this.config };
  }

  async getEnvironment(): Promise<SerenaEnvironment> {
    const now = Date.now();
    if (this.environmentCache && now - this.environmentCachedAt < 30_000) {
      return this.environmentCache;
    }

    const generation = this.environmentGeneration;
    const inFlight = this.environmentInFlight ??= detectSerenaEnvironment({ ...this.config });
    try {
      const environment = await inFlight;
      if (generation === this.environmentGeneration && this.environmentInFlight === inFlight) {
        this.environmentCache = environment;
        this.environmentCachedAt = Date.now();
      }
      return environment;
    } finally {
      if (this.environmentInFlight === inFlight) this.environmentInFlight = null;
    }
  }

  clearEnvironmentCache(): void {
    this.environmentCache = null;
    this.environmentGeneration += 1;
  }

  async startSession(
    workspaceId: string,
    projectRoot: string,
  ): Promise<SerenaSession> {
    return this.runWorkspaceOperation(
      workspaceId,
      () => this.startSessionUnlocked(workspaceId, projectRoot),
    );
  }

  private async startSessionUnlocked(
    workspaceId: string,
    projectRoot: string,
  ): Promise<SerenaSession> {
    const env = await this.getEnvironment();
    if (!env.installed) {
      throw new Error(
        `Serena is not available. ${env.actionableProblems.join(" ")}`,
      );
    }

    if (!this.config.enabled) {
      throw new Error("Serena is disabled in Auvrynt configuration.");
    }

    for (const session of this.sessions.values()) {
      if (
        session.workspaceId === workspaceId &&
        session.status === "active"
      ) {
        if (session.projectRoot === projectRoot) {
          session.lastUsedAt = Date.now();
          return session;
        }
        await this.stopSession(session.sessionId);
      }
    }

    const activeCount = Array.from(this.sessions.values()).filter(
      (s) => s.status === "active" || s.status === "starting",
    ).length;
    if (activeCount >= this.config.maxInstances) {
      throw new Error(
        `Maximum Serena instances reached (${this.config.maxInstances}). Stop an existing session first.`,
      );
    }

    const sessionId = `serena_${randomUUID()}`;
    const args = buildTransportArgs(this.config, projectRoot);
    const transport = new StdioClientTransport({
      command: this.config.executable,
      args,
      stderr: "ignore",
    });

    const client = new Client(
      { name: "auvrynt-serena-bridge", version: "1.0.0" },
      { capabilities: {} },
    );

    const session: SerenaSession = {
      sessionId,
      workspaceId,
      projectRoot,
      processPid: null,
      mcpInitialized: false,
      activatedProject: null,
      exposedTools: [],
      status: "starting",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      client,
      transport,
    };

    this.sessions.set(sessionId, session);

    try {
      await withTimeout(
        client.connect(transport),
        this.config.startupTimeoutMs,
        `Serena MCP startup timed out after ${this.config.startupTimeoutMs} ms.`,
      );

      session.processPid = transport.pid;
      session.mcpInitialized = true;

      const toolsResult = await withTimeout(
        client.listTools(),
        this.config.startupTimeoutMs,
        `Serena tool discovery timed out after ${this.config.startupTimeoutMs} ms.`,
      );
      const allTools = toolsResult.tools ?? [];
      session.exposedTools = allTools.map((t) => t.name);

      if (allTools.length > 0) {
        try {
          await client.callTool(
            {
              name: "activate_project",
              arguments: { path: projectRoot },
            },
            undefined,
            { timeout: this.config.startupTimeoutMs },
          );
          session.activatedProject = projectRoot;
        } catch {
          session.activatedProject = null;
        }
      }

      session.status = "active";
      session.lastUsedAt = Date.now();

      this.startIdleTimer();

      return session;
    } catch (err) {
      session.status = "error";
      session.lastError = err instanceof Error ? err.message : String(err);
      try {
        await this.cleanupSession(session);
        this.sessions.delete(sessionId);
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        session.lastError = `${session.lastError} Cleanup failed: ${cleanupMessage}`;
      }
      throw new Error(
        `Failed to start Serena session: ${session.lastError}`,
      );
    }
  }

  getSession(sessionId: string): SerenaSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown Serena session: ${sessionId}`);
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  getSessionByWorkspace(workspaceId: string): SerenaSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && session.status === "active") {
        session.lastUsedAt = Date.now();
        return session;
      }
    }
    return undefined;
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "stopped";
    try {
      await this.cleanupSession(session);
      this.sessions.delete(sessionId);
    } catch (error) {
      session.status = "error";
      session.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (this.sessions.size === 0) {
        this.stopIdleTimer();
      }
    }
  }

  async stopWorkspaceSessions(workspaceId: string): Promise<void> {
    const toStop: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.workspaceId === workspaceId) {
        toStop.push(id);
      }
    }
    const results = await Promise.allSettled(toStop.map((id) => this.stopSession(id)));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, `Failed to stop ${failures.length} Serena session(s) for workspace ${workspaceId}.`);
    }
  }

  async stopAllSessions(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    const results = await Promise.allSettled(ids.map((id) => this.stopSession(id)));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, `Failed to stop ${failures.length} Serena session(s).`);
    }
  }

  async healthCheck(workspaceId: string): Promise<{
    alive: boolean;
    initialized: boolean;
    projectActive: boolean;
    toolCount: number;
    latencyMs?: number;
    status: string;
    error?: string;
  }> {
    const session = this.getSessionByWorkspace(workspaceId);
    if (!session) {
      return {
        alive: false,
        initialized: false,
        projectActive: false,
        toolCount: 0,
        status: "no_session",
      };
    }

    try {
      const start = Date.now();
      await withTimeout(
        session.client.ping(),
        this.config.requestTimeoutMs,
        `Serena health check timed out after ${this.config.requestTimeoutMs} ms.`,
      );
      const latencyMs = Date.now() - start;

      return {
        alive: session.status === "active",
        initialized: session.mcpInitialized,
        projectActive: session.activatedProject !== null,
        toolCount: session.exposedTools.length,
        latencyMs,
        status: session.status,
      };
    } catch (err) {
      return {
        alive: false,
        initialized: session.mcpInitialized,
        projectActive: false,
        toolCount: session.exposedTools.length,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async callTool(
    workspaceId: string,
    serenaToolName: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<unknown> {
    const session = this.getSessionByWorkspace(workspaceId);
    if (!session) {
      throw new Error(
        `No active Serena session for workspace ${workspaceId}. Call serena_start_session first.`,
      );
    }

    if (!session.exposedTools.includes(serenaToolName)) {
      throw new Error(
        `Serena tool "${serenaToolName}" is not available in the current session.`,
      );
    }

    const validatedArgs = adaptSerenaToolArguments(serenaToolName, args);

    if (validatedArgs.path && typeof validatedArgs.path === "string") {
      const validated = validatePath(workspaceRoot, validatedArgs.path);
      if (!validated) {
        throw new Error(
          `Path "${validatedArgs.path}" is outside the workspace root or invalid.`,
        );
      }
      validatedArgs.path = validated;
    }

    if (validatedArgs.file_path && typeof validatedArgs.file_path === "string") {
      const validated = validatePath(workspaceRoot, validatedArgs.file_path);
      if (!validated) {
        throw new Error(
          `Path "${validatedArgs.file_path}" is outside the workspace root or invalid.`,
        );
      }
      validatedArgs.file_path = validated;
    }

    if (validatedArgs.relative_path && typeof validatedArgs.relative_path === "string") {
      const validated = validateRelativePath(workspaceRoot, validatedArgs.relative_path);
      if (!validated) {
        throw new Error(
          `Path "${validatedArgs.relative_path}" is outside the workspace root or invalid.`,
        );
      }
      validatedArgs.relative_path = validated;
    }

    const timeout = this.config.requestTimeoutMs;
    const result = await session.client.callTool(
      { name: serenaToolName, arguments: validatedArgs },
      undefined,
      { timeout },
    );

    return result;
  }

  getSessionInfo(): Array<{
    sessionId: string;
    workspaceId: string;
    projectRoot: string;
    status: string;
    toolCount: number;
    activatedProject: string | null;
    createdAt: number;
    lastUsedAt: number;
    lastError?: string;
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      workspaceId: s.workspaceId,
      projectRoot: s.projectRoot,
      status: s.status,
      toolCount: s.exposedTools.length,
      activatedProject: s.activatedProject,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      lastError: s.lastError,
    }));
  }

  private async runWorkspaceOperation<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.workspaceOperationTails.get(workspaceId) ?? Promise.resolve();
    const waitForPrevious = previous.catch(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = waitForPrevious.then(() => gate);
    this.workspaceOperationTails.set(workspaceId, tail);

    await waitForPrevious;
    try {
      return await operation();
    } finally {
      release();
      if (this.workspaceOperationTails.get(workspaceId) === tail) {
        this.workspaceOperationTails.delete(workspaceId);
      }
    }
  }

  private async cleanupSession(session: SerenaSession): Promise<void> {
    await Promise.allSettled([
      Promise.resolve().then(() => session.client.close()),
      Promise.resolve().then(() => session.transport.close()),
    ]);
    const pid = session.processPid;
    if (!pid) return;
    if (!(await terminateOwnedProcess(pid))) {
      throw new Error(`Serena child process ${pid} remained alive after client/transport shutdown and forced termination.`);
    }
    session.processPid = null;
  }

  private startIdleTimer(): void {
    if (this.idleTimer) return;
    const intervalMs = Math.min(this.config.idleTimeoutMinutes * 60 * 1000, 60_000);
    this.idleTimer = setInterval(() => {
      this.cleanIdleSessions();
    }, intervalMs);
  }

  private stopIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private cleanIdleSessions(): void {
    const now = Date.now();
    const idleThreshold = this.config.idleTimeoutMinutes * 60 * 1000;

    for (const [id, session] of this.sessions) {
      if (session.status === "active" && now - session.lastUsedAt > idleThreshold) {
        this.stopSession(id);
      }
    }
  }
}
