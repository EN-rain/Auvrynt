import assert from "node:assert/strict";
import type { ServerConfig } from "../config.js";
import { directoryRequirementsForIntegrations } from "./dashboard.js";

const baseIntegrations: ServerConfig["integrations"] = {
  godotGdscript: false,
  godotCsharp: false,
  blender: false,
  aseprite: false,
  serena: false,
  solOrchestrator: false,
  playwright: false,
  roblox: false,
  desktop: false,
  krita: false,
  openPencil: false,
};

assert.deepEqual(
  directoryRequirementsForIntegrations({
    ...baseIntegrations,
    godotGdscript: true,
    godotCsharp: true,
    blender: true,
    aseprite: true,
    serena: true,
    playwright: true,
  }),
  [
    { key: "godot", label: "Godot directory", note: "Used by Godot project tools." },
    { key: "blender", label: "Blender directory", note: "Used by Blender workspace tools." },
    { key: "aseprite", label: "Aseprite directory", note: "Used by Aseprite file tools." },
    { key: "serena", label: "Serena directory", note: "Used by Serena as the active project root." },
    { key: "playwright", label: "Web project directory", note: "Used by web project tools for local files and artifacts." },
  ],
);

assert.deepEqual(
  directoryRequirementsForIntegrations({
    ...baseIntegrations,
    roblox: true,
    desktop: true,
    krita: true,
  }),
  [],
);

console.log("dashboard directory metadata tests passed");
