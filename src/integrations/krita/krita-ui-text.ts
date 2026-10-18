import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DesktopCaptureFrame } from "../desktop/desktop-capture.js";
import type { KritaUiTarget } from "./krita-ui-targets.js";

const execFileAsync = promisify(execFile);
const MAX_ELEMENTS = 2_048;
const MAX_TEXT_LENGTH = 2_048;

export interface KritaUiAutomationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KritaUiAutomationElement {
  name: string;
  value: string;
  automationId: string;
  className: string;
  controlType: string;
  bounds: KritaUiAutomationBounds;
  offscreen: boolean;
  /** Present only when the element exposes UIA SelectionItemPattern. */
  selected?: boolean;
}

export interface KritaUiAutomationSnapshot {
  handle: string;
  processId: number;
  processName: string;
  bounds: KritaUiAutomationBounds;
  elements: KritaUiAutomationElement[];
}

/**
 * Read text/value semantics from one already verified Krita target. The
 * Windows query is bounded to the current Krita top-level handle and to the
 * target rectangle; it never searches the desktop or changes focus.
 */
export async function readKritaUiTargetText(
  workspaceId: string,
  target: KritaUiTarget,
  frame: DesktopCaptureFrame,
): Promise<string | undefined> {
  void workspaceId;
  const elements = await queryKritaUiTargetElements(target, frame);
  if (!elements) return undefined;
  return extractKritaTargetText(target, elements);
}

/**
 * Query Windows UI Automation descendants for one target rectangle. Every
 * identity and capture invariant is checked before the query is issued; any
 * stale, ambiguous, or malformed result fails closed as undefined.
 */
export async function queryKritaUiTargetElements(
  target: KritaUiTarget,
  frame: DesktopCaptureFrame,
): Promise<KritaUiAutomationElement[] | undefined> {
  if (process.platform !== "win32" || !isSafeTarget(target) || !isSafeUiFrame(target, frame)) return undefined;

  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AuvryntKritaUiAutomation {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@

[AuvryntKritaUiAutomation]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$handle = [IntPtr]([Int64]$env:AUVRYNT_KRITA_UI_HANDLE)
if ($handle -eq [IntPtr]::Zero -or -not [AuvryntKritaUiAutomation]::IsWindow($handle) -or
    -not [AuvryntKritaUiAutomation]::IsWindowVisible($handle) -or [AuvryntKritaUiAutomation]::IsIconic($handle)) {
    throw 'Krita target window is not a visible, non-minimized window.'
}
[uint32]$processId = 0
[AuvryntKritaUiAutomation]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
$process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
if (-not $process) { throw 'Krita target process is no longer running.' }
if ([int]$processId -ne [int]$env:AUVRYNT_KRITA_UI_PROCESS_ID -or
    $process.ProcessName -ine $env:AUVRYNT_KRITA_UI_PROCESS_NAME) { throw 'Krita target process identity changed.' }
$outer = New-Object AuvryntKritaUiAutomation+RECT
if (-not [AuvryntKritaUiAutomation]::GetWindowRect($handle, [ref]$outer)) { throw 'Krita target bounds are unavailable.' }
$outerWidth = [int]($outer.Right - $outer.Left)
$outerHeight = [int]($outer.Bottom - $outer.Top)
if ($outerWidth -ne [int]$env:AUVRYNT_KRITA_UI_WINDOW_WIDTH -or $outerHeight -ne [int]$env:AUVRYNT_KRITA_UI_WINDOW_HEIGHT) {
    throw 'Krita target geometry changed.'
}

$targetLeft = [int]$outer.Left + [int]$env:AUVRYNT_KRITA_UI_TARGET_X
$targetTop = [int]$outer.Top + [int]$env:AUVRYNT_KRITA_UI_TARGET_Y
$targetRight = $targetLeft + [int]$env:AUVRYNT_KRITA_UI_TARGET_WIDTH
$targetBottom = $targetTop + [int]$env:AUVRYNT_KRITA_UI_TARGET_HEIGHT
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if (-not $root) { throw 'Krita UI Automation root is unavailable.' }
$condition = [System.Windows.Automation.Condition]::TrueCondition
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$elements = New-Object System.Collections.Generic.List[object]
foreach ($element in $all) {
    if ($elements.Count -ge 2048) { break }
    try {
        $rect = $element.Current.BoundingRectangle
        if ($rect.IsEmpty -or $rect.Width -le 0 -or $rect.Height -le 0) { continue }
        if ($rect.Right -le $targetLeft -or $rect.Left -ge $targetRight -or $rect.Bottom -le $targetTop -or $rect.Top -ge $targetBottom) { continue }
        $name = [string]$element.Current.Name
        $value = ''
        $pattern = $null
        try {
            if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                $value = [string]$pattern.Current.Value
            }
        } catch { $value = '' }
        $selected = $null
        $selectionPattern = $null
        try {
            if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
                $selected = [bool]$selectionPattern.Current.IsSelected
            }
        } catch { $selected = $null }
        if ($name.Length -gt 2048) { $name = $name.Substring(0, 2048) }
        if ($value.Length -gt 2048) { $value = $value.Substring(0, 2048) }
        $elements.Add([pscustomobject]@{
            name = $name
            value = $value
            automationId = [string]$element.Current.AutomationId
            className = [string]$element.Current.ClassName
            controlType = [string]$element.Current.ControlType.ProgrammaticName
            bounds = [pscustomobject]@{
                x = [int][Math]::Round($rect.Left)
                y = [int][Math]::Round($rect.Top)
                width = [int][Math]::Round($rect.Width)
                height = [int][Math]::Round($rect.Height)
            }
            offscreen = [bool]$element.Current.IsOffscreen
            selected = $selected
        })
    } catch { }
}
[pscustomobject]@{
    handle = $handle.ToInt64().ToString()
    processId = [int]$processId
    processName = [string]$process.ProcessName
    bounds = [pscustomobject]@{ x = [int]$outer.Left; y = [int]$outer.Top; width = $outerWidth; height = $outerHeight }
    elements = @($elements.ToArray())
} | ConvertTo-Json -Compress -Depth 8
`;

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: uiAutomationEnvironment(target, frame),
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });
    const parsed = JSON.parse(stdout.trim()) as unknown;
    return normalizeSnapshot(parsed, target)?.elements;
  } catch {
    return undefined;
  }
}

/** Extract one conservative semantic value from bounded UIA elements. */
export function extractKritaTargetText(
  target: Pick<KritaUiTarget, "id" | "region">,
  elements: readonly KritaUiAutomationElement[],
): string | undefined {
  const usable = elements.filter((element) => !element.offscreen && (element.value.trim() || element.name.trim()));
  if (usable.length === 0) return undefined;
  const textOf = (element: KritaUiAutomationElement): string => element.value.trim() || element.name.trim();

  if (target.id === "brush-size" || target.region === "toolbar" && target.id.includes("brush")) {
    const size = usable.find((element) => /Kis(DoubleSliderSpinBox|IntSpinBox)/i.test(element.className)
      || /Spinner/i.test(element.controlType)
      || /(?:Size:\s*)?[0-9]+(?:\.[0-9]+)?\s*px/i.test(textOf(element)));
    return size ? textOf(size) : undefined;
  }
  if (target.id === "active-layer-name") {
    const names = usable
      .filter((element) => /TreeItem/i.test(element.controlType) || /layer/i.test(element.className))
      .map(textOf)
      .filter((value) => value && value !== "...");
    const uniqueNames = [...new Set(names)];
    return uniqueNames.length === 1 ? uniqueNames[0] : undefined;
  }
  if (target.id === "status-bar" || target.region === "status_bar" || target.id === "zoom") {
    const status = usable.find((element) => /%/.test(textOf(element)) && /(fit|zoom|view|\d)/i.test(textOf(element)));
    return status ? textOf(status) : undefined;
  }
  if (/color-hex-field|dialog-(filename|path)/i.test(target.id) || /(?:hex|filename|path)/i.test(target.region)) {
    const field = usable.find((element) => /Edit|ComboBox|Text/i.test(element.controlType) || /QLineEdit|Edit/i.test(element.className));
    return field ? textOf(field) : undefined;
  }
  if (/confirm|cancel|format|overwrite/i.test(target.id)) {
    return textOf(usable[0]!);
  }
  const unique = [...new Set(usable.map(textOf).filter(Boolean))];
  return unique.length > 0 ? unique.join(" | ").slice(0, MAX_TEXT_LENGTH) : undefined;
}

/** Parse Krita's brush-size display without accepting ambiguous text. */
export function parseKritaBrushSizeText(value: string | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(?:Size:\s*)?([0-9]+(?:\.[0-9]+)?)\s*px$/i.exec(value.trim());
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : undefined;
}

/** Parse a status-bar zoom percentage without treating other text as state. */
export function parseKritaZoomText(value: string | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /(?:^|\()\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*\)?\s*$/i.exec(value.trim());
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : undefined;
}

function isSafeTarget(target: KritaUiTarget): boolean {
  return Number.isSafeInteger(target.processId)
    && target.processId > 0
    && /^[0-9]+$/.test(target.windowHandle)
    && target.windowDimensions.width > 0
    && target.windowDimensions.height > 0
    && Number.isFinite(target.displayScale)
    && target.displayScale > 0
    && Number.isInteger(target.windowRegion.x)
    && Number.isInteger(target.windowRegion.y)
    && Number.isInteger(target.windowRegion.width)
    && Number.isInteger(target.windowRegion.height)
    && target.windowRegion.x >= 0
    && target.windowRegion.y >= 0
    && target.windowRegion.width > 0
    && target.windowRegion.height > 0
    && target.windowRegion.x + target.windowRegion.width <= target.windowDimensions.width
    && target.windowRegion.y + target.windowRegion.height <= target.windowDimensions.height;
}

function isSafeUiFrame(target: KritaUiTarget, frame: DesktopCaptureFrame): boolean {
  if (frame.target !== "app-window" || frame.format !== "png" || frame.mimeType !== "image/png") return false;
  if (frame.captureBackend !== "print-window" || frame.occlusionSafe !== true) return false;
  if (frame.windowHandle !== target.windowHandle || frame.processId !== target.processId) return false;
  if (!frame.processName || frame.processName.toLowerCase() !== target.processName.toLowerCase()) return false;
  if (!frame.foregroundWindowHandleBefore || frame.foregroundWindowHandleBefore !== frame.foregroundWindowHandleAfter) return false;
  const fullWindow = frame.sourceWidth === target.windowDimensions.width && frame.sourceHeight === target.windowDimensions.height;
  const targetCrop = frame.sourceWidth === target.windowRegion.width && frame.sourceHeight === target.windowRegion.height;
  return fullWindow || targetCrop;
}

function uiAutomationEnvironment(target: KritaUiTarget, frame: DesktopCaptureFrame): NodeJS.ProcessEnv {
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    ComSpec: process.env.ComSpec,
    AUVRYNT_KRITA_UI_HANDLE: target.windowHandle,
    AUVRYNT_KRITA_UI_PROCESS_ID: String(target.processId),
    AUVRYNT_KRITA_UI_PROCESS_NAME: target.processName,
    AUVRYNT_KRITA_UI_WINDOW_WIDTH: String(target.windowDimensions.width),
    AUVRYNT_KRITA_UI_WINDOW_HEIGHT: String(target.windowDimensions.height),
    AUVRYNT_KRITA_UI_TARGET_X: String(target.windowRegion.x),
    AUVRYNT_KRITA_UI_TARGET_Y: String(target.windowRegion.y),
    AUVRYNT_KRITA_UI_TARGET_WIDTH: String(target.windowRegion.width),
    AUVRYNT_KRITA_UI_TARGET_HEIGHT: String(target.windowRegion.height),
    AUVRYNT_KRITA_UI_FRAME_WIDTH: String(frame.sourceWidth),
    AUVRYNT_KRITA_UI_FRAME_HEIGHT: String(frame.sourceHeight),
  };
}

function normalizeSnapshot(value: unknown, target: KritaUiTarget): KritaUiAutomationSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.handle !== target.windowHandle || record.processId !== target.processId
    || typeof record.processName !== "string" || record.processName.toLowerCase() !== target.processName.toLowerCase()) return undefined;
  const bounds = normalizeBounds(record.bounds);
  if (!bounds || bounds.width !== target.windowDimensions.width || bounds.height !== target.windowDimensions.height) return undefined;
  if (!Array.isArray(record.elements) || record.elements.length > MAX_ELEMENTS) return undefined;
  const elements: KritaUiAutomationElement[] = [];
  for (const item of record.elements) {
    if (!item || typeof item !== "object") return undefined;
    const candidate = item as Record<string, unknown>;
    const elementBounds = normalizeBounds(candidate.bounds);
    if (!elementBounds) return undefined;
    const name = boundedString(candidate.name);
    const valueText = boundedString(candidate.value);
    const automationId = boundedString(candidate.automationId);
    const className = boundedString(candidate.className);
    const controlType = boundedString(candidate.controlType);
    if ([name, valueText, automationId, className, controlType].some((field) => field === undefined)) return undefined;
    if (typeof candidate.offscreen !== "boolean") return undefined;
    const selected = candidate.selected === undefined || candidate.selected === null
      ? undefined
      : typeof candidate.selected === "boolean"
        ? candidate.selected
        : undefined;
    if (candidate.selected !== undefined && candidate.selected !== null && selected === undefined) return undefined;
    elements.push({
      name: name!,
      value: valueText!,
      automationId: automationId!,
      className: className!,
      controlType: controlType!,
      bounds: elementBounds,
      offscreen: candidate.offscreen,
      selected,
    });
  }
  return { handle: target.windowHandle, processId: target.processId, processName: target.processName, bounds, elements };
}

function normalizeBounds(value: unknown): KritaUiAutomationBounds | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const fields = [record.x, record.y, record.width, record.height];
  if (!fields.every((field) => typeof field === "number" && Number.isInteger(field))) return undefined;
  const [x, y, width, height] = fields as number[];
  if (width < 0 || height < 0) return undefined;
  return { x, y, width, height };
}

function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) return undefined;
  return value;
}
