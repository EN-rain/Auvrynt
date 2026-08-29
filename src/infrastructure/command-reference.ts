export interface AuvryntCommandReference {
  command: string;
  description: string;
}

export const AUVRYNT_COMMANDS: readonly AuvryntCommandReference[] = [
  { command: "auvrynt", description: "Run first-time setup if needed, then start the server." },
  { command: "auvrynt start", description: "Start Auvrynt with all integrations disabled by default." },
  { command: "auvrynt start blender", description: "Start Blender MCP detection only." },
  { command: "auvrynt start web", description: "Start Playwright/browser tools only." },
  { command: "auvrynt start godotcs", description: "Start Godot C# only." },
  { command: "auvrynt start godotgd", description: "Start Godot GDScript only." },
  { command: "auvrynt start se", description: "Start Serena only." },
  { command: "auvrynt start web,blender", description: "Start multiple integrations together." },
  { command: "auvrynt start ... --replace", description: "Replace active profiles or change the managed workspace." },
  { command: "auvrynt add web", description: "Add profiles live without restarting the server or tunnel." },
  { command: "auvrynt change", description: "Switch the running workspace to the current directory." },
  { command: "auvrynt stop", description: "Stop Auvrynt and, on Windows custom mode, the cloudflared service." },
  { command: "auvrynt tunnel", description: "Switch between Cloudflare, ngrok, or a custom Cloudflare Named Tunnel." },
  { command: "auvrynt restart [combo]", description: "Restart only Auvrynt while keeping the current tunnel URL." },
  { command: "auvrynt restart hard", description: "Stop and start Auvrynt plus its managed tunnel." },
  { command: "auvrynt serve", description: "Start the server in the foreground with verbose console logs." },
  { command: "auvrynt init", description: "Create or update ~/.auvrynt/config.json and auth.json." },
  { command: "auvrynt setup", description: "Configure executable paths for local tools." },
  { command: "auvrynt enable", description: "Enable or disable integrations one by one." },
  { command: "auvrynt disable", description: "Select enabled integrations to disable." },
  { command: "auvrynt doctor", description: "Show configuration, runtime, and native dependency status." },
  { command: "auvrynt status", description: "Show local MCP, tunnel, and integration connection status." },
  { command: "auvrynt connected", description: "Show recently connected MCP and web-agent providers." },
  { command: "auvrynt token", description: "Print the owner token for authentication on explicit local request." },
  { command: "auvrynt token reset", description: "Generate and save a new owner token." },
  { command: "auvrynt uninstall", description: "Remove Auvrynt configuration after confirmation." },
  { command: "auvrynt uninstall -y", description: "Remove Auvrynt configuration without confirmation." },
  { command: "auvrynt config get", description: "Print the persisted configuration." },
  { command: "auvrynt config set publicBaseUrl <url|null>", description: "Set or clear the public base URL." },
  { command: "AUVRYNT_PUBLIC_BASE_URL=https://example.com auvrynt serve", description: "Run a foreground server with a custom public tunnel URL." },
] as const;
