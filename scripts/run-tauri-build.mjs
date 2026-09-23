#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultEnvPath = path.join(repoRoot, ".env.release.local");
const LOCAL_BUILD_KEYS = [
  "DARTSNUT_UPDATER_ENDPOINT",
  "DARTSNUT_BASE_API",
  "DARTSNUT_GOOGLE_CLIENT_ID",
  "DARTSNUT_GOOGLE_DESKTOP_CLIENT_ID",
  "DARTSNUT_SUPABASE_URL",
  "DARTSNUT_SUPABASE_ANON_KEY",
  "DARTSNUT_SUPABASE_DEVICE_TABLE",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PATH",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "TAURI_SIGNING_PUBLIC_KEY",
  "DARTSNUT_MACOS_SIGNING_IDENTITY"
];

function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const equalsAt = line.indexOf("=");
    if (equalsAt <= 0) continue;
    const key = line.slice(0, equalsAt).trim();
    let value = line.slice(equalsAt + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function resolveFromEnvFile(value, envPath) {
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(envPath), value);
}

export function loadLocalBuildEnvironment(env = process.env, envPath = defaultEnvPath) {
  const merged = { ...env };
  const fileEnv = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, "utf8")) : {};
  for (const key of LOCAL_BUILD_KEYS) {
    if (merged[key] === undefined && fileEnv[key] !== undefined) merged[key] = fileEnv[key];
  }

  const configuredPrivateKey = String(merged.TAURI_SIGNING_PRIVATE_KEY || "").trim();
  const configuredPrivateKeyPath = String(merged.TAURI_SIGNING_PRIVATE_KEY_PATH || "").trim();
  const privateKeyPath = configuredPrivateKeyPath || (
    configuredPrivateKey && fs.existsSync(resolveFromEnvFile(configuredPrivateKey, envPath))
      ? configuredPrivateKey
      : undefined
  );
  if (privateKeyPath) {
    const keyPath = resolveFromEnvFile(privateKeyPath, envPath);
    if (!fs.existsSync(keyPath)) throw new Error(`Private key file not found: ${keyPath}`);
    merged.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(keyPath, "utf8").trim();
  }
  if (
    merged.APPLE_SIGNING_IDENTITY === undefined &&
    merged.DARTSNUT_MACOS_SIGNING_IDENTITY !== undefined
  ) {
    merged.APPLE_SIGNING_IDENTITY = merged.DARTSNUT_MACOS_SIGNING_IDENTITY;
  }
  return merged;
}

export function resolveUpdaterEndpoint(env = process.env, envPath = defaultEnvPath) {
  const configured = env.DARTSNUT_UPDATER_ENDPOINT ?? (
    fs.existsSync(envPath)
      ? parseEnvFile(fs.readFileSync(envPath, "utf8")).DARTSNUT_UPDATER_ENDPOINT
      : undefined
  );
  const endpoint = String(configured ?? "").trim();
  if (!endpoint) {
    throw new Error("Missing DARTSNUT_UPDATER_ENDPOINT; set it before running a release Tauri build.");
  }
  return endpoint;
}

export function updaterConfigOverride(endpoint) {
  return JSON.stringify({ plugins: { updater: { endpoints: [endpoint] } } });
}

function run() {
  let buildEnv;
  let endpoint;
  try {
    buildEnv = loadLocalBuildEnvironment();
    endpoint = resolveUpdaterEndpoint(buildEnv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  // Tauri does not substitute shell variables in JSON config. Append a final
  // concrete config layer so generate_context! embeds a valid updater endpoint.
  const tauriCli = path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const args = [tauriCli, "build", ...process.argv.slice(2), "--config", updaterConfigOverride(endpoint)];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: buildEnv,
    stdio: "inherit"
  });

  child.on("error", (error) => {
    console.error(`Unable to run Tauri build: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`Tauri build terminated by ${signal}`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) run();
