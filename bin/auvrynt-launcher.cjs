#!/usr/bin/env node

"use strict";

const { existsSync, readFileSync, realpathSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { dirname, join } = require("node:path");

const packageRoot = dirname(__dirname);
const cliPath = join(packageRoot, "dist", "cli.js");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function packageMetadata() {
  try {
    return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function isLocalCheckout() {
  return existsSync(join(packageRoot, "src"))
    && existsSync(join(packageRoot, "tsconfig.build.json"))
    && existsSync(join(packageRoot, "package-lock.json"));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  return result.error ? { status: 1, error: result.error } : { status: result.status ?? 1 };
}

function repairCli() {
  console.error("[auvrynt] CLI entrypoint is missing; attempting automatic repair...");

  if (isLocalCheckout()) {
    const checkoutRoot = realpathSync(packageRoot);
    console.error(`[auvrynt] Building the local checkout at ${checkoutRoot}.`);
    return run(npmCommand(), ["run", "build"]);
  }

  const metadata = packageMetadata();
  if (!metadata?.name) {
    return { status: 1, error: new Error("Package metadata is unavailable; reinstall Auvrynt manually.") };
  }
  const packageSpec = metadata.version ? `${metadata.name}@${metadata.version}` : metadata.name;
  console.error(`[auvrynt] Reinstalling ${packageSpec} globally.`);
  return run(npmCommand(), ["install", "--global", "--force", packageSpec]);
}

if (!existsSync(cliPath)) {
  const repair = repairCli();
  if (repair.status !== 0 || !existsSync(cliPath)) {
    const detail = repair.error instanceof Error ? ` ${repair.error.message}` : "";
    console.error(`[auvrynt] Automatic repair failed.${detail} Run 'npm install -g auvrynt' and try again.`);
    process.exit(1);
  }
  console.error("[auvrynt] CLI entrypoint repaired.");
}

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`[auvrynt] Could not start the CLI: ${result.error.message}`);
  process.exit(1);
}

process.exitCode = result.status ?? 1;
