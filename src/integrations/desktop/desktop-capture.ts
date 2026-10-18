import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getDesktopDisplay, listDesktopDisplays } from "./desktop-displays.js";
import { resolveDesktopWindow } from "./window-resolver.js";

const execFileAsync = promisify(execFile);
const MAX_WINDOW_TITLE_CHARS = 256;

export type DesktopCaptureTarget = "display" | "region" | "app-window";
export type DesktopCaptureFormat = "png" | "jpeg";
export type DesktopCaptureBackend = "copy-from-screen" | "print-window";

export interface DesktopCaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopCaptureInput {
  target: DesktopCaptureTarget;
  displayId?: string;
  region?: DesktopCaptureRegion;
  windowTitle?: string;
  processName?: string;
  windowHandle?: string;
  windowRegion?: DesktopCaptureRegion;
  maxWidth?: number;
  format?: DesktopCaptureFormat;
  quality?: number;
}

export interface DesktopCaptureFrame {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  format: DesktopCaptureFormat;
  target: DesktopCaptureTarget;
  displayId?: string;
  timestamp: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  bounds: DesktopCaptureRegion;
  processName?: string;
  processId?: number;
  windowHandle?: string;
  windowTitle?: string;
  captureBackend?: DesktopCaptureBackend;
  occlusionSafe?: boolean;
  foregroundWindowHandleBefore?: string;
  foregroundWindowHandleAfter?: string;
}

interface CapturePreparation {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  displayId?: string;
  windowTitle?: string;
  processName?: string;
  windowHandle?: string;
  windowRegion?: DesktopCaptureRegion;
}

interface PowerShellCaptureResult {
  sourceX?: unknown;
  sourceY?: unknown;
  sourceWidth?: unknown;
  sourceHeight?: unknown;
  width?: unknown;
  height?: unknown;
  processName?: unknown;
  processId?: unknown;
  windowHandle?: unknown;
  windowTitle?: unknown;
  captureBackend?: unknown;
  occlusionSafe?: unknown;
  foregroundWindowHandleBefore?: unknown;
  foregroundWindowHandleAfter?: unknown;
}

/**
 * Keep the caller's title query stable across a capture. Windows applications
 * such as Krita update their document title (for example with file size and a
 * modified marker) immediately after an input action. Freezing the title that
 * happened to be observed by the resolver turns that harmless update into a
 * false target mismatch. The resolver has already established the handle and
 * process identity; the original query is the correct bounded title needle.
 */
export function captureWindowTitleNeedle(requestedTitle: string | undefined, resolvedTitle: string): string {
  const requested = requestedTitle?.trim();
  return requested || resolvedTitle;
}

export async function captureDesktopFrame(input: DesktopCaptureInput): Promise<DesktopCaptureFrame> {
  if (process.platform !== "win32") {
    throw new Error(`Desktop capture is currently supported on Windows hosts only; got ${process.platform}.`);
  }

  const format = input.format ?? "png";
  const maxWidth = normalizeMaxWidth(input.maxWidth);
  const quality = normalizeQuality(input.quality);
  const prepared = await prepareCapture(input);
  const extension = format === "jpeg" ? "jpg" : "png";
  const outputPath = join(tmpdir(), `auvrynt-desktop-${randomUUID()}.${extension}`);

  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AuvryntDesktopWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@
[AuvryntDesktopWindow]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$sourceX = 0
$sourceY = 0
$sourceWidth = 0
$sourceHeight = 0
$windowHandle = [IntPtr]::Zero
$windowProcessId = $null
$windowProcessName = $null
$windowTitle = $null
$windowWidth = 0
$windowHeight = 0
$windowRegionX = 0
$windowRegionY = 0
$foregroundWindowBefore = [AuvryntDesktopWindow]::GetForegroundWindow()

if ($env:AUVRYNT_CAPTURE_TARGET -eq 'app-window') {
    $needle = $env:AUVRYNT_CAPTURE_WINDOW_TITLE
    $requestedProcessName = $env:AUVRYNT_CAPTURE_PROCESS_NAME
    $requestedWindowHandle = $env:AUVRYNT_CAPTURE_WINDOW_HANDLE
    $proc = $null
    if ($requestedWindowHandle) {
        try { $windowHandle = [IntPtr]([Int64]$requestedWindowHandle) }
        catch { throw "Target window handle '$requestedWindowHandle' is invalid." }
        if (-not [AuvryntDesktopWindow]::IsWindow($windowHandle) -or -not [AuvryntDesktopWindow]::IsWindowVisible($windowHandle)) {
            throw "Target window handle '$requestedWindowHandle' is not a visible top-level window."
        }
        [uint32]$resolvedProcessId = 0
        [AuvryntDesktopWindow]::GetWindowThreadProcessId($windowHandle, [ref]$resolvedProcessId) | Out-Null
        $proc = Get-Process -Id ([int]$resolvedProcessId) -ErrorAction SilentlyContinue
        if (-not $proc) { throw "Target window handle '$requestedWindowHandle' has no running process." }
        $titleBuilder = New-Object System.Text.StringBuilder 512
        [AuvryntDesktopWindow]::GetWindowText($windowHandle, $titleBuilder, $titleBuilder.Capacity) | Out-Null
        $windowTitle = $titleBuilder.ToString()
        if ($needle -and $windowTitle.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw "Target window title does not match '$needle'."
        }
        if ($requestedProcessName -and $proc.ProcessName -ine $requestedProcessName) {
            throw "Target window process '$($proc.ProcessName)' does not match '$requestedProcessName'."
        }
        $windowProcessId = [int]$resolvedProcessId
        $windowProcessName = [string]$proc.ProcessName
        if ([AuvryntDesktopWindow]::IsIconic($windowHandle)) {
            throw "Target window '$windowTitle' is minimized; restore it before continuing."
        }
        $rect = New-Object AuvryntDesktopWindow+RECT
        if (-not [AuvryntDesktopWindow]::GetWindowRect($windowHandle, [ref]$rect)) {
            throw 'Could not read target window bounds.'
        }
        $windowWidth = [int]($rect.Right - $rect.Left)
        $windowHeight = [int]($rect.Bottom - $rect.Top)
    } elseif ($requestedProcessName) {
        $proc = Get-Process -Name $requestedProcessName -ErrorAction SilentlyContinue | Where-Object {
            $_.MainWindowHandle -ne [IntPtr]::Zero -and
            ([string]$_.MainWindowTitle).IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
        } | Select-Object -First 1
    } else {
        $proc = Get-Process | Where-Object {
            $_.MainWindowHandle -ne [IntPtr]::Zero -and
            ([string]$_.MainWindowTitle).IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
        } | Select-Object -First 1
    }
    if (-not $requestedWindowHandle -and -not $proc) { throw "Target application window containing '$needle' was not found." }
    if (-not $requestedWindowHandle -and $requestedProcessName -and $proc.ProcessName -ine $requestedProcessName) {
        throw "Target window process '$($proc.ProcessName)' does not match '$requestedProcessName'."
    }
    if (-not $requestedWindowHandle -and ([string]$proc.MainWindowTitle).IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Target window title does not match '$needle'."
    }
    if (-not $requestedWindowHandle -and [AuvryntDesktopWindow]::IsIconic($proc.MainWindowHandle)) {
        throw "Target window '$($proc.MainWindowTitle)' is minimized; restore it before continuing."
    }
    if (-not $requestedWindowHandle) {
        $rect = New-Object AuvryntDesktopWindow+RECT
        if (-not [AuvryntDesktopWindow]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) {
            throw 'Could not read target window bounds.'
        }
        $windowHandle = $proc.MainWindowHandle
        $windowProcessId = [int]$proc.Id
        $windowProcessName = [string]$proc.ProcessName
        $windowTitle = [string]$proc.MainWindowTitle
        $windowWidth = [int]($rect.Right - $rect.Left)
        $windowHeight = [int]($rect.Bottom - $rect.Top)
    }
    if ($env:AUVRYNT_CAPTURE_WINDOW_REGION_X) {
        $windowRegionX = [int]$env:AUVRYNT_CAPTURE_WINDOW_REGION_X
        $windowRegionY = [int]$env:AUVRYNT_CAPTURE_WINDOW_REGION_Y
        $sourceWidth = [int]$env:AUVRYNT_CAPTURE_WINDOW_REGION_WIDTH
        $sourceHeight = [int]$env:AUVRYNT_CAPTURE_WINDOW_REGION_HEIGHT
        if ($windowRegionX -lt 0 -or $windowRegionY -lt 0 -or $sourceWidth -lt 1 -or $sourceHeight -lt 1 -or
            $windowRegionX + $sourceWidth -gt $windowWidth -or $windowRegionY + $sourceHeight -gt $windowHeight) {
            throw "Requested window capture region is outside the target window."
        }
    } else {
        $sourceWidth = $windowWidth
        $sourceHeight = $windowHeight
    }
    $sourceX = [int]$rect.Left + $windowRegionX
    $sourceY = [int]$rect.Top + $windowRegionY
} else {
    $sourceX = [int]$env:AUVRYNT_CAPTURE_X
    $sourceY = [int]$env:AUVRYNT_CAPTURE_Y
    $sourceWidth = [int]$env:AUVRYNT_CAPTURE_WIDTH
    $sourceHeight = [int]$env:AUVRYNT_CAPTURE_HEIGHT
}

if ($sourceWidth -lt 1 -or $sourceHeight -lt 1 -or $sourceWidth -gt 32768 -or $sourceHeight -gt 32768) {
    throw "Invalid desktop capture bounds: $($sourceWidth)x$($sourceHeight)"
}

$bitmap = New-Object System.Drawing.Bitmap $sourceWidth, $sourceHeight
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$fullBitmap = $null
$fullGraphics = $null
$resized = $null
try {
    if ($env:AUVRYNT_CAPTURE_TARGET -eq 'app-window') {
        $fullBitmap = New-Object System.Drawing.Bitmap $windowWidth, $windowHeight
        $fullGraphics = [System.Drawing.Graphics]::FromImage($fullBitmap)
        $fullHdc = $fullGraphics.GetHdc()
        try {
            if (-not [AuvryntDesktopWindow]::PrintWindow($windowHandle, $fullHdc, 2)) {
                throw 'Could not render the target window without reading the desktop behind it.'
            }
        } finally {
            $fullGraphics.ReleaseHdc($fullHdc)
        }
        $destination = New-Object System.Drawing.Rectangle 0, 0, $sourceWidth, $sourceHeight
        $source = New-Object System.Drawing.Rectangle $windowRegionX, $windowRegionY, $sourceWidth, $sourceHeight
        $graphics.DrawImage($fullBitmap, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
    } else {
        $graphics.CopyFromScreen($sourceX, $sourceY, 0, 0, $bitmap.Size)
    }
    $outBitmap = $bitmap
    $maxWidth = [int]$env:AUVRYNT_CAPTURE_MAX_WIDTH
    if ($maxWidth -gt 0 -and $sourceWidth -gt $maxWidth) {
        $outWidth = $maxWidth
        $outHeight = [Math]::Max(1, [int][Math]::Round($sourceHeight * ($maxWidth / [double]$sourceWidth)))
        $resized = New-Object System.Drawing.Bitmap $outWidth, $outHeight
        $resizeGraphics = [System.Drawing.Graphics]::FromImage($resized)
        try {
            $resizeGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $resizeGraphics.DrawImage($bitmap, 0, 0, $outWidth, $outHeight)
        } finally {
            $resizeGraphics.Dispose()
        }
        $outBitmap = $resized
    }

    if ($env:AUVRYNT_CAPTURE_FORMAT -eq 'jpeg') {
        $quality = [long]$env:AUVRYNT_CAPTURE_QUALITY
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        if (-not $codec) { throw 'JPEG encoder is unavailable.' }
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters 1
        try {
            $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $quality
            $outBitmap.Save($env:AUVRYNT_CAPTURE_OUTPUT, $codec, $encoderParams)
        } finally {
            $encoderParams.Dispose()
        }
    } else {
        $outBitmap.Save($env:AUVRYNT_CAPTURE_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png)
    }

    $foregroundWindowAfter = [AuvryntDesktopWindow]::GetForegroundWindow()
    [pscustomobject]@{
        sourceX = $sourceX
        sourceY = $sourceY
        sourceWidth = $sourceWidth
        sourceHeight = $sourceHeight
        width = $outBitmap.Width
        height = $outBitmap.Height
        processName = $windowProcessName
        processId = $windowProcessId
        windowHandle = if ($windowHandle -ne [IntPtr]::Zero) { $windowHandle.ToInt64().ToString() } else { $null }
        windowTitle = $windowTitle
        captureBackend = if ($env:AUVRYNT_CAPTURE_TARGET -eq 'app-window') { 'print-window' } else { 'copy-from-screen' }
        occlusionSafe = $env:AUVRYNT_CAPTURE_TARGET -eq 'app-window'
        foregroundWindowHandleBefore = if ($foregroundWindowBefore -ne [IntPtr]::Zero) { $foregroundWindowBefore.ToInt64().ToString() } else { $null }
        foregroundWindowHandleAfter = if ($foregroundWindowAfter -ne [IntPtr]::Zero) { $foregroundWindowAfter.ToInt64().ToString() } else { $null }
    } | ConvertTo-Json -Compress
} finally {
    if ($resized) { $resized.Dispose() }
    if ($fullGraphics) { $fullGraphics.Dispose() }
    if ($fullBitmap) { $fullBitmap.Dispose() }
    $graphics.Dispose()
    $bitmap.Dispose()
}
`;

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: desktopCaptureEnvironment({
        AUVRYNT_CAPTURE_TARGET: input.target,
        AUVRYNT_CAPTURE_WINDOW_TITLE: prepared.windowTitle ?? "",
        AUVRYNT_CAPTURE_PROCESS_NAME: prepared.processName ?? "",
        AUVRYNT_CAPTURE_WINDOW_HANDLE: prepared.windowHandle ?? "",
        AUVRYNT_CAPTURE_WINDOW_REGION_X: prepared.windowRegion ? String(prepared.windowRegion.x) : "",
        AUVRYNT_CAPTURE_WINDOW_REGION_Y: prepared.windowRegion ? String(prepared.windowRegion.y) : "",
        AUVRYNT_CAPTURE_WINDOW_REGION_WIDTH: prepared.windowRegion ? String(prepared.windowRegion.width) : "",
        AUVRYNT_CAPTURE_WINDOW_REGION_HEIGHT: prepared.windowRegion ? String(prepared.windowRegion.height) : "",
        AUVRYNT_CAPTURE_X: prepared.x === undefined ? "" : String(prepared.x),
        AUVRYNT_CAPTURE_Y: prepared.y === undefined ? "" : String(prepared.y),
        AUVRYNT_CAPTURE_WIDTH: prepared.width === undefined ? "" : String(prepared.width),
        AUVRYNT_CAPTURE_HEIGHT: prepared.height === undefined ? "" : String(prepared.height),
        AUVRYNT_CAPTURE_MAX_WIDTH: String(maxWidth),
        AUVRYNT_CAPTURE_FORMAT: format,
        AUVRYNT_CAPTURE_QUALITY: String(quality),
        AUVRYNT_CAPTURE_OUTPUT: outputPath,
      }),
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });

    const metadata = JSON.parse(stdout.trim()) as PowerShellCaptureResult;
    const buffer = await readFile(outputPath);
    const result: DesktopCaptureFrame = {
      buffer,
      mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
      format,
      target: input.target,
      displayId: prepared.displayId,
      timestamp: new Date().toISOString(),
      sourceWidth: integerField(metadata.sourceWidth, "sourceWidth"),
      sourceHeight: integerField(metadata.sourceHeight, "sourceHeight"),
      width: integerField(metadata.width, "width"),
      height: integerField(metadata.height, "height"),
      bounds: {
        x: integerField(metadata.sourceX, "sourceX"),
        y: integerField(metadata.sourceY, "sourceY"),
        width: integerField(metadata.sourceWidth, "sourceWidth"),
        height: integerField(metadata.sourceHeight, "sourceHeight"),
      },
      processName: stringField(metadata.processName),
      processId: optionalIntegerField(metadata.processId),
      windowHandle: stringField(metadata.windowHandle),
      windowTitle: stringField(metadata.windowTitle),
      captureBackend: normalizeCaptureBackend(metadata.captureBackend, input.target),
      occlusionSafe: input.target === "app-window" ? metadata.occlusionSafe === true : false,
      foregroundWindowHandleBefore: stringField(metadata.foregroundWindowHandleBefore),
      foregroundWindowHandleAfter: stringField(metadata.foregroundWindowHandleAfter),
    };
    if (input.target === "app-window"
      && frameForegroundChanged(resultForegroundBefore(metadata), resultForegroundAfter(metadata))) {
      throw new Error("Krita window capture changed the foreground window; read-only capture is required to preserve focus.");
    }
    return result;
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}

async function prepareCapture(input: DesktopCaptureInput): Promise<CapturePreparation> {
  if (input.target === "app-window") {
    const windowTitle = input.windowTitle?.trim();
    if (!windowTitle) throw new Error("desktop_capture target=app-window requires windowTitle.");
    if (windowTitle.length > MAX_WINDOW_TITLE_CHARS) {
      throw new Error(`windowTitle exceeds ${MAX_WINDOW_TITLE_CHARS} characters.`);
    }
    const processName = normalizeProcessName(input.processName);
    const windowHandle = normalizeWindowHandle(input.windowHandle);
    const windowRegion = input.windowRegion;
    if (windowRegion) validateWindowRegion(windowRegion);
    const resolved = await resolveDesktopWindow({ title: windowTitle, processName, handle: windowHandle });
    return {
      windowTitle: captureWindowTitleNeedle(windowTitle, resolved.title),
      processName: resolved.processName,
      windowHandle: resolved.handle,
      windowRegion,
    };
  }

  const displays = await listDesktopDisplays();
  if (!input.displayId) throw new Error(`desktop_capture target=${input.target} requires displayId.`);
  const display = getDesktopDisplay(displays, input.displayId);

  if (input.target === "display") {
    return {
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
      displayId: display.id,
    };
  }

  const region = input.region;
  if (!region) throw new Error("desktop_capture target=region requires region.");
  validateRelativeRegion(region, display.width, display.height);
  return {
    x: display.x + region.x,
    y: display.y + region.y,
    width: region.width,
    height: region.height,
    displayId: display.id,
  };
}

function validateRelativeRegion(region: DesktopCaptureRegion, displayWidth: number, displayHeight: number): void {
  for (const [field, value] of Object.entries(region)) {
    if (!Number.isInteger(value)) throw new Error(`Desktop region ${field} must be an integer.`);
  }
  if (region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1) {
    throw new Error("Desktop region must have non-negative x/y and positive width/height.");
  }
  if (region.x + region.width > displayWidth || region.y + region.height > displayHeight) {
    throw new Error("Desktop region extends outside the selected display.");
  }
}

function normalizeMaxWidth(value: number | undefined): number {
  if (value === undefined) return 1600;
  if (!Number.isInteger(value) || value < 320 || value > 3840) {
    throw new Error("maxWidth must be an integer between 320 and 3840.");
  }
  return value;
}

function normalizeQuality(value: number | undefined): number {
  if (value === undefined) return 80;
  if (!Number.isInteger(value) || value < 20 || value > 95) {
    throw new Error("quality must be an integer between 20 and 95.");
  }
  return value;
}

function integerField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Desktop capture returned an invalid ${field}.`);
  }
  return value;
}

function optionalIntegerField(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return integerField(value, "window process ID");
}

function stringField(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Desktop capture returned an invalid window identity.");
  return value;
}

function normalizeCaptureBackend(value: unknown, target: DesktopCaptureTarget): DesktopCaptureBackend {
  if (target === "app-window") {
    if (value !== "print-window") throw new Error("Desktop capture returned an invalid app-window capture backend.");
    return "print-window";
  }
  if (value !== "copy-from-screen") throw new Error("Desktop capture returned an invalid screen capture backend.");
  return "copy-from-screen";
}

function resultForegroundBefore(metadata: PowerShellCaptureResult): string | undefined {
  return stringField(metadata.foregroundWindowHandleBefore);
}

function resultForegroundAfter(metadata: PowerShellCaptureResult): string | undefined {
  return stringField(metadata.foregroundWindowHandleAfter);
}

function frameForegroundChanged(before: string | undefined, after: string | undefined): boolean {
  return before !== after;
}

function normalizeProcessName(value: string | undefined): string | undefined {
  const name = value?.trim();
  if (!name) return undefined;
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    throw new Error("processName must contain only safe executable-name characters.");
  }
  return name;
}

function normalizeWindowHandle(value: string | undefined): string | undefined {
  const handle = value?.trim();
  if (!handle) return undefined;
  if (!/^[0-9]+$/.test(handle)) throw new Error("windowHandle must be a positive integer string.");
  const numeric = BigInt(handle);
  if (numeric <= 0n || numeric > 0x7fffffffffffffffn) {
    throw new Error("windowHandle is outside the supported Windows handle range.");
  }
  return handle;
}

function validateWindowRegion(region: DesktopCaptureRegion): void {
  for (const [field, value] of Object.entries(region)) {
    if (!Number.isInteger(value)) throw new Error("Window region " + field + " must be an integer.");
  }
  if (region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1) {
    throw new Error("Window region must have non-negative x/y and positive width/height.");
  }
}

function desktopCaptureEnvironment(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    ComSpec: process.env.ComSpec,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    ...extra,
  };
}
