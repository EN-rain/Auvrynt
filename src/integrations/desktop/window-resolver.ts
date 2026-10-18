import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { selectDesktopWindow, type DesktopWindowCandidate, type DesktopWindowQuery } from "./window-target.js";

const execFileAsync = promisify(execFile);

export interface ResolvedDesktopWindow extends DesktopWindowCandidate {
  bounds: { x: number; y: number; width: number; height: number };
}

interface WindowProbeResult {
  windows?: unknown;
}

export async function resolveDesktopWindow(query: DesktopWindowQuery): Promise<ResolvedDesktopWindow> {
  if (process.platform !== "win32") {
    throw new Error(`Desktop window resolution is currently supported on Windows hosts only; got ${process.platform}.`);
  }
  if (!query.handle && query.processId === undefined && !query.processName && !query.title) {
    throw new Error("Window resolution requires a handle, processId, processName, or title.");
  }

  const candidates = await enumerateDesktopWindows();
  const selected = selectDesktopWindow(candidates, query);
  if (!selected) {
    const description = query.title ? ` title containing "${query.title}"` : "";
    throw new Error(`No visible, non-minimized top-level window matched${description}.`);
  }
  return selected;
}

/** Enumerate top-level windows without changing focus or z-order. */
export async function enumerateDesktopWindows(): Promise<ResolvedDesktopWindow[]> {
  if (process.platform !== "win32") {
    throw new Error(`Desktop window resolution is currently supported on Windows hosts only; got ${process.platform}.`);
  }
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOW_PROBE_SCRIPT], {
    encoding: "utf8",
    env: probeEnvironment(),
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout.trim()) as WindowProbeResult;
  if (!Array.isArray(parsed.windows)) throw new Error("Windows returned an invalid top-level window list.");
  return parsed.windows.map(normalizeCandidate);
}

function normalizeCandidate(value: unknown): ResolvedDesktopWindow {
  if (!value || typeof value !== "object") throw new Error("Windows returned an invalid window candidate.");
  const record = value as Record<string, unknown>;
  const handle = stringField(record.handle, "window handle");
  const processId = integerField(record.processId, "window process ID");
  const processName = stringField(record.processName, "window process name");
  if (typeof record.title !== "string") throw new Error("Windows returned an invalid window title.");
  const title = record.title;
  const bounds = record.bounds;
  if (!bounds || typeof bounds !== "object") throw new Error("Windows returned invalid window bounds.");
  const boundsRecord = bounds as Record<string, unknown>;
  return {
    handle,
    processId,
    processName,
    title,
    visible: record.visible === true,
    minimized: record.minimized === true,
    isMainWindow: record.isMainWindow === true,
    zOrder: integerField(record.zOrder, "window z-order"),
    ownerHandle: optionalHandle(record.ownerHandle),
    rootOwnerHandle: optionalHandle(record.rootOwnerHandle),
    bounds: {
      x: integerField(boundsRecord.x, "window x"),
      y: integerField(boundsRecord.y, "window y"),
      width: integerField(boundsRecord.width, "window width"),
      height: integerField(boundsRecord.height, "window height"),
    },
  };
}

function optionalHandle(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return stringField(value, "window owner handle");
}

function probeEnvironment(): NodeJS.ProcessEnv {
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    ComSpec: process.env.ComSpec,
  };
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Windows returned an invalid ${field}.`);
  return value;
}

function integerField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`Windows returned an invalid ${field}.`);
  return value;
}

const WINDOW_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AuvryntTopLevelWindows {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    public const uint GW_OWNER = 4;
    public const uint GA_ROOTOWNER = 3;
    public static IntPtr[] AllWindows() {
        var result = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => { result.Add(hWnd); return true; }, IntPtr.Zero);
        return result.ToArray();
    }
}
"@
[AuvryntTopLevelWindows]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$windows = New-Object System.Collections.Generic.List[object]
$zOrder = 0
foreach ($hWnd in [AuvryntTopLevelWindows]::AllWindows()) {
    [uint32]$processId = 0
    [AuvryntTopLevelWindows]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null
    if ($processId -eq 0) { continue }
    $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $titleBuilder = New-Object System.Text.StringBuilder 512
    [AuvryntTopLevelWindows]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity) | Out-Null
    $rect = New-Object AuvryntTopLevelWindows+RECT
    if (-not [AuvryntTopLevelWindows]::GetWindowRect($hWnd, [ref]$rect)) { continue }
    $owner = [AuvryntTopLevelWindows]::GetWindow($hWnd, [AuvryntTopLevelWindows]::GW_OWNER)
    $rootOwner = [AuvryntTopLevelWindows]::GetAncestor($hWnd, [AuvryntTopLevelWindows]::GA_ROOTOWNER)
    $ownerHandle = if ($owner -eq [IntPtr]::Zero) { $null } else { $owner.ToInt64().ToString() }
    $rootOwnerHandle = if ($rootOwner -eq [IntPtr]::Zero) { $null } else { $rootOwner.ToInt64().ToString() }
    $windows.Add([pscustomobject]@{
        handle = $hWnd.ToInt64().ToString()
        processId = [int]$processId
        processName = [string]$process.ProcessName
        title = $titleBuilder.ToString()
        visible = [bool][AuvryntTopLevelWindows]::IsWindowVisible($hWnd)
        minimized = [bool][AuvryntTopLevelWindows]::IsIconic($hWnd)
        isMainWindow = $process.MainWindowHandle -eq $hWnd
        zOrder = $zOrder
        ownerHandle = $ownerHandle
        rootOwnerHandle = $rootOwnerHandle
        bounds = [pscustomobject]@{
            x = [int]$rect.Left
            y = [int]$rect.Top
            width = [int]($rect.Right - $rect.Left)
            height = [int]($rect.Bottom - $rect.Top)
        }
    })
    $zOrder++
}
[pscustomobject]@{ windows = @($windows.ToArray()) } | ConvertTo-Json -Compress -Depth 6
`;
