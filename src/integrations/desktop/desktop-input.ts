import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDesktopDisplay, listDesktopDisplays } from "./desktop-displays.js";
import { resolveDesktopWindow } from "./window-resolver.js";

const execFileAsync = promisify(execFile);
const RATE_WINDOW_MS = 10_000;
const MAX_ACTIONS_PER_WINDOW = 120;
const MAX_TYPE_CHARS = 8_192;
const MAX_WINDOW_TITLE_CHARS = 256;

export type DesktopMouseButton = "left" | "right" | "middle";
export type DesktopFocusPolicy = "foreground" | "foreground-restore";

export function normalizeDesktopFocusPolicy(value: string | undefined): DesktopFocusPolicy {
  if (value === undefined || value === "foreground") return "foreground";
  if (value === "foreground-restore") return value;
  throw new Error("focusPolicy must be 'foreground' or 'foreground-restore'; background input is not supported by Windows SendInput.");
}

export interface DesktopInputOptions {
  focusPolicy?: DesktopFocusPolicy;
}

export interface DesktopTargetingInput {
  displayId?: string;
  windowTitle?: string;
  windowHandle?: string;
  processName?: string;
}

export interface DesktopPointInput extends DesktopTargetingInput {
  x: number;
  y: number;
  focusPolicy?: DesktopFocusPolicy;
}

export interface DesktopDragInput extends DesktopTargetingInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  button?: DesktopMouseButton;
  durationMs?: number;
  focusPolicy?: DesktopFocusPolicy;
}

export interface DesktopScrollInput extends DesktopTargetingInput {
  deltaY?: number;
  deltaX?: number;
  focusPolicy?: DesktopFocusPolicy;
}

const actionHistory = new Map<string, number[]>();
const disabledWorkspaces = new Set<string>();

export async function desktopMouseMove(workspaceId: string, input: DesktopPointInput): Promise<{ moved: true; x: number; y: number }> {
  guardInput(workspaceId);
  const point = await resolvePoint(input.displayId, input.x, input.y);
  await invokeDesktopInput({
    action: "move",
    x: point.x,
    y: point.y,
    windowTitle: normalizeWindowTitle(input.windowTitle),
    windowHandle: normalizeWindowHandle(input.windowHandle),
    processName: normalizeProcessName(input.processName),
    focusPolicy: normalizeDesktopFocusPolicy(input.focusPolicy),
  });
  return { moved: true, ...point };
}

export async function desktopMouseClick(
  workspaceId: string,
  input: DesktopPointInput & { button?: DesktopMouseButton; clickCount?: number },
): Promise<{ clicked: true; x: number; y: number; button: DesktopMouseButton; clickCount: number }> {
  guardInput(workspaceId);
  const point = await resolvePoint(input.displayId, input.x, input.y);
  const button = input.button ?? "left";
  const clickCount = normalizeClickCount(input.clickCount);
  await invokeDesktopInput({
    action: "click",
    x: point.x,
    y: point.y,
    button,
    clickCount,
    windowTitle: normalizeWindowTitle(input.windowTitle),
    windowHandle: normalizeWindowHandle(input.windowHandle),
    processName: normalizeProcessName(input.processName),
    focusPolicy: normalizeDesktopFocusPolicy(input.focusPolicy),
  });
  return { clicked: true, ...point, button, clickCount };
}

/**
 * Focus one verified point and send a shortcut before the desktop input
 * process restores the previous foreground window. This is intentionally a
 * single transaction: a second PowerShell process would have to re-focus the
 * top-level window and can discard the child-control focus established by the
 * click (notably Krita's Layers docker).
 */
export async function desktopMouseClickAndKeyPress(
  workspaceId: string,
  input: DesktopPointInput & { button?: DesktopMouseButton; clickCount?: number },
  keys: string[],
  windowTitle?: string,
  windowHandle?: string,
  processName?: string,
  options: DesktopInputOptions = {},
): Promise<{
  clicked: true;
  pressed: string[];
  x: number;
  y: number;
  button: DesktopMouseButton;
  clickCount: number;
}> {
  guardInput(workspaceId);
  const point = await resolvePoint(input.displayId, input.x, input.y);
  const virtualKeys = normalizeVirtualKeys(keys);
  const button = input.button ?? "left";
  const clickCount = normalizeClickCount(input.clickCount);
  await invokeDesktopInput({
    action: "click-key-press",
    x: point.x,
    y: point.y,
    button,
    clickCount,
    virtualKeys,
    windowTitle: normalizeWindowTitle(windowTitle),
    windowHandle: normalizeWindowHandle(windowHandle),
    processName: normalizeProcessName(processName),
    focusPolicy: normalizeDesktopFocusPolicy(options.focusPolicy),
  });
  return { clicked: true, pressed: keys.map((key) => key.trim()), ...point, button, clickCount };
}

export async function desktopMouseDrag(workspaceId: string, input: DesktopDragInput): Promise<{
  dragged: true;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  button: DesktopMouseButton;
}> {
  guardInput(workspaceId);
  const start = await resolvePoint(input.displayId, input.startX, input.startY);
  const end = await resolvePoint(input.displayId, input.endX, input.endY);
  const button = input.button ?? "left";
  const durationMs = normalizeDuration(input.durationMs);
  await invokeDesktopInput({
    action: "drag",
    x: start.x,
    y: start.y,
    endX: end.x,
    endY: end.y,
    button,
    durationMs,
    windowTitle: normalizeWindowTitle(input.windowTitle),
    windowHandle: normalizeWindowHandle(input.windowHandle),
    processName: normalizeProcessName(input.processName),
    focusPolicy: normalizeDesktopFocusPolicy(input.focusPolicy),
  });
  return {
    dragged: true,
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    button,
  };
}

export async function desktopMouseScroll(workspaceId: string, input: DesktopScrollInput): Promise<{
  scrolled: true;
  deltaX: number;
  deltaY: number;
}> {
  guardInput(workspaceId);
  const deltaX = normalizeWheelDelta(input.deltaX ?? 0, "deltaX");
  const deltaY = normalizeWheelDelta(input.deltaY ?? 0, "deltaY");
  if (deltaX === 0 && deltaY === 0) throw new Error("desktop_mouse_scroll requires a non-zero deltaX or deltaY.");
  await invokeDesktopInput({
    action: "scroll",
    deltaX,
    deltaY,
    windowTitle: normalizeWindowTitle(input.windowTitle),
    windowHandle: normalizeWindowHandle(input.windowHandle),
    processName: normalizeProcessName(input.processName),
    focusPolicy: normalizeDesktopFocusPolicy(input.focusPolicy),
  });
  return { scrolled: true, deltaX, deltaY };
}

export async function desktopKeyPress(
  workspaceId: string,
  keys: string[],
  windowTitle?: string,
  windowHandle?: string,
  processName?: string,
  options: DesktopInputOptions = {},
): Promise<{ pressed: string[] }> {
  guardInput(workspaceId);
  const virtualKeys = normalizeVirtualKeys(keys);
  await invokeDesktopInput({
    action: "key-press",
    virtualKeys,
    windowTitle: normalizeWindowTitle(windowTitle),
    windowHandle: normalizeWindowHandle(windowHandle),
    processName: normalizeProcessName(processName),
    focusPolicy: normalizeDesktopFocusPolicy(options.focusPolicy),
  });
  return { pressed: keys.map((key) => key.trim()) };
}

export async function desktopKeyDown(
  workspaceId: string,
  key: string,
  windowTitle?: string,
  windowHandle?: string,
  processName?: string,
  options: DesktopInputOptions = {},
): Promise<{ down: string }> {
  guardInput(workspaceId);
  const [virtualKey] = normalizeVirtualKeys([key]);
  await invokeDesktopInput({
    action: "key-down",
    virtualKeys: [virtualKey!],
    windowTitle: normalizeWindowTitle(windowTitle),
    windowHandle: normalizeWindowHandle(windowHandle),
    processName: normalizeProcessName(processName),
    focusPolicy: normalizeDesktopFocusPolicy(options.focusPolicy),
  });
  return { down: key.trim() };
}

export async function desktopKeyUp(
  workspaceId: string,
  key: string,
  windowTitle?: string,
  windowHandle?: string,
  processName?: string,
  options: DesktopInputOptions = {},
): Promise<{ up: string }> {
  guardInput(workspaceId);
  const [virtualKey] = normalizeVirtualKeys([key]);
  await invokeDesktopInput({
    action: "key-up",
    virtualKeys: [virtualKey!],
    windowTitle: normalizeWindowTitle(windowTitle),
    windowHandle: normalizeWindowHandle(windowHandle),
    processName: normalizeProcessName(processName),
    focusPolicy: normalizeDesktopFocusPolicy(options.focusPolicy),
  });
  return { up: key.trim() };
}

export async function desktopType(
  workspaceId: string,
  text: string,
  windowTitle?: string,
  windowHandle?: string,
  processName?: string,
  options: DesktopInputOptions = {},
): Promise<{ typedCharacters: number }> {
  guardInput(workspaceId);
  if (text.length > MAX_TYPE_CHARS) throw new Error(`desktop_type is limited to ${MAX_TYPE_CHARS} UTF-16 code units per call.`);
  await invokeDesktopInput({
    action: "type",
    text,
    windowTitle: normalizeWindowTitle(windowTitle),
    windowHandle: normalizeWindowHandle(windowHandle),
    processName: normalizeProcessName(processName),
    focusPolicy: normalizeDesktopFocusPolicy(options.focusPolicy),
  });
  return { typedCharacters: text.length };
}

export function desktopEmergencyStop(workspaceId: string): { stopped: true } {
  disabledWorkspaces.add(workspaceId);
  return { stopped: true };
}

export function desktopControlResume(workspaceId: string): { resumed: true } {
  disabledWorkspaces.delete(workspaceId);
  actionHistory.delete(workspaceId);
  return { resumed: true };
}

export function desktopControlStopped(workspaceId: string): boolean {
  return disabledWorkspaces.has(workspaceId);
}

export function clearDesktopControlStateForWorkspace(workspaceId: string): { cleared: boolean } {
  const disabledCleared = disabledWorkspaces.delete(workspaceId);
  const historyCleared = actionHistory.delete(workspaceId);
  return { cleared: disabledCleared || historyCleared };
}

export function clearAllDesktopControlState(): number {
  const workspaceIds = new Set([...disabledWorkspaces, ...actionHistory.keys()]);
  disabledWorkspaces.clear();
  actionHistory.clear();
  return workspaceIds.size;
}

function guardInput(workspaceId: string): void {
  if (disabledWorkspaces.has(workspaceId)) {
    throw new Error("Desktop input is emergency-stopped for this workspace. Call desktop_control_resume before sending more input.");
  }
  const now = Date.now();
  const history = actionHistory.get(workspaceId) ?? [];
  const recent = history.filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= MAX_ACTIONS_PER_WINDOW) {
    throw new Error(`Desktop input rate limit exceeded: max ${MAX_ACTIONS_PER_WINDOW} actions per ${RATE_WINDOW_MS / 1000} seconds.`);
  }
  recent.push(now);
  actionHistory.set(workspaceId, recent);
}

async function resolvePoint(displayId: string | undefined, x: number, y: number): Promise<{ x: number; y: number }> {
  if (!displayId) throw new Error("Pointer input requires displayId so coordinates remain bounded to an explicitly selected display.");
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error("Pointer coordinates must be integers relative to the selected display.");
  const displays = await listDesktopDisplays();
  const display = getDesktopDisplay(displays, displayId);
  if (x < 0 || y < 0 || x >= display.width || y >= display.height) {
    throw new Error(`Pointer coordinate (${x}, ${y}) is outside ${displayId} (${display.width}x${display.height}).`);
  }
  return { x: display.x + x, y: display.y + y };
}

function normalizeWindowTitle(value: string | undefined): string | undefined {
  const title = value?.trim();
  if (!title) return undefined;
  if (title.length > MAX_WINDOW_TITLE_CHARS) throw new Error(`windowTitle exceeds ${MAX_WINDOW_TITLE_CHARS} characters.`);
  return title;
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

function normalizeClickCount(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1 || value > 3) throw new Error("clickCount must be an integer from 1 to 3.");
  return value;
}

function normalizeDuration(value: number | undefined): number {
  if (value === undefined) return 250;
  if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new Error("durationMs must be an integer from 0 to 10000.");
  return value;
}

function normalizeWheelDelta(value: number, field: string): number {
  if (!Number.isInteger(value) || value < -12_000 || value > 12_000) {
    throw new Error(`${field} must be an integer between -12000 and 12000.`);
  }
  return value;
}

function normalizeVirtualKeys(keys: string[]): number[] {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 8) {
    throw new Error("keys must contain between 1 and 8 key names.");
  }
  return keys.map(virtualKeyForName);
}

export function virtualKeyForName(value: string): number {
  const key = value.trim().toUpperCase();
  if (/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  const functionMatch = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (functionMatch) return 0x6f + Number(functionMatch[1]);

  const named: Record<string, number> = {
    BACKSPACE: 0x08,
    TAB: 0x09,
    ENTER: 0x0d,
    RETURN: 0x0d,
    SHIFT: 0x10,
    CTRL: 0x11,
    CONTROL: 0x11,
    ALT: 0x12,
    PAUSE: 0x13,
    CAPSLOCK: 0x14,
    ESC: 0x1b,
    ESCAPE: 0x1b,
    SPACE: 0x20,
    PAGEUP: 0x21,
    PAGEDOWN: 0x22,
    END: 0x23,
    HOME: 0x24,
    LEFT: 0x25,
    UP: 0x26,
    RIGHT: 0x27,
    DOWN: 0x28,
    PRINTSCREEN: 0x2c,
    INSERT: 0x2d,
    DELETE: 0x2e,
    // Windows virtual-key codes for the numeric keypad operators. These are
    // the unambiguous no-shift equivalents of the `+`/`-` shortcut names
    // used by Krita's zoom bindings; VK_OEM_PLUS/MINUS would depend on the
    // active keyboard layout and can produce `=`/`_` instead.
    "+": 0x6b,
    PLUS: 0x6b,
    ADD: 0x6b,
    "-": 0x6d,
    MINUS: 0x6d,
    SUBTRACT: 0x6d,
    WIN: 0x5b,
    LWIN: 0x5b,
    RWIN: 0x5c,
    NUMLOCK: 0x90,
    SCROLLLOCK: 0x91,
  };
  const virtualKey = named[key];
  if (virtualKey === undefined) throw new Error(`Unsupported key name "${value}".`);
  return virtualKey;
}

interface DesktopInputCommand {
  action: "move" | "click" | "click-key-press" | "drag" | "scroll" | "key-press" | "key-down" | "key-up" | "type";
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  button?: DesktopMouseButton;
  clickCount?: number;
  durationMs?: number;
  deltaX?: number;
  deltaY?: number;
  virtualKeys?: number[];
  text?: string;
  windowTitle?: string;
  windowHandle?: string;
  processName?: string;
  focusPolicy?: DesktopFocusPolicy;
}

async function invokeDesktopInput(command: DesktopInputCommand): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error(`Desktop input is currently supported on Windows hosts only; got ${process.platform}.`);
  }

  const resolvedTarget = command.windowTitle || command.windowHandle || command.processName
    ? await resolveDesktopWindow({
      title: command.windowTitle,
      handle: command.windowHandle,
      processName: command.processName,
    })
    : undefined;

  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class AuvryntDesktopInput {
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetCursorPos(int X, int Y);
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
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr SetActiveWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_HWHEEL = 0x01000;

    private static void Send(INPUT input) {
        var inputs = new INPUT[] { input };
        if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1) {
            throw new InvalidOperationException("Windows SendInput failed.");
        }
    }

    public static void SendMouse(uint flags, uint data) {
        var input = new INPUT { type = INPUT_MOUSE };
        input.U.mi = new MOUSEINPUT { dwFlags = flags, mouseData = data };
        Send(input);
    }

    public static void SendKey(ushort vk, bool down) {
        var input = new INPUT { type = INPUT_KEYBOARD };
        input.U.ki = new KEYBDINPUT { wVk = vk, dwFlags = down ? 0u : KEYEVENTF_KEYUP };
        Send(input);
    }

    public static void SendText(string text) {
        foreach (char ch in text) {
            var down = new INPUT { type = INPUT_KEYBOARD };
            down.U.ki = new KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = KEYEVENTF_UNICODE };
            Send(down);
            var up = new INPUT { type = INPUT_KEYBOARD };
            up.U.ki = new KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP };
            Send(up);
        }
    }

    public static bool FocusWindow(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return false;
        if (IsIconic(hWnd)) return false;

        var foreground = GetForegroundWindow();
        var currentThread = GetCurrentThreadId();
        var foregroundThread = foreground == IntPtr.Zero ? 0u : GetWindowThreadProcessId(foreground, IntPtr.Zero);
        var targetThread = GetWindowThreadProcessId(hWnd, IntPtr.Zero);
        var attachedForeground = false;
        var attachedTarget = false;
        try {
            if (foregroundThread != 0 && foregroundThread != currentThread) {
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            }
            if (targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread) {
                attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            }
            BringWindowToTop(hWnd);
            SetActiveWindow(hWnd);
            var focused = SetForegroundWindow(hWnd);
            return focused || GetForegroundWindow() == hWnd;
        } finally {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    public static bool RestoreWindow(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero || !IsWindow(hWnd) || !IsWindowVisible(hWnd) || IsIconic(hWnd)) return false;
        return SetForegroundWindow(hWnd) || GetForegroundWindow() == hWnd;
    }
}
"@
[AuvryntDesktopInput]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

function Focus-TargetWindow {
    if (-not $env:AUVRYNT_INPUT_WINDOW_TITLE -and -not $env:AUVRYNT_INPUT_WINDOW_HANDLE) { return }
    $needle = $env:AUVRYNT_INPUT_WINDOW_TITLE
    $requestedProcessName = $env:AUVRYNT_INPUT_PROCESS_NAME
    $requestedWindowHandle = $env:AUVRYNT_INPUT_WINDOW_HANDLE
    $proc = $null
    if ($requestedWindowHandle) {
        try { $targetHandle = [IntPtr]([Int64]$requestedWindowHandle) }
        catch { throw "Target window handle '$requestedWindowHandle' is invalid." }
        if (-not [AuvryntDesktopInput]::IsWindow($targetHandle) -or -not [AuvryntDesktopInput]::IsWindowVisible($targetHandle)) {
            throw "Target window handle '$requestedWindowHandle' is not a visible top-level window."
        }
        [uint32]$targetProcessId = 0
        [AuvryntDesktopInput]::GetWindowThreadProcessId($targetHandle, [ref]$targetProcessId) | Out-Null
        $proc = Get-Process -Id ([int]$targetProcessId) -ErrorAction SilentlyContinue
        if (-not $proc) { throw "Target window handle '$requestedWindowHandle' has no running process." }
        $titleBuilder = New-Object System.Text.StringBuilder 512
        [AuvryntDesktopInput]::GetWindowText($targetHandle, $titleBuilder, $titleBuilder.Capacity) | Out-Null
        $actualTitle = $titleBuilder.ToString()
        if ($needle -and $actualTitle.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw "Target window title does not match '$needle'."
        }
        if ($requestedProcessName -and $proc.ProcessName -ine $requestedProcessName) {
            throw "Target window process '$($proc.ProcessName)' does not match '$requestedProcessName'."
        }
        if ([AuvryntDesktopInput]::IsIconic($targetHandle)) {
            throw "Target window '$actualTitle' is minimized; restore it before continuing."
        }
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
    if (-not $requestedWindowHandle -and -not $proc) { throw "Target window containing '$needle' was not found." }
    if (-not $requestedWindowHandle -and $requestedProcessName -and $proc.ProcessName -ine $requestedProcessName) {
        throw "Target window process '$($proc.ProcessName)' does not match '$requestedProcessName'."
    }
    if (-not $requestedWindowHandle -and $needle -and ([string]$proc.MainWindowTitle).IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Target window title does not match '$needle'."
    }
    if (-not $requestedWindowHandle -and [AuvryntDesktopInput]::IsIconic($proc.MainWindowHandle)) {
        throw "Target window '$($proc.MainWindowTitle)' is minimized; restore it before continuing."
    }

    $focusHandle = if ($requestedWindowHandle) { $targetHandle } else { $proc.MainWindowHandle }
    $focused = [AuvryntDesktopInput]::FocusWindow($focusHandle)
    if (-not $focused) { throw "Could not focus target window containing '$needle'." }
    Start-Sleep -Milliseconds 80
}

function Mouse-Flags([string]$button) {
    switch ($button) {
        'right' { return @(0x0008, 0x0010) }
        'middle' { return @(0x0020, 0x0040) }
        default { return @(0x0002, 0x0004) }
    }
}

$restoreForeground = [IntPtr]::Zero
if ($env:AUVRYNT_INPUT_FOCUS_POLICY -eq 'foreground-restore') {
    $restoreForeground = [AuvryntDesktopInput]::GetForegroundWindow()
}
try {
Focus-TargetWindow
$action = $env:AUVRYNT_INPUT_ACTION
if ($action -eq 'move') {
    if (-not [AuvryntDesktopInput]::SetCursorPos([int]$env:AUVRYNT_INPUT_X, [int]$env:AUVRYNT_INPUT_Y)) { throw 'SetCursorPos failed.' }
} elseif ($action -eq 'click') {
    if (-not [AuvryntDesktopInput]::SetCursorPos([int]$env:AUVRYNT_INPUT_X, [int]$env:AUVRYNT_INPUT_Y)) { throw 'SetCursorPos failed.' }
    $flags = Mouse-Flags $env:AUVRYNT_INPUT_BUTTON
    $count = [int]$env:AUVRYNT_INPUT_CLICK_COUNT
    for ($i = 0; $i -lt $count; $i++) {
        [AuvryntDesktopInput]::SendMouse([uint32]$flags[0], 0)
        [AuvryntDesktopInput]::SendMouse([uint32]$flags[1], 0)
        if ($i + 1 -lt $count) { Start-Sleep -Milliseconds 80 }
    }
} elseif ($action -eq 'click-key-press') {
    if (-not [AuvryntDesktopInput]::SetCursorPos([int]$env:AUVRYNT_INPUT_X, [int]$env:AUVRYNT_INPUT_Y)) { throw 'SetCursorPos failed.' }
    $flags = Mouse-Flags $env:AUVRYNT_INPUT_BUTTON
    $count = [int]$env:AUVRYNT_INPUT_CLICK_COUNT
    for ($i = 0; $i -lt $count; $i++) {
        [AuvryntDesktopInput]::SendMouse([uint32]$flags[0], 0)
        [AuvryntDesktopInput]::SendMouse([uint32]$flags[1], 0)
        if ($i + 1 -lt $count) { Start-Sleep -Milliseconds 80 }
    }
    Start-Sleep -Milliseconds 40
    $keys = @($env:AUVRYNT_INPUT_KEYS -split ',' | Where-Object { $_ }) | ForEach-Object { [int]$_ }
    foreach ($vk in $keys) { [AuvryntDesktopInput]::SendKey([uint16]$vk, $true) }
    [array]::Reverse($keys)
    foreach ($vk in $keys) { [AuvryntDesktopInput]::SendKey([uint16]$vk, $false) }
} elseif ($action -eq 'drag') {
    $startX = [int]$env:AUVRYNT_INPUT_X
    $startY = [int]$env:AUVRYNT_INPUT_Y
    $endX = [int]$env:AUVRYNT_INPUT_END_X
    $endY = [int]$env:AUVRYNT_INPUT_END_Y
    $duration = [int]$env:AUVRYNT_INPUT_DURATION
    $steps = [Math]::Max(1, [Math]::Min(120, [int][Math]::Ceiling($duration / 16.0)))
    $flags = Mouse-Flags $env:AUVRYNT_INPUT_BUTTON
    if (-not [AuvryntDesktopInput]::SetCursorPos($startX, $startY)) { throw 'SetCursorPos failed.' }
    [AuvryntDesktopInput]::SendMouse([uint32]$flags[0], 0)
    try {
        for ($i = 1; $i -le $steps; $i++) {
            $t = $i / [double]$steps
            $x = [int][Math]::Round($startX + (($endX - $startX) * $t))
            $y = [int][Math]::Round($startY + (($endY - $startY) * $t))
            if (-not [AuvryntDesktopInput]::SetCursorPos($x, $y)) { throw 'SetCursorPos failed during drag.' }
            if ($duration -gt 0) { Start-Sleep -Milliseconds ([Math]::Max(1, [int]($duration / $steps))) }
        }
    } finally {
        [AuvryntDesktopInput]::SendMouse([uint32]$flags[1], 0)
    }
} elseif ($action -eq 'scroll') {
    $dy = [int]$env:AUVRYNT_INPUT_DELTA_Y
    $dx = [int]$env:AUVRYNT_INPUT_DELTA_X
    if ($dy -ne 0) { [AuvryntDesktopInput]::SendMouse(0x0800, [uint32][int32]$dy) }
    if ($dx -ne 0) { [AuvryntDesktopInput]::SendMouse(0x01000, [uint32][int32]$dx) }
} elseif ($action -eq 'key-press' -or $action -eq 'key-down' -or $action -eq 'key-up') {
    $keys = @($env:AUVRYNT_INPUT_KEYS -split ',' | Where-Object { $_ }) | ForEach-Object { [int]$_ }
    if ($action -eq 'key-up') {
        foreach ($vk in $keys) { [AuvryntDesktopInput]::SendKey([uint16]$vk, $false) }
    } elseif ($action -eq 'key-down') {
        foreach ($vk in $keys) { [AuvryntDesktopInput]::SendKey([uint16]$vk, $true) }
    } else {
        foreach ($vk in $keys) { [AuvryntDesktopInput]::SendKey([uint16]$vk, $true) }
        [array]::Reverse($keys)
        foreach ($vk in $keys) { [AuvryntDesktopInput]::SendKey([uint16]$vk, $false) }
    }
} elseif ($action -eq 'type') {
    [AuvryntDesktopInput]::SendText($env:AUVRYNT_INPUT_TEXT)
} else {
    throw "Unsupported desktop input action '$action'."
}
} finally {
    if ($restoreForeground -ne [IntPtr]::Zero) {
        Start-Sleep -Milliseconds 40
        [AuvryntDesktopInput]::RestoreWindow($restoreForeground) | Out-Null
    }
}
`;

  const environment: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    ComSpec: process.env.ComSpec,
    AUVRYNT_INPUT_ACTION: command.action,
    AUVRYNT_INPUT_X: command.x === undefined ? "" : String(command.x),
    AUVRYNT_INPUT_Y: command.y === undefined ? "" : String(command.y),
    AUVRYNT_INPUT_END_X: command.endX === undefined ? "" : String(command.endX),
    AUVRYNT_INPUT_END_Y: command.endY === undefined ? "" : String(command.endY),
    AUVRYNT_INPUT_BUTTON: command.button ?? "left",
    AUVRYNT_INPUT_CLICK_COUNT: String(command.clickCount ?? 1),
    AUVRYNT_INPUT_DURATION: String(command.durationMs ?? 0),
    AUVRYNT_INPUT_DELTA_X: String(command.deltaX ?? 0),
    AUVRYNT_INPUT_DELTA_Y: String(command.deltaY ?? 0),
    AUVRYNT_INPUT_KEYS: command.virtualKeys?.join(",") ?? "",
    AUVRYNT_INPUT_TEXT: command.text ?? "",
    // Keep the caller's stable title query. A resolved Krita title can change
    // between target resolution and SendInput when a document becomes dirty;
    // handle + process identity remain the authoritative boundary.
    AUVRYNT_INPUT_WINDOW_TITLE: command.windowTitle ?? resolvedTarget?.title ?? "",
    AUVRYNT_INPUT_WINDOW_HANDLE: resolvedTarget?.handle ?? command.windowHandle ?? "",
    AUVRYNT_INPUT_PROCESS_NAME: resolvedTarget?.processName ?? command.processName ?? "",
    AUVRYNT_INPUT_FOCUS_POLICY: normalizeDesktopFocusPolicy(command.focusPolicy),
  };

  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: environment,
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 256 * 1024,
  });
}
