import assert from "node:assert/strict";
import { parseGodotBuildDiagnostics } from "./godot-csharp-build.js";
import { parseStructuredRuntimeLogs } from "./godot-csharp-runner.js";

// 1. Test build diagnostics parser
const buildLog = `C:\\SpaceGame\\Player.cs(15,22): error CS0103: The name 'speed' does not exist in the current context [C:\\SpaceGame\\SpaceGame.csproj]
C:\\SpaceGame\\Enemy.cs(8,12): warning CS0219: The variable 'hp' is assigned but its value is never used [C:\\SpaceGame\\SpaceGame.csproj]`;

const parsedBuild = parseGodotBuildDiagnostics(buildLog);
assert.equal(parsedBuild.success, false);
assert.equal(parsedBuild.errors.length, 1);
assert.equal(parsedBuild.errors[0].source, "csharp");
assert.equal(parsedBuild.errors[0].code, "CS0103");
assert.equal(parsedBuild.warnings.length, 1);
assert.equal(parsedBuild.warnings[0].source, "csharp");

// 2. Test runtime log parser with C# exception stack trace
const runtimeLogLines = [
  "System.NullReferenceException: Object reference not set to an instance of an object.",
  "   at SpaceGame.Player._Process(Double delta) in C:\\SpaceGame\\Player.cs:line 42",
  "   at Godot.Node._Process(Double delta)",
  "SCRIPT ERROR: Parse Error: Invalid call.",
  "Player initialized successfully",
  "Player initialized successfully",
];

const parsedRuntime = parseStructuredRuntimeLogs(runtimeLogLines);
assert.equal(parsedRuntime.length, 3);
assert.equal(parsedRuntime[0].severity, "error");
assert.equal(parsedRuntime[0].category, "csharp_exception");
assert.equal(parsedRuntime[0].stackFrames?.length, 2);
assert.equal(parsedRuntime[0].stackFrames?.[0].path, "C:\\SpaceGame\\Player.cs");
assert.equal(parsedRuntime[0].stackFrames?.[0].line, 42);

assert.equal(parsedRuntime[1].category, "godot_error");
assert.equal(parsedRuntime[2].category, "gd_print");
assert.equal(parsedRuntime[2].repeatCount, 2);
