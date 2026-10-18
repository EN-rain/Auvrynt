import assert from "node:assert/strict";
import { resolveCodexLaunch } from "./codex-app-server-client.js";

const windowsHome = "C:\\Users\\Test";
const windowsAppData = "C:\\Users\\Test\\AppData\\Roaming";
const sandboxCodex = "C:\\Users\\Test\\.codex\\.sandbox-bin\\codex.exe";
const npmCodex = "C:\\Users\\Test\\AppData\\Roaming\\npm\\codex.cmd";

{
  const resolved = resolveCodexLaunch({
    explicitExecutable: "C:\\Tools\\codex.exe",
    platform: "win32",
    homeDirectory: windowsHome,
    environment: { APPDATA: windowsAppData },
    fileExists: () => false,
  });
  assert.deepEqual(resolved, {
    executable: "C:\\Tools\\codex.exe",
    useShell: false,
    source: "explicit",
  });
}

{
  const resolved = resolveCodexLaunch({
    explicitExecutable: "C:\\Tools\\codex.cmd",
    platform: "win32",
    homeDirectory: windowsHome,
    environment: { APPDATA: windowsAppData },
    fileExists: () => false,
  });
  assert.deepEqual(resolved, {
    executable: "C:\\Tools\\codex.cmd",
    useShell: true,
    source: "explicit",
  });
}

{
  const resolved = resolveCodexLaunch({
    platform: "win32",
    homeDirectory: windowsHome,
    environment: { APPDATA: windowsAppData },
    fileExists: (path) => path === npmCodex,
  });
  assert.deepEqual(resolved, {
    executable: npmCodex,
    useShell: true,
    source: "npm-global-shim",
  });
}

{
  const resolved = resolveCodexLaunch({
    platform: "win32",
    homeDirectory: windowsHome,
    environment: { APPDATA: windowsAppData },
    fileExists: (path) => path === sandboxCodex,
  });
  assert.deepEqual(resolved, {
    executable: sandboxCodex,
    useShell: false,
    source: "codex-sandbox-bin",
  });
}

{
  const resolved = resolveCodexLaunch({
    platform: "win32",
    homeDirectory: windowsHome,
    environment: { APPDATA: windowsAppData },
    fileExists: () => false,
  });
  assert.deepEqual(resolved, {
    executable: "codex",
    useShell: true,
    source: "path",
  });
}

{
  const resolved = resolveCodexLaunch({
    platform: "linux",
    homeDirectory: "/home/test",
    environment: {},
    fileExists: () => false,
  });
  assert.deepEqual(resolved, {
    executable: "codex",
    useShell: false,
    source: "path",
  });
}

console.log("Codex app-server launcher resolution tests passed!");
