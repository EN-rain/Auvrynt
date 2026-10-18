import * as prompts from "@clack/prompts";
import { resolve } from "node:path";
import type { InstanceLockRecord, StartRequest, TunnelProvider } from "../../background-lifecycle.js";
import {
  fetchCloudflareTunnelToken,
  normalizeCloudflareAccountId,
  normalizeCloudflareTunnelId,
} from "../../tunnels/cloudflare-api-token.js";
import { normalizeNgrokUrl, tunnelProviderLabel } from "../../tunnels/tunnel-utils.js";
import { loadAuvryntFiles, writeAuvryntAuth, writeAuvryntConfig, type AuvryntUserConfig } from "../../user-config.js";

export interface ActiveInstance {
  stateDir: string;
  lockPath: string;
  record: InstanceLockRecord;
}

export interface TunnelCommandDependencies {
  readActiveInstance(): Promise<ActiveInstance | undefined>;
  restart(request: StartRequest, launchRoot: string, hard: boolean): Promise<void>;
}

export async function runTunnelCommand(dependencies: TunnelCommandDependencies): Promise<void> {
  const files = loadAuvryntFiles();
  const current: TunnelProvider = files.config.tunnelProvider ?? "cloudflare";

  prompts.intro("  Auvrynt tunnel provider  ");
  const picked = await prompts.select({
    message: `Select a tunnel provider  (current: ${tunnelProviderLabel(current)})`,
    options: [
      { value: "0", label: "0. Exit", hint: "make no changes" },
      { value: "1", label: "1. Cloudflare (CDN tunnel)", hint: current === "cloudflare" ? "current" : undefined },
      { value: "2", label: "2. ngrok", hint: current === "ngrok" ? "current" : undefined },
      { value: "3", label: "3. Custom external URL", hint: current === "custom" ? "current" : "for Cloudflare Named Tunnel or another external proxy" },
      { value: "4", label: "4. Cloudflare tunnel ID + API token", hint: "managed Named Tunnel; also requires account ID and HTTPS hostname" },
    ],
  });

  if (prompts.isCancel(picked) || picked === "0") {
    prompts.cancel("No changes made.");
    return;
  }

  const provider: TunnelProvider = picked === "2" ? "ngrok" : picked === "3" || picked === "4" ? "custom" : "cloudflare";
  const cloudflareTokenManaged = picked === "4";
  let publicBaseUrl = files.config.publicBaseUrl;
  let ngrokAuthtoken = files.config.ngrokAuthtoken;
  let ngrokUrl = files.config.ngrokUrl;
  let cloudflareTunnelToken = files.auth.cloudflareTunnelToken;

  if (picked === "3") {
    const answer = await prompts.text({
      message: "Cloudflare Named Tunnel token (leave blank to manage the tunnel externally)",
      placeholder: "paste the tunnel token from Cloudflare, or press Enter to skip",
      initialValue: "",
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    const trimmed = String(answer).trim();
    if (trimmed) cloudflareTunnelToken = trimmed;
  }

  if (cloudflareTokenManaged) {
    const accountAnswer = await prompts.text({
      message: "Cloudflare account ID (32 hexadecimal characters)",
      validate: (value) => {
        try { normalizeCloudflareAccountId(String(value)); return undefined; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      },
    });
    if (prompts.isCancel(accountAnswer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    const tunnelAnswer = await prompts.text({
      message: "Cloudflare Named Tunnel ID (UUID)",
      validate: (value) => {
        try { normalizeCloudflareTunnelId(String(value)); return undefined; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      },
    });
    if (prompts.isCancel(tunnelAnswer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    const apiTokenAnswer = await prompts.password({
      message: "Cloudflare API token (hidden input; never saved)",
      validate: (value) => String(value).trim().length >= 16 ? undefined : "Enter your Cloudflare API token.",
    });
    if (prompts.isCancel(apiTokenAnswer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    cloudflareTunnelToken = await fetchCloudflareTunnelToken(
      String(accountAnswer), String(tunnelAnswer), String(apiTokenAnswer),
    );
    prompts.log.success("Connector token retrieved. Your Cloudflare API token was not saved.");
  }

  if (provider === "ngrok" && !ngrokAuthtoken && !process.env.AUVRYNT_NGROK_AUTHTOKEN) {
    const answer = await prompts.text({
      message: "ngrok authtoken (leave blank if already set via `ngrok config add-authtoken`)",
      placeholder: "paste your ngrok authtoken, or press Enter to skip",
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    const trimmed = String(answer).trim();
    if (trimmed) ngrokAuthtoken = trimmed;
  }

  if (provider === "ngrok") {
    const answer = await prompts.text({
      message: "Stable ngrok HTTPS URL (optional; leave blank for an assigned URL)",
      placeholder: "https://your-name.ngrok.app",
      initialValue: ngrokUrl ?? "",
      validate: (value) => {
        try {
          normalizeNgrokUrl(String(value));
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    ngrokUrl = normalizeNgrokUrl(String(answer));
  }

  if (provider === "custom") {
    const answer = await prompts.text({
      message: "External HTTPS base URL (without /mcp)",
      placeholder: "https://mcp.example.com",
      initialValue: publicBaseUrl ?? "",
      validate: (value) => {
        try {
          const parsed = new URL(String(value).trim());
          if (parsed.protocol !== "https:") return "Custom public URL must use HTTPS.";
          if (parsed.pathname !== "/" || parsed.search || parsed.hash) return "Enter the origin only, without /mcp or another path.";
          return undefined;
        } catch {
          return "Enter a valid HTTPS URL.";
        }
      },
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    publicBaseUrl = new URL(String(answer).trim()).origin;
  }

  const nextConfig: AuvryntUserConfig = {
    ...files.config, tunnelProvider: provider, publicBaseUrl, cloudflareTokenManaged,
  };
  if (ngrokAuthtoken) nextConfig.ngrokAuthtoken = ngrokAuthtoken;
  else delete nextConfig.ngrokAuthtoken;
  if (ngrokUrl) nextConfig.ngrokUrl = ngrokUrl;
  else delete nextConfig.ngrokUrl;
  writeAuvryntConfig(nextConfig);
  writeAuvryntAuth({ ...files.auth, ...(cloudflareTunnelToken ? { cloudflareTunnelToken } : {}) });

  prompts.note(`Tunnel provider set to ${tunnelProviderLabel(provider)}.`, "Saved to ~/.auvrynt/config.json");

  const active = await dependencies.readActiveInstance();
  if (active) {
    const restart = await prompts.confirm({
      message: "Auvrynt is currently running. Restart it now to switch the live tunnel?",
      initialValue: true,
    });
    if (!prompts.isCancel(restart) && restart) {
      await dependencies.restart(
        { replace: true, backgroundChild: false },
        active.record.launchRoot ?? resolve(process.cwd()),
        true,
      );
      prompts.outro(`Restarted with the ${tunnelProviderLabel(provider)} tunnel.`);
      return;
    }
    prompts.outro("Run `auvrynt restart hard` when you're ready to apply this.");
    return;
  }

  prompts.outro("Run `auvrynt start` to launch with the new tunnel provider.");
}
