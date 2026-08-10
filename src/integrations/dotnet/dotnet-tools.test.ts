import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../../infrastructure/config.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";
import {
  inspectDotnetProject,
  parseDotnetBuildOutput,
  parseDotnetTestOutput,
} from "./dotnet-tools.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-dotnet-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  const sampleCsproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="xunit" Version="2.6.2" />
  </ItemGroup>
</Project>`;

  await writeFile(join(root, "TestApp.csproj"), sampleCsproj);

  // 1. inspectDotnetProject
  const inspRes = await inspectDotnetProject(registry, { workspaceId, projectPath: "TestApp.csproj" });
  assert.equal(inspRes.sdkStyle, true);
  assert.equal(inspRes.outputType, "Exe");
  assert.deepEqual(inspRes.targetFrameworks, ["net8.0"]);
  assert.ok(inspRes.packageReferences.includes("Newtonsoft.Json"));
  assert.equal(inspRes.testFramework, "xUnit");

  // 2. parseDotnetBuildOutput
  const sampleBuildLog = `C:\\project\\Program.cs(12,15): error CS1002: ; expected [C:\\project\\TestApp.csproj]
C:\\project\\Helper.cs(5,10): warning CS0168: The variable 'x' is declared but never used [C:\\project\\TestApp.csproj]`;

  const parsedBuild = parseDotnetBuildOutput(sampleBuildLog);
  assert.equal(parsedBuild.success, false);
  assert.equal(parsedBuild.errors.length, 1);
  assert.equal(parsedBuild.errors[0].code, "CS1002");
  assert.equal(parsedBuild.errors[0].line, 12);
  assert.equal(parsedBuild.warnings.length, 1);
  assert.equal(parsedBuild.warnings[0].code, "CS0168");

  // 3. parseDotnetTestOutput
  const sampleTestLog = `Failed MyTestNamespace.TestClass.TestMethod1
  Assert.Equal() Failure
  Expected: 5
  Actual:   10
Failed! - Failed: 1, Passed: 5, Skipped: 0, Total: 6`;

  const parsedTest = parseDotnetTestOutput(sampleTestLog);
  assert.equal(parsedTest.failed, 1);
  assert.equal(parsedTest.passed, 5);
  assert.equal(parsedTest.skipped, 0);
  assert.ok(parsedTest.failedTestNames.includes("MyTestNamespace.TestClass.TestMethod1"));
} finally {
  await rm(root, { recursive: true, force: true });
}
