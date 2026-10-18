import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname, relative, basename } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { getBridgeClient } from "./godot-editor-bridge.js";

const execFileAsync = promisify(execFile);

export interface EnvironmentProblem {
  code: string;
  message: string;
  suggestedFix?: string;
}

export interface GodotGdscriptEnvironmentResult {
  godotExecutable?: string;
  godotVersion?: string;
  editorBridgeConnected: boolean;
  usesGdscript: boolean;
  usesCsharp: boolean;
  mixedLanguage: boolean;
  problems: EnvironmentProblem[];
}

export async function inspectGodotGdscriptEnvironment(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath?: string },
): Promise<GodotGdscriptEnvironmentResult> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const root = registry.resolvePath(workspace, input.projectPath ?? ".");
  const problems: EnvironmentProblem[] = [];
  let godotExecutable = process.env.GODOT_EXECUTABLE || "godot";
  let godotVersion = "";

  try {
    const { stdout } = await execFileAsync(godotExecutable, ["--version"], { windowsHide: true });
    godotVersion = stdout.trim();
  } catch {
    godotExecutable = "";
    problems.push({
      code: "GODOT_NOT_FOUND",
      message: "Godot executable not found. Make sure 'godot' is in your PATH or set GODOT_EXECUTABLE.",
      suggestedFix: "Set GODOT_EXECUTABLE environment variable.",
    });
  }

  let usesGdscript = false;
  let usesCsharp = false;
  try {
    const files = await scanWorkspaceDir(root);
    usesGdscript = files.some((file) => file.endsWith(".gd"));
    usesCsharp = files.some((file) => file.endsWith(".cs"));
  } catch {}

  return {
    godotExecutable: godotExecutable || undefined,
    godotVersion: godotVersion || undefined,
    editorBridgeConnected: getBridgeClient(input.workspaceId).status,
    usesGdscript,
    usesCsharp,
    mixedLanguage: usesGdscript && usesCsharp,
    problems,
  };
}

async function scanWorkspaceDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function scan(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if ([".godot", "bin", "obj", ".git"].includes(entry.name)) continue;
      if (entry.isDirectory()) await scan(full);
      else if (entry.isFile()) results.push(full);
    }
  }
  await scan(dir);
  return results;
}

export interface GdscriptDiagnostic {
  code?: string;
  message: string;
  path: string;
  line?: number;
  column?: number;
  category: "parser" | "type" | "warning" | "runtime" | "annotation" | "class" | "signal";
}

export interface GdscriptDiagnosticsResult {
  errors: GdscriptDiagnostic[];
  warnings: GdscriptDiagnostic[];
}

export async function getGdscriptDiagnostics(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string; scriptPath?: string; includeWarnings?: boolean },
): Promise<GdscriptDiagnosticsResult> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectRoot = registry.resolvePath(workspace, input.projectPath);
  const errors: GdscriptDiagnostic[] = [];
  const warnings: GdscriptDiagnostic[] = [];
  const scriptFiles = input.scriptPath
    ? [registry.resolvePath(workspace, input.scriptPath)]
    : (await scanWorkspaceDir(projectRoot)).filter((file) => file.endsWith(".gd"));

  for (const script of scriptFiles) {
    const relPath = relative(workspace.root, script);
    try {
      const content = await readFile(script, "utf8");
      const lines = content.split(/\r?\n/);
      let insideMultilineComment = false;
      for (let index = 0; index < lines.length; index++) {
        const rawLine = lines[index];
        const line = rawLine.trim();
        const lineNum = index + 1;
        if (line.startsWith('"""')) {
          insideMultilineComment = !insideMultilineComment;
          continue;
        }
        if (insideMultilineComment || line.startsWith("#") || !line) continue;
        if (rawLine.startsWith(" ") && rawLine.startsWith("\t")) {
          errors.push({ code: "MIXED_INDENTATION", message: "Mixed tabs and spaces in indentation.", path: relPath, line: lineNum, category: "parser" });
        }
        if (line.includes("yield(")) {
          errors.push({ code: "DEPRECATED_YIELD", message: "Use of deprecated yield(). Use 'await' in Godot 4.", path: relPath, line: lineNum, category: "parser" });
        }
        if (line.startsWith("export var ")) {
          errors.push({ code: "DEPRECATED_EXPORT", message: "Use of deprecated 'export var'. Use '@export var' or '@export' in Godot 4.", path: relPath, line: lineNum, category: "annotation" });
        }
        if (line.startsWith("onready var ")) {
          errors.push({ code: "DEPRECATED_ONREADY", message: "Use of deprecated 'onready var'. Use '@onready var' in Godot 4.", path: relPath, line: lineNum, category: "annotation" });
        }
        const annotationMatch = line.match(/^@(\w+)/);
        if (annotationMatch) {
          const valid = ["export", "onready", "tool", "icon", "warning_ignore", "rpc", "export_range", "export_enum", "export_file", "export_dir", "export_multiline", "export_color_no_alpha", "export_node_path", "export_placeholder", "export_group", "export_subgroup", "export_category"];
          if (!valid.includes(annotationMatch[1])) {
            warnings.push({ code: "UNKNOWN_ANNOTATION", message: `Unknown or invalid annotation: @${annotationMatch[1]}`, path: relPath, line: lineNum, category: "annotation" });
          }
        }
      }
    } catch (error: any) {
      errors.push({ message: `Failed to read/parse script file: ${error.message}`, path: relPath, category: "parser" });
    }
  }

  try {
    const godotExecutable = process.env.GODOT_EXECUTABLE || "godot";
    const { stderr } = await execFileAsync(godotExecutable, ["--headless", "--path", projectRoot, "--validate-scripts"], { timeout: 3000, windowsHide: true });
    for (const line of stderr.toString().split("\n")) {
      if (line.includes("ERROR:") || line.includes("SCRIPT ERROR:")) {
        errors.push({ message: line.trim(), path: input.scriptPath || "project", category: "parser" });
      }
    }
  } catch {}
  return { errors, warnings };
}

export interface InspectGdscriptResult {
  extendsType?: string;
  className?: string;
  toolScript: boolean;
  signals: Array<{ name: string; parameters: Array<{ name: string; type?: string }> }>;
  exports: Array<{ name: string; type?: string; defaultValue?: unknown; annotation?: string }>;
  methods: Array<{ name: string; parameters: string[]; returnType?: string; static: boolean; line: number }>;
  nodePathReferences: Array<{ path: string; line: number }>;
  preloadDependencies: Array<{ path: string; line: number }>;
}

export async function inspectGdscript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<InspectGdscriptResult> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const content = await readFile(registry.resolvePath(workspace, input.scriptPath), "utf8");
  const lines = content.split(/\r?\n/);
  let extendsType: string | undefined;
  let className: string | undefined;
  let toolScript = false;
  const signals: InspectGdscriptResult["signals"] = [];
  const exports: InspectGdscriptResult["exports"] = [];
  const methods: InspectGdscriptResult["methods"] = [];
  const nodePathReferences: InspectGdscriptResult["nodePathReferences"] = [];
  const preloadDependencies: InspectGdscriptResult["preloadDependencies"] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const lineNum = index + 1;
    if (line.startsWith("extends ")) extendsType = line.substring(8).trim();
    else if (line.startsWith("class_name ")) className = line.substring(11).trim();
    else if (line.startsWith("@tool")) toolScript = true;
    else if (line.startsWith("signal ")) {
      const match = line.match(/^signal\s+(\w+)(?:\((.*?)\))?/);
      if (match) {
        const parameters = (match[2] || "").split(",").map((parameter) => {
          const parts = parameter.trim().split(":");
          return { name: parts[0].trim(), type: parts[1]?.trim() };
        }).filter((parameter) => parameter.name);
        signals.push({ name: match[1], parameters });
      }
    } else if (line.startsWith("@export") || line.startsWith("export ")) {
      const nameMatch = line.match(/(?:var\s+)?(\w+)\s*(?::|=)/) || line.match(/var\s+(\w+)/);
      if (nameMatch) {
        const typeMatch = line.match(/:([^\s=]+)/);
        const valueMatch = line.match(/=\s*(.+)$/);
        const annotationMatch = line.match(/^@export\w*/);
        exports.push({ name: nameMatch[1], type: typeMatch?.[1].trim(), defaultValue: valueMatch?.[1].trim(), annotation: annotationMatch?.[0] });
      }
    } else if (line.startsWith("func ") || line.startsWith("static func ")) {
      const match = line.match(/func\s+(\w+)\s*\((.*?)\)(?:\s*->\s*([^\s:]+))?/);
      if (match) methods.push({ name: match[1], parameters: match[2].split(",").map((value) => value.trim()).filter(Boolean), returnType: match[3], static: line.startsWith("static "), line: lineNum });
    }
    for (const match of line.match(/\$(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_\/]+))/g) ?? []) nodePathReferences.push({ path: match, line: lineNum });
    for (const match of line.match(/(?:preload|load)\((?:"([^"]+)"|'([^']+)')\)/g) ?? []) preloadDependencies.push({ path: match, line: lineNum });
  }
  return { extendsType, className, toolScript, signals, exports, methods, nodePathReferences, preloadDependencies };
}

export interface CreateGdscriptInput {
  workspaceId: string;
  outputPath: string;
  baseType: string;
  className?: string;
  toolScript?: boolean;
  template?: "empty" | "node" | "resource" | "editor_plugin";
}

export async function createGdscript(registry: WorkspaceRegistry, input: CreateGdscriptInput): Promise<{ path: string; created: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.outputPath);
  if (existsSync(absolutePath)) throw new Error(`File already exists: ${input.outputPath}`);
  await mkdir(dirname(absolutePath), { recursive: true });
  const lines: string[] = [];
  if (input.toolScript) lines.push("@tool");
  if (input.className) lines.push(`class_name ${input.className}`);
  lines.push(`extends ${input.baseType}`, "");
  if (input.template === "node") lines.push("func _ready() -> void:", "\tpass", "", "func _process(delta: float) -> void:", "\tpass");
  else if (input.template === "editor_plugin") lines.push("func _enter_tree() -> void:", "\tpass", "", "func _exit_tree() -> void:", "\tpass");
  await writeFile(absolutePath, lines.join("\n"), "utf8");
  return { path: input.outputPath, created: true };
}

export interface AttachGdscriptInput {
  workspaceId: string;
  nodePath: string;
  scriptPath: string;
  createIfMissing?: boolean;
  baseType?: string;
}

export async function attachGdscript(registry: WorkspaceRegistry, input: AttachGdscriptInput): Promise<{ attached: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absScriptPath = registry.resolvePath(workspace, input.scriptPath);
  const relScriptPath = relative(workspace.root, absScriptPath).replace(/\\/g, "/");
  const result = await getBridgeClient(input.workspaceId).sendRequest("node.attach_script", {
    nodePath: input.nodePath,
    scriptPath: `res://${relScriptPath}`,
  });
  return { attached: !!result?.attached };
}

export async function detachGdscript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; nodePath: string },
): Promise<{ detached: boolean }> {
  const result = await getBridgeClient(input.workspaceId).sendRequest("node.detach_script", { nodePath: input.nodePath });
  return { detached: !!result?.detached };
}

export interface CreateGdscriptSignalInput {
  workspaceId: string;
  scriptPath: string;
  signalName: string;
  parameters?: Array<{ name: string; type?: string }>;
}

export async function createGdscriptSignal(registry: WorkspaceRegistry, input: CreateGdscriptSignalInput): Promise<{ success: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  if (content.includes(`signal ${input.signalName}`)) throw new Error(`Signal ${input.signalName} already exists in script.`);
  const lines = content.split(/\r?\n/);
  const paramsStr = (input.parameters ?? []).map((parameter) => parameter.type ? `${parameter.name}: ${parameter.type}` : parameter.name).join(", ");
  const signalLine = paramsStr ? `signal ${input.signalName}(${paramsStr})` : `signal ${input.signalName}`;
  let insertIdx = 0;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith("extends ") || lines[index].startsWith("class_name ") || lines[index].startsWith("@tool")) insertIdx = index + 1;
  }
  lines.splice(insertIdx, 0, signalLine);
  await writeFile(absPath, lines.join("\n"), "utf8");
  return { success: true };
}

export async function createGdscriptSignalHandler(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; methodName: string; parameters?: Array<{ name: string; type?: string }> },
): Promise<{ success: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  if (content.includes(`func ${input.methodName}`)) throw new Error(`Method ${input.methodName} already exists in script.`);
  const paramsStr = (input.parameters ?? []).map((parameter) => parameter.type ? `${parameter.name}: ${parameter.type}` : parameter.name).join(", ");
  const lines = content.split(/\r?\n/);
  lines.push("", `func ${input.methodName}(${paramsStr}) -> void:`, "\tpass");
  await writeFile(absPath, lines.join("\n"), "utf8");
  return { success: true };
}

export async function getGlobalClasses(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<Array<{ className: string; baseType: string; scriptPath: string }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const gdscriptFiles = (await scanWorkspaceDir(workspace.root)).filter((file) => file.endsWith(".gd"));
  const classes: Array<{ className: string; baseType: string; scriptPath: string }> = [];
  for (const file of gdscriptFiles) {
    const content = await readFile(file, "utf8");
    const classMatch = content.match(/^class_name\s+(\w+)/m);
    if (classMatch) {
      const extendsMatch = content.match(/^extends\s+(\w+)/m);
      classes.push({ className: classMatch[1], baseType: extendsMatch ? extendsMatch[1] : "RefCounted", scriptPath: relative(workspace.root, file).replace(/\\/g, "/") });
    }
  }
  return classes;
}

export async function addClassName(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; className: string },
): Promise<{ success: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  if (content.includes("class_name ")) throw new Error("Script already has a class_name defined.");
  const lines = content.split(/\r?\n/);
  let insertIdx = 0;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith("extends ") || lines[index].startsWith("@tool")) insertIdx = index + 1;
  }
  lines.splice(insertIdx, 0, `class_name ${input.className}`);
  await writeFile(absPath, lines.join("\n"), "utf8");
  return { success: true };
}

export async function removeClassName(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<{ success: boolean; warnings: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  const classMatch = content.match(/^class_name\s+(\w+)/m);
  const warnings = classMatch ? [`References to global class '${classMatch[1]}' in other scenes/scripts may be broken.`] : [];
  await writeFile(absPath, content.split(/\r?\n/).filter((line) => !line.startsWith("class_name ")).join("\n"), "utf8");
  return { success: true, warnings };
}

export async function addGdscriptAutoload(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; singletonName: string },
): Promise<{ success: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const godotFile = join(workspace.root, "project.godot");
  if (!existsSync(godotFile)) throw new Error("No project.godot found at workspace root.");
  const lines = (await readFile(godotFile, "utf8")).split(/\r?\n/);
  const autoloadSecIdx = lines.findIndex((line) => line.trim() === "[autoload]");
  const relScriptPath = relative(workspace.root, registry.resolvePath(workspace, input.scriptPath)).replace(/\\/g, "/");
  const autoloadLine = `${input.singletonName}="*res://${relScriptPath}"`;
  if (autoloadSecIdx === -1) lines.push("", "[autoload]", autoloadLine);
  else {
    if (lines.some((line) => line.startsWith(`${input.singletonName}=`))) throw new Error(`Autoload singleton '${input.singletonName}' already exists.`);
    lines.splice(autoloadSecIdx + 1, 0, autoloadLine);
  }
  await writeFile(godotFile, lines.join("\n"), "utf8");
  return { success: true };
}

export async function getAutoloadUsage(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; singletonName: string },
): Promise<Array<{ path: string; line: number; text: string }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const scriptFiles = (await scanWorkspaceDir(workspace.root)).filter((file) => file.endsWith(".gd") || file.endsWith(".cs"));
  const results: Array<{ path: string; line: number; text: string }> = [];
  for (const file of scriptFiles) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (lines[index].includes(input.singletonName)) results.push({ path: relative(workspace.root, file), line: index + 1, text: lines[index].trim() });
    }
  }
  return results;
}

export async function inspectToolScript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<{ toolScript: boolean; methods: string[]; warnings: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const content = await readFile(registry.resolvePath(workspace, input.scriptPath), "utf8");
  const toolScript = content.includes("@tool");
  const methods: string[] = [];
  const warnings: string[] = [];
  if (toolScript) {
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/func\s+(\w+)/);
      if (match) methods.push(match[1]);
    }
    warnings.push("Tool scripts run inside the editor. Avoid modifying files or running subprocesses in tool script code.");
  }
  return { toolScript, methods, warnings };
}

export async function createEditorPlugin(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; pluginName: string; description?: string; author?: string; version?: string },
): Promise<{ success: boolean; filesCreated: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const addonDir = registry.resolvePath(workspace, join("addons", input.pluginName));
  await mkdir(addonDir, { recursive: true });
  const cfgPath = join(addonDir, "plugin.cfg");
  const gdPath = join(addonDir, "plugin.gd");
  await writeFile(cfgPath, `[plugin]\n\nname="${input.pluginName}"\ndescription="${input.description ?? "A Auvrynt generated editor plugin"}"\nauthor="${input.author ?? "Auvrynt Agent"}"\nversion="${input.version ?? "1.0.0"}"\nscript="plugin.gd"\n`, "utf8");
  await writeFile(gdPath, `@tool\nextends EditorPlugin\n\nfunc _enter_tree() -> void:\n\tprint("[${input.pluginName}] Plugin enabled.")\n\nfunc _exit_tree() -> void:\n\tprint("[${input.pluginName}] Plugin disabled.")\n`, "utf8");
  return { success: true, filesCreated: [relative(workspace.root, cfgPath).replace(/\\/g, "/"), relative(workspace.root, gdPath).replace(/\\/g, "/")] };
}

export async function getGdscriptDependencies(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<Array<{ path: string; loadType: "preload" | "load" | "resourceloader"; exists: boolean }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const content = await readFile(registry.resolvePath(workspace, input.scriptPath), "utf8");
  const results: Array<{ path: string; loadType: "preload" | "load" | "resourceloader"; exists: boolean }> = [];
  for (const line of content.split(/\r?\n/)) {
    const preload = line.match(/preload\((?:"([^"]+)"|'([^']+)')\)/);
    if (preload) {
      const path = preload[1] || preload[2];
      results.push({ path, loadType: "preload", exists: existsSync(join(workspace.root, path.replace("res://", ""))) });
    }
    const loadMatch = line.match(/load\((?:"([^"]+)"|'([^']+)')\)/);
    if (loadMatch) {
      const path = loadMatch[1] || loadMatch[2];
      results.push({ path, loadType: "load", exists: existsSync(join(workspace.root, path.replace("res://", ""))) });
    }
  }
  return results;
}

export async function findCyclicScriptDependencies(registry: WorkspaceRegistry, input: { workspaceId: string }): Promise<string[][]> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const graph = new Map<string, string[]>();
  for (const file of (await scanWorkspaceDir(workspace.root)).filter((candidate) => candidate.endsWith(".gd"))) {
    const relPath = relative(workspace.root, file).replace(/\\/g, "/");
    const preloads: string[] = [];
    for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
      const preload = line.match(/preload\((?:"([^"]+)"|'([^']+)')\)/);
      if (preload) preloads.push((preload[1] || preload[2]).replace("res://", ""));
    }
    graph.set(relPath, preloads);
  }
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(node: string, currentPath: string[]) {
    visited.add(node);
    stack.add(node);
    currentPath.push(node);
    for (const neighbor of graph.get(node) ?? []) {
      if (stack.has(neighbor)) {
        const cycleStart = currentPath.indexOf(neighbor);
        if (cycleStart !== -1) cycles.push(currentPath.slice(cycleStart));
      } else if (!visited.has(neighbor)) dfs(neighbor, [...currentPath]);
    }
    stack.delete(node);
  }
  for (const node of graph.keys()) if (!visited.has(node)) dfs(node, []);
  return cycles;
}

export async function getGdscriptNodeReferences(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<Array<{ path: string; style: "dollar" | "unique" | "get_node"; line: number }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const content = await readFile(registry.resolvePath(workspace, input.scriptPath), "utf8");
  const results: Array<{ path: string; style: "dollar" | "unique" | "get_node"; line: number }> = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const dollar = line.match(/\$(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_\/]+))/);
    if (dollar) {
      const path = dollar[1] || dollar[2] || dollar[3];
      results.push({ path, style: path.startsWith("%") ? "unique" : "dollar", line: index + 1 });
    }
    const getNode = line.match(/get_node\((?:"([^"]+)"|'([^']+)')\)/);
    if (getNode) results.push({ path: getNode[1] || getNode[2], style: "get_node", line: index + 1 });
  }
  return results;
}

export async function getGdscriptLifecycleMethods(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<Array<{ method: string; line: number; warnings: string[] }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const content = await readFile(registry.resolvePath(workspace, input.scriptPath), "utf8");
  const methods = ["_init", "_enter_tree", "_ready", "_process", "_physics_process", "_input", "_unhandled_input", "_exit_tree", "_draw"];
  const results: Array<{ method: string; line: number; warnings: string[] }> = [];
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const match = line.match(/func\s+(_\w+)/);
    if (match && methods.includes(match[1])) {
      const warnings: string[] = [];
      if ((match[1] === "_process" || match[1] === "_physics_process") && !line.includes("delta")) warnings.push(`Lifecycle method ${match[1]} does not reference 'delta'.`);
      results.push({ method: match[1], line: index + 1, warnings });
    }
  }
  return results;
}

export async function inspectGdscriptAwaitUsage(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<Array<{ line: number; expression: string; warning?: string }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const content = await readFile(registry.resolvePath(workspace, input.scriptPath), "utf8");
  const results: Array<{ line: number; expression: string; warning?: string }> = [];
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const match = raw.trim().match(/await\s+(.+)$/);
    if (!match) continue;
    const expression = match[1];
    const warning = !expression.includes(".") && !expression.includes("(")
      ? "Awaiting a symbol directly. Ensure it resolves to a signal or a Callable."
      : undefined;
    results.push({ line: index + 1, expression, warning });
  }
  return results;
}

export async function analyzeGdscriptTyping(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<{ typedVariablesPercentage: number; typedParametersPercentage: number; typedReturnsPercentage: number }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const content = await readFile(registry.resolvePath(workspace, input.scriptPath), "utf8");
  let variables = 0;
  let typedVariables = 0;
  let parameters = 0;
  let typedParameters = 0;
  let returns = 0;
  let typedReturns = 0;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("var ") || line.startsWith("@onready var ") || line.startsWith("@export var ")) {
      variables++;
      if (line.includes(":") || line.includes(":=")) typedVariables++;
    }
    if (line.startsWith("func ")) {
      returns++;
      if (line.includes("->")) typedReturns++;
      const parameterMatch = line.match(/\((.*?)\)/);
      if (parameterMatch?.[1]) {
        for (const parameter of parameterMatch[1].split(",").map((value) => value.trim())) {
          parameters++;
          if (parameter.includes(":")) typedParameters++;
        }
      }
    }
  }
  return {
    typedVariablesPercentage: variables ? Math.round((typedVariables / variables) * 100) : 100,
    typedParametersPercentage: parameters ? Math.round((typedParameters / parameters) * 100) : 100,
    typedReturnsPercentage: returns ? Math.round((typedReturns / returns) * 100) : 100,
  };
}

export async function formatGdscript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath?: string; verifyOnly?: boolean },
): Promise<{ formatted: boolean; verified: boolean; diff?: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const file = input.scriptPath ? registry.resolvePath(workspace, input.scriptPath) : workspace.root;
  try {
    await execFileAsync("gdformat", input.verifyOnly ? ["--check", file] : [file], { windowsHide: true });
    return { formatted: !input.verifyOnly, verified: true };
  } catch {
    return { formatted: false, verified: false };
  }
}

export async function detectGdscriptTests(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string },
): Promise<{ framework: "gut" | "none"; testDirectories: string[]; testScripts: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectRoot = registry.resolvePath(workspace, input.projectPath);
  const framework = existsSync(join(projectRoot, "addons", "gut")) ? "gut" : "none";
  const testScripts = (await scanWorkspaceDir(projectRoot))
    .filter((file) => basename(file).startsWith("test_") && file.endsWith(".gd"))
    .map((file) => relative(workspace.root, file).replace(/\\/g, "/"));
  return { framework, testDirectories: [], testScripts };
}

export async function runGdscriptTests(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string; testPath?: string; filter?: string },
): Promise<{ passed: number; failed: number; skipped: number; duration: number; logs: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectRoot = registry.resolvePath(workspace, input.projectPath);
  const args = ["--headless", "--path", projectRoot, "-s", "addons/gut/gut_cmdline.gd"];
  if (input.testPath) args.push(`-gselect=${input.testPath}`);
  const start = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync(process.env.GODOT_EXECUTABLE || "godot", args, { timeout: 30000, windowsHide: true });
    const logs = stdout.toString() + stderr.toString();
    return {
      passed: Number(logs.match(/(\d+) passed/)?.[1] ?? 0),
      failed: Number(logs.match(/(\d+) failed/)?.[1] ?? 0),
      skipped: 0,
      duration: Math.round(performance.now() - start),
      logs,
    };
  } catch (error: any) {
    return { passed: 0, failed: 0, skipped: 0, duration: Math.round(performance.now() - start), logs: `Failed to execute test suite: ${error.message}` };
  }
}

export async function reloadGdscript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath?: string },
): Promise<{ reloaded: boolean }> {
  const result = await getBridgeClient(input.workspaceId).sendRequest("gdscript.reload", { scriptPath: input.scriptPath });
  return { reloaded: !!result?.reloaded };
}

export async function setBreakpoint(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; line: number },
): Promise<{ success: boolean }> {
  await getBridgeClient(input.workspaceId).sendRequest("debugger.set_breakpoint", { scriptPath: input.scriptPath, line: input.line });
  return { success: true };
}

export async function removeBreakpoint(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; line: number },
): Promise<{ success: boolean }> {
  await getBridgeClient(input.workspaceId).sendRequest("debugger.remove_breakpoint", { scriptPath: input.scriptPath, line: input.line });
  return { success: true };
}

export async function lspFindSymbol(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; symbol: string },
): Promise<any> {
  return getBridgeClient(input.workspaceId).sendRequest("lsp.find_symbol", { symbol: input.symbol });
}

export async function lspGetDefinition(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; line: number; character: number },
): Promise<any> {
  return getBridgeClient(input.workspaceId).sendRequest("lsp.get_definition", {
    scriptPath: input.scriptPath,
    line: input.line,
    character: input.character,
  });
}
