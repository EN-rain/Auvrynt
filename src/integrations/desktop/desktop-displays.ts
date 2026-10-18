import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DISPLAY_COUNT = 32;

export interface DesktopDisplay {
  id: string;
  deviceName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
  scale: number;
}

interface DisplayProbeResult {
  displays?: Array<{
    id?: unknown;
    deviceName?: unknown;
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    primary?: unknown;
    scale?: unknown;
  }>;
}

function desktopProbeEnvironment(): NodeJS.ProcessEnv {
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    ComSpec: process.env.ComSpec,
  };
}

export async function listDesktopDisplays(): Promise<DesktopDisplay[]> {
  if (process.platform !== "win32") {
    throw new Error(`Desktop display enumeration is currently supported on Windows hosts only; got ${process.platform}.`);
  }

  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AuvryntDesktopDpi {
    [DllImport("user32.dll")]
    public static extern uint GetDpiForSystem();
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
[AuvryntDesktopDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$dpi = 96
try { $dpi = [int][AuvryntDesktopDpi]::GetDpiForSystem() } catch { $dpi = 96 }
$scale = [Math]::Round(($dpi / 96.0), 3)
$i = 0
$result = @()
foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    $i++
    $bounds = $screen.Bounds
    $result += [pscustomobject]@{
        id = "display-$i"
        deviceName = $screen.DeviceName
        x = [int]$bounds.X
        y = [int]$bounds.Y
        width = [int]$bounds.Width
        height = [int]$bounds.Height
        primary = [bool]$screen.Primary
        scale = $scale
    }
}
[pscustomobject]@{ displays = @($result) } | ConvertTo-Json -Compress -Depth 4
`;

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: desktopProbeEnvironment(),
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 256 * 1024,
  });

  const parsed = JSON.parse(stdout.trim()) as DisplayProbeResult;
  const rawDisplays = parsed.displays;
  if (!Array.isArray(rawDisplays) || rawDisplays.length === 0) {
    throw new Error("Windows did not report any attached displays.");
  }
  if (rawDisplays.length > MAX_DISPLAY_COUNT) {
    throw new Error(`Windows reported ${rawDisplays.length} displays, exceeding the safety limit of ${MAX_DISPLAY_COUNT}.`);
  }

  return rawDisplays.map((entry, index) => normalizeDisplay(entry, index));
}

function normalizeDisplay(
  entry: NonNullable<DisplayProbeResult["displays"]>[number],
  index: number,
): DesktopDisplay {
  const width = numberField(entry.width, "width");
  const height = numberField(entry.height, "height");
  if (width < 1 || height < 1 || width > 32_768 || height > 32_768) {
    throw new Error(`Invalid display dimensions reported by Windows: ${width}x${height}.`);
  }

  const scale = numberField(entry.scale, "scale");
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : `display-${index + 1}`,
    deviceName: typeof entry.deviceName === "string" ? entry.deviceName : "",
    x: numberField(entry.x, "x"),
    y: numberField(entry.y, "y"),
    width,
    height,
    primary: entry.primary === true,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  };
}

function numberField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Display probe returned an invalid ${field} value.`);
  }
  return value;
}

export function getDesktopDisplay(displays: DesktopDisplay[], displayId: string): DesktopDisplay {
  const display = displays.find((candidate) => candidate.id === displayId);
  if (!display) {
    throw new Error(`Unknown displayId "${displayId}". Call desktop_list_displays first.`);
  }
  return display;
}

export function pointInsideDisplay(display: DesktopDisplay, x: number, y: number): boolean {
  return x >= display.x
    && y >= display.y
    && x < display.x + display.width
    && y < display.y + display.height;
}
