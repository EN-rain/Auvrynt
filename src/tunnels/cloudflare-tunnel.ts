import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isProcessRunning } from "../background-lifecycle.js";
import type { TunnelProcess } from "./tunnel-types.js";
import { findCommand } from "./tunnel-utils.js";

const MANAGED_CLOUDFLARED_VERSION = "2026.7.2";
const CLOUDFLARE_URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
const MAX_STARTUP_OUTPUT_BYTES = 1024 * 1024;

export function extractCloudflarePublicUrl(output: string): string | undefined {
  return output.match(CLOUDFLARE_URL_PATTERN)?.[0];
}

async function installWindowsCloudflared(): Promise<string> {
  const targetDir = join(homedir(), ".auvrynt", "bin");
  const executable = join(targetDir, "cloudflared.exe");
  const artifact = process.arch === "arm64"
    ? "cloudflared-windows-arm64.exe"
    : process.arch === "ia32"
      ? "cloudflared-windows-386.exe"
      : "cloudflared-windows-amd64.exe";
  const releaseUrl = `https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${MANAGED_CLOUDFLARED_VERSION}`;

  console.log(`cloudflared is not installed; downloading verified ${MANAGED_CLOUDFLARED_VERSION}...`);
  const releaseResponse = await fetch(releaseUrl, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "auvrynt-cloudflared-installer" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!releaseResponse.ok) throw new Error(`Could not load cloudflared release metadata (HTTP ${releaseResponse.status}).`);
  const release = await releaseResponse.json() as {
    tag_name?: unknown;
    assets?: Array<{ name?: unknown; browser_download_url?: unknown; digest?: unknown }>;
  };
  if (release.tag_name !== MANAGED_CLOUDFLARED_VERSION || !Array.isArray(release.assets)) {
    throw new Error("Cloudflared release metadata did not match the pinned release.");
  }
  const asset = release.assets.find((candidate) => candidate.name === artifact);
  if (!asset || typeof asset.browser_download_url !== "string" || typeof asset.digest !== "string") {
    throw new Error(`Cloudflared release ${MANAGED_CLOUDFLARED_VERSION} is missing ${artifact} or its SHA-256 digest.`);
  }
  const expectedPrefix = `https://github.com/cloudflare/cloudflared/releases/download/${MANAGED_CLOUDFLARED_VERSION}/`;
  if (!asset.browser_download_url.startsWith(expectedPrefix) || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) {
    throw new Error("Cloudflared release asset metadata failed origin/digest validation.");
  }

  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Could not download cloudflared (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  const expectedDigest = asset.digest.slice("sha256:".length).toLowerCase();
  if (actualDigest !== expectedDigest) {
    throw new Error("Cloudflared SHA-256 verification failed; the downloaded binary was not installed.");
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(executable, bytes, { mode: 0o755 });
  execFileSync(executable, ["--version"], { stdio: "ignore", windowsHide: true });
  return executable;
}

async function resolveCloudflaredExecutable(): Promise<string> {
  const found = findCommand("cloudflared");
  if (found) return found;
  if (process.platform === "win32") {
    const managedExecutable = join(homedir(), ".auvrynt", "bin", "cloudflared.exe");
    if (existsSync(managedExecutable)) {
      try {
        execFileSync(managedExecutable, ["--version"], { stdio: "ignore", windowsHide: true });
        return managedExecutable;
      } catch {
        // A partial or corrupt managed binary is replaced by the verified installer.
      }
    }
    return installWindowsCloudflared();
  }
  throw new Error(
    "cloudflared is required for `auvrynt start`. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/.",
  );
}

export async function loginCloudflareAccount(certPath: string): Promise<void> {
  const executable = await resolveCloudflaredExecutable();
  await mkdir(dirname(certPath), { recursive: true, mode: 0o700 });
  const defaultCertPath = join(homedir(), ".cloudflared", "cert.pem");
  const sameAsDefault = defaultCertPath.toLowerCase() === certPath.toLowerCase();
  const suffix = `.auvrynt-login-backup-${process.pid}-${Date.now()}`;
  const defaultBackupPath = `${defaultCertPath}${suffix}`;
  const profileBackupPath = `${certPath}${suffix}`;
  const hadDefaultCertificate = !sameAsDefault && existsSync(defaultCertPath);
  const hadProfileCertificate = !sameAsDefault && existsSync(certPath);
  let defaultMoved = false;
  let profileMoved = false;
  let completed = false;

  try {
    if (hadDefaultCertificate) {
      await rename(defaultCertPath, defaultBackupPath);
      defaultMoved = true;
    }
    if (hadProfileCertificate) {
      await rename(certPath, profileBackupPath);
      profileMoved = true;
    }
    await runCloudflareLoginProcess(executable, certPath);
    if (!existsSync(certPath) && existsSync(defaultCertPath)) await copyFile(defaultCertPath, certPath);
    if (!existsSync(certPath)) throw new Error("Cloudflare login completed without creating the account certificate.");
    completed = true;
  } finally {
    if (!sameAsDefault && existsSync(defaultCertPath) && (defaultMoved || !hadDefaultCertificate)) await unlink(defaultCertPath);
    if (defaultMoved) await rename(defaultBackupPath, defaultCertPath);
    if (profileMoved) {
      if (completed) await unlink(profileBackupPath);
      else if (!existsSync(certPath)) await rename(profileBackupPath, certPath);
    }
  }
}

async function runCloudflareLoginProcess(executable: string, certPath: string): Promise<void> {
  await new Promise<void>((resolveLogin, rejectLogin) => {
    const child = spawn(executable, ["--origincert", certPath, "tunnel", "login"], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectLogin);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        rejectLogin(new Error(`Cloudflare browser login did not complete${signal ? ` (signal ${signal})` : ` (exit code ${code ?? "unknown"})`}.`));
        return;
      }
      resolveLogin();
    });
  });
}

export async function startCloudflareTunnel(
  port: number,
  options: { detached?: boolean; logPath?: string; cloudflareTunnelToken?: string; publicUrl?: string } = {},
): Promise<TunnelProcess> {
  const executable = await resolveCloudflaredExecutable();
  const args = options.cloudflareTunnelToken
    ? ["tunnel", "--no-autoupdate", "run"]
    : ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`];

  if (options.cloudflareTunnelToken && !options.publicUrl) {
    throw new Error("A public URL is required when starting a Cloudflare Named Tunnel.");
  }

  if (options.cloudflareTunnelToken) {
    let stdio: any = ["ignore", "pipe", "pipe"];
    let logHandle: number | undefined;
    if (options.detached && options.logPath) {
      await writeFile(options.logPath, "", { mode: 0o600 });
      logHandle = openSync(options.logPath, "a");
      stdio = ["ignore", logHandle, logHandle];
    }
    const child = spawn(executable, args, {
      stdio,
      windowsHide: true,
      detached: options.detached,
      env: { ...process.env, TUNNEL_TOKEN: options.cloudflareTunnelToken },
    });
    if (logHandle !== undefined) closeSync(logHandle);
    try {
      const deadline = Date.now() + (options.logPath ? 30_000 : 1_500);
      let registered = !options.logPath;
      while (Date.now() < deadline) {
        if (!child.pid || !isProcessRunning(child.pid)) throw new Error("Cloudflare Named Tunnel exited before connecting.");
        if (options.logPath) {
          const output = await readFile(options.logPath, "utf8").catch(() => "");
          if (Buffer.byteLength(output, "utf8") > MAX_STARTUP_OUTPUT_BYTES) {
            throw new Error("Cloudflare Named Tunnel startup output exceeded 1 MB before registering.");
          }
          registered = /Registered tunnel connection/i.test(output);
        }
        if (registered) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
      if (!registered) throw new Error("Cloudflare Named Tunnel did not register with Cloudflare within 30 seconds.");
      if (options.detached) child.unref();
      return { process: child, url: options.publicUrl! };
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  if (options.detached && options.logPath) {
    await writeFile(options.logPath, "", { mode: 0o600 });
    const logHandle = openSync(options.logPath, "a");
    const child = spawn(executable, args, {
      stdio: ["ignore", logHandle, logHandle],
      windowsHide: true,
      detached: true,
    });
    closeSync(logHandle);
    let spawnError: Error | undefined;
    child.once("error", (error) => { spawnError = error; });
    const deadline = Date.now() + 90_000;
    try {
      while (Date.now() < deadline) {
        if (spawnError) throw new Error(`Cloudflare tunnel failed to start: ${spawnError.message}`);
        if (!child.pid || !isProcessRunning(child.pid)) throw new Error("Cloudflare tunnel exited before connecting.");
        const output = await readFile(options.logPath, "utf8").catch(() => "");
        if (Buffer.byteLength(output, "utf8") > MAX_STARTUP_OUTPUT_BYTES) {
          throw new Error("Cloudflare tunnel startup output exceeded 1 MB before providing a public URL.");
        }
        const url = extractCloudflarePublicUrl(output);
        if (url) {
          child.unref();
          return { process: child, url };
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
      throw new Error("Cloudflare tunnel did not provide a public URL within 90 seconds.");
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  const child = spawn(executable, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: options.detached,
  });
  const tunnelUrl = await new Promise<string>((resolveUrl, reject) => {
    let output = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onOutput);
      child.stderr?.off("data", onOutput);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error("Cloudflare tunnel did not provide a public URL within 30 seconds."));
    }, 30_000);
    const onOutput = (chunk: Buffer | string) => {
      if (settled) return;
      output += chunk.toString();
      if (Buffer.byteLength(output, "utf8") > MAX_STARTUP_OUTPUT_BYTES) {
        child.kill();
        fail(new Error("Cloudflare tunnel startup output exceeded 1 MB before providing a public URL."));
        return;
      }
      const url = extractCloudflarePublicUrl(output);
      if (url) {
        settled = true;
        cleanup();
        resolveUrl(url);
      }
    };
    const onError = (error: Error) => fail(new Error(`Cloudflare tunnel failed to start: ${error.message}`));
    const onExit = (code: number | null) => {
      if (code !== null) fail(new Error(`Cloudflare tunnel exited before connecting (code ${code}).`));
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.once("error", onError);
    child.once("exit", onExit);
  });

  return { process: child, url: tunnelUrl };
}
