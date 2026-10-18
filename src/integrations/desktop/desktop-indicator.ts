import { spawn, type ChildProcess } from "node:child_process";

const indicators = new Map<string, ChildProcess>();

export function buildDesktopIndicatorScript(): string {
  return String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$context = New-Object System.Windows.Forms.ApplicationContext
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = 'Auvrynt Desktop Control'
$notifyIcon.Visible = $true
try {
    [System.Windows.Forms.Application]::Run($context)
} finally {
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    $context.Dispose()
}
`;
}

export function ensureDesktopIndicator(workspaceId: string): void {
  if (process.platform !== "win32") return;
  const existing = indicators.get(workspaceId);
  if (existing && existing.exitCode === null && !existing.killed) return;

  const script = buildDesktopIndicatorScript();

  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "ignore",
    windowsHide: true,
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      ComSpec: process.env.ComSpec,
    },
  });
  child.once("exit", () => {
    if (indicators.get(workspaceId) === child) indicators.delete(workspaceId);
  });
  indicators.set(workspaceId, child);
}

export function stopDesktopIndicator(workspaceId: string): void {
  const child = indicators.get(workspaceId);
  indicators.delete(workspaceId);
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill();
}

export function stopAllDesktopIndicators(): void {
  for (const workspaceId of indicators.keys()) stopDesktopIndicator(workspaceId);
}

export function desktopIndicatorActive(workspaceId: string): boolean {
  const child = indicators.get(workspaceId);
  return Boolean(child && child.exitCode === null && !child.killed);
}
