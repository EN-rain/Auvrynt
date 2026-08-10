import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../../infrastructure/config.js";
import { WorkspaceRegistry } from "../../workspace/workspaces.js";
import { inspectGodotDotnetProject } from "./godot-csharp-project.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-godot-csproj-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  const sampleGodotProject = `config_version=5

[application]

config/name="Space Shooter C#"
run/main_scene="res://Main.tscn"
`;

  const sampleCsproj = `<Project Sdk="Godot.NET.Sdk/4.3.0">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <RootNamespace>SpaceShooter</RootNamespace>
  </PropertyGroup>
</Project>`;

  await writeFile(join(root, "project.godot"), sampleGodotProject);
  await writeFile(join(root, "SpaceShooter.csproj"), sampleCsproj);
  await writeFile(join(root, "Main.cs"), "using Godot; public partial class Main : Node2D {}");

  // Inspect Godot .NET project
  const details = await inspectGodotDotnetProject(registry, { workspaceId });
  assert.equal(details.name, "Space Shooter C#");
  assert.equal(details.mainScene, "res://Main.tscn");
  assert.equal(details.csprojPath, "SpaceShooter.csproj");
  assert.equal(details.godotNetSdkVersion, "4.3.0");
  assert.equal(details.rootNamespace, "SpaceShooter");
  assert.equal(details.csharpScriptCount, 1);
} finally {
  await rm(root, { recursive: true, force: true });
}
