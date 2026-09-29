#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveUpdaterEndpoint, updaterConfigOverride } from "./run-tauri-build.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function run() {
  let endpoint;
  try {
    endpoint = resolveUpdaterEndpoint();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const tauriCli = path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const args = [tauriCli, "dev", ...process.argv.slice(2), "--config", updaterConfigOverride(endpoint)];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });

  child.on("error", (error) => {
    console.error(`Unable to run Tauri dev: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`Tauri dev terminated by ${signal}`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) run();
