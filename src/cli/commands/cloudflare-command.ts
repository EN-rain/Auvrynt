import * as prompts from "@clack/prompts";
import { existsSync } from "node:fs";
import { loadAuvryntFiles, writeAuvryntAuth } from "../../infrastructure/user-config.js";
import { loginCloudflareAccount } from "../../tunnels/cloudflare-tunnel.js";
import {
  cloudflareProfileCertPath,
  normalizeCloudflareProfileName,
  selectCloudflareProfile,
  upsertCloudflareProfile,
} from "../../tunnels/cloudflare-profiles.js";

export async function runCloudflareCommand(args: string[]): Promise<void> {
  const action = args[0]?.toLowerCase() ?? "login";
  if (args.length > 1 && action !== "select") {
    throw new Error("Usage: auvrynt cloudflare login|list|select [profile]");
  }

  if (action === "list") {
    const profiles = loadAuvryntFiles().auth.cloudflareProfiles ?? [];
    if (!profiles.length) {
      prompts.log.info("No local Cloudflare account profiles configured.");
      return;
    }
    for (const profile of profiles) {
      const active = loadAuvryntFiles().auth.cloudflareActiveProfile === profile.name ? "active" : "available";
      prompts.log.info(`${profile.name}: ${active}, certificate ${existsSync(profile.certPath) ? "present" : "missing"}`);
    }
    return;
  }

  if (action === "select") {
    const files = loadAuvryntFiles();
    const profiles = files.auth.cloudflareProfiles ?? [];
    if (!profiles.length) throw new Error("No local Cloudflare profiles configured. Run `auvrynt cloudflare login` first.");
    const selected = args[1]
      ? normalizeCloudflareProfileName(args[1])
      : await selectProfileInteractively(profiles.map((profile) => profile.name), files.auth.cloudflareActiveProfile);
    if (!selected) return;
    writeAuvryntAuth(selectCloudflareProfile(files.auth, selected));
    prompts.log.success(`Selected local Cloudflare profile '${selected}'.`);
    return;
  }

  if (action !== "login") throw new Error("Usage: auvrynt cloudflare login|list|select [profile]");

  const files = loadAuvryntFiles();
  const profileAnswer = await prompts.text({
    message: "Local Cloudflare profile name",
    placeholder: "account-a or account-b",
    validate: (value) => {
      try {
        normalizeCloudflareProfileName(String(value));
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });
  if (prompts.isCancel(profileAnswer)) {
    prompts.cancel("Cloudflare login cancelled.");
    return;
  }
  const profileName = normalizeCloudflareProfileName(String(profileAnswer));
  const existing = (files.auth.cloudflareProfiles ?? []).some((profile) => profile.name === profileName);
  if (existing) {
    const replace = await prompts.confirm({ message: `Replace the saved certificate for '${profileName}'?`, initialValue: false });
    if (prompts.isCancel(replace) || !replace) {
      prompts.cancel("Cloudflare login cancelled.");
      return;
    }
  }

  const certPath = cloudflareProfileCertPath(profileName);
  prompts.note([
    `A browser window will open for Cloudflare profile '${profileName}'.`,
    "Complete the Cloudflare login manually and select the intended zone.",
    "The account certificate is saved only under the private Auvrynt directory.",
  ].join("\n"), "Cloudflare authentication required");
  await loginCloudflareAccount(certPath);
  writeAuvryntAuth(upsertCloudflareProfile(files.auth, profileName, certPath));
  prompts.log.success(`Saved local Cloudflare profile '${profileName}'. Run this command again with a different name for the second account.`);
}

async function selectProfileInteractively(names: string[], active?: string): Promise<string | undefined> {
  const answer = await prompts.select({
    message: "Select the active local Cloudflare profile",
    initialValue: active,
    options: names.map((name) => ({ value: name, label: name, hint: name === active ? "active" : undefined })),
  });
  if (prompts.isCancel(answer)) {
    prompts.cancel("No Cloudflare profile selected.");
    return undefined;
  }
  return String(answer);
}
