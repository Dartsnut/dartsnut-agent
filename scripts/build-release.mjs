#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriRoot = path.join(repoRoot, "src-tauri");
const tauriConfigPath = path.join(tauriRoot, "tauri.conf.json");

const packageVersionFiles = [
  "package.json",
  "packages/emulator-protocol/package.json",
  "packages/desktop-contracts/package.json"
];

const exactSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function fail(message) {
  throw new Error(message);
}

function normalizePlatform(value) {
  const normalized = String(value || "").toLowerCase();
  if (["mac", "macos", "darwin"].includes(normalized)) return "mac";
  if (["win", "windows", "win32"].includes(normalized)) return "win";
  fail(`Unsupported platform: ${value}. Use mac or win.`);
}

export function parseArgs(argv, hostPlatform = process.platform) {
  let platform;
  let version;
  let envFile;
  const args = [...argv];

  if (args[0] === "--") args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--platform" || arg === "-p") {
      platform = normalizePlatform(args[++index] ?? fail("Missing value for --platform."));
      continue;
    }
    if (arg.startsWith("--platform=")) {
      platform = normalizePlatform(arg.slice("--platform=".length));
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      version = args[++index] ?? fail("Missing value for --version.");
      continue;
    }
    if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length);
      continue;
    }
    if (arg === "--env-file") {
      envFile = args[++index] ?? fail("Missing value for --env-file.");
      continue;
    }
    if (arg.startsWith("--env-file=")) {
      envFile = arg.slice("--env-file=".length);
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
    if (version === undefined) {
      version = arg;
      continue;
    }
    fail(`Unexpected argument: ${arg}`);
  }

  platform ??= hostPlatform === "darwin" ? "mac" : hostPlatform === "win32" ? "win" : undefined;
  if (!platform) fail("Platform required on this host. Use --platform mac or --platform win.");
  if (version !== undefined && !exactSemver.test(version)) {
    fail(`Invalid exact SemVer: ${version}`);
  }
  return { help: false, platform, version, envFile };
}

function printHelp() {
  console.log(`Build signed Tauri release artifacts.

Usage:
  pnpm run package:mac -- --version 1.7.5
  pnpm run package:win -- --version 1.7.5
  node scripts/build-release.mjs --platform mac|win [--version X.Y.Z]

Options:
  --platform, -p   mac or win (defaults to current host)
  --version, -v    exact SemVer; synchronizes package, Cargo, and Tauri versions
  --env-file       optional dotenv file override
`);
}

export function parseEnvFile(source) {
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

function findEnvFile(requested) {
  if (requested) {
    const resolved = path.resolve(repoRoot, requested);
    if (!fs.existsSync(resolved)) fail(`Env file not found: ${resolved}`);
    return resolved;
  }
  const candidate = path.join(repoRoot, ".env.release.local");
  if (!fs.existsSync(candidate)) fail(`Release env file not found: ${candidate}`);
  return candidate;
}

export function loadBuildEnv(platform, requestedEnvFile, processEnv = process.env) {
  const envFile = findEnvFile(requestedEnvFile);
  const fileEnv = envFile ? parseEnvFile(fs.readFileSync(envFile, "utf8")) : {};
  const env = { ...fileEnv, ...processEnv };

  if (!String(env.DARTSNUT_UPDATER_ENDPOINT || "").trim()) {
    fail("Missing DARTSNUT_UPDATER_ENDPOINT in release environment.");
  }

  const configuredPrivateKey = String(env.TAURI_SIGNING_PRIVATE_KEY || "").trim();
  const configuredPrivateKeyPath = String(env.TAURI_SIGNING_PRIVATE_KEY_PATH || "").trim();
  const privateKeyPathValue = configuredPrivateKeyPath || (
    configuredPrivateKey && fs.existsSync(resolveFromEnvFile(configuredPrivateKey, envFile))
      ? configuredPrivateKey
      : undefined
  );
  if (privateKeyPathValue) {
    const privateKeyPath = resolveFromEnvFile(privateKeyPathValue, envFile);
    if (!fs.existsSync(privateKeyPath)) fail(`Private key file not found: ${privateKeyPath}`);
    env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(privateKeyPath, "utf8").trim();
  } else if (configuredPrivateKey) {
    env.TAURI_SIGNING_PRIVATE_KEY = configuredPrivateKey;
  }
  if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    fail("Missing TAURI_SIGNING_PRIVATE_KEY. Set it to key content or set TAURI_SIGNING_PRIVATE_KEY_PATH.");
  }
  if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
  }

  const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
  const configPublicKey = normalizeBase64(String(tauriConfig.plugins?.updater?.pubkey || ""));
  if (!isBase64PublicKey(configPublicKey)) {
    fail("Updater public key missing or unresolved in src-tauri/tauri.conf.json.");
  }
  const configuredPublicKey = normalizeBase64(env.TAURI_SIGNING_PUBLIC_KEY);
  if (configuredPublicKey && configuredPublicKey !== configPublicKey) {
    fail("TAURI_SIGNING_PUBLIC_KEY does not match plugins.updater.pubkey in tauri.conf.json.");
  }
  env.TAURI_SIGNING_PUBLIC_KEY = configPublicKey;

  if (platform === "mac") {
    for (const key of [
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
      "APPLE_API_KEY",
      "APPLE_API_ISSUER",
      "APPLE_API_KEY_PATH",
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD"
    ]) delete env[key];
    const macIdentity = String(env.DARTSNUT_MACOS_SIGNING_IDENTITY || "").trim();
    if (!macIdentity) {
      fail("Missing DARTSNUT_MACOS_SIGNING_IDENTITY for macOS release.");
    }
    env.APPLE_SIGNING_IDENTITY = macIdentity;
  }

  return { env, envFile };
}

function isBase64PublicKey(value) {
  if (!value || value.startsWith("$") || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return decoded.startsWith("untrusted comment: minisign public key:");
}

function normalizeBase64(value) {
  return String(value || "").replace(/\s+/g, "");
}

function resolveFromEnvFile(value, envFile) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(envFile ? path.dirname(envFile) : repoRoot, value);
}

function readPackageVersions() {
  return packageVersionFiles.map((relativePath) => {
    const filePath = path.join(repoRoot, relativePath);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { relativePath, version: String(data.version || "") };
  });
}

function replaceJsonVersion(relativePath, version) {
  const filePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(source);
  if (data.version === version) return undefined;
  const versionPattern = /("version"\s*:\s*")[^"]+("\s*[,}])/;
  if (!versionPattern.test(source)) fail(`Could not find version in ${relativePath}.`);
  return {
    relativePath,
    filePath,
    contents: source.replace(versionPattern, `$1${version}$2`)
  };
}

export function synchronizeVersion(requestedVersion) {
  const manifests = readPackageVersions();
  const versions = new Set(manifests.map(({ version }) => version));
  if (requestedVersion === undefined && versions.size !== 1) {
    const details = manifests.map(({ relativePath, version }) => `${relativePath}=${version || "<missing>"}`).join(", ");
    fail(`Workspace package versions do not match: ${details}. Pass --version X.Y.Z to synchronize them.`);
  }
  const version = requestedVersion ?? manifests[0].version;
  if (!exactSemver.test(version)) fail(`Invalid exact SemVer: ${version}`);

  const writes = [];
  for (const relativePath of packageVersionFiles) {
    const write = replaceJsonVersion(relativePath, version);
    if (write) writes.push(write);
  }

  const cargoPath = path.join(tauriRoot, "Cargo.toml");
  const cargoSource = fs.readFileSync(cargoPath, "utf8");
  const cargoVersionPattern = /^(version\s*=\s*")[^"]+("\s*)$/m;
  if (!cargoVersionPattern.test(cargoSource)) {
    fail("Could not find package version in src-tauri/Cargo.toml.");
  }
  const cargoNext = cargoSource.replace(cargoVersionPattern, `$1${version}$2`);
  if (cargoNext !== cargoSource) {
    writes.push({
      relativePath: "src-tauri/Cargo.toml",
      filePath: cargoPath,
      contents: cargoNext
    });
  }

  const tauriConfigWrite = replaceJsonVersion("src-tauri/tauri.conf.json", version);
  if (tauriConfigWrite) writes.push(tauriConfigWrite);

  const cargoLockPath = path.join(tauriRoot, "Cargo.lock");
  if (fs.existsSync(cargoLockPath)) {
    const lockSource = fs.readFileSync(cargoLockPath, "utf8");
    const lockVersionPattern = /(\[\[package\]\]\r?\nname = "dartsnut-agent"\r?\nversion = ")[^"]+("\r?\n)/;
    if (!lockVersionPattern.test(lockSource)) {
      fail("Could not find dartsnut-agent package version in src-tauri/Cargo.lock.");
    }
    const lockNext = lockSource.replace(lockVersionPattern, `$1${version}$2`);
    if (lockNext !== lockSource) {
      writes.push({
        relativePath: "src-tauri/Cargo.lock",
        filePath: cargoLockPath,
        contents: lockNext
      });
    }
  }

  for (const write of writes) fs.writeFileSync(write.filePath, write.contents);
  const changed = writes.map(({ relativePath }) => relativePath);
  return { version, changed };
}

function assertHost(platform) {
  const expected = platform === "mac" ? "darwin" : "win32";
  if (process.platform !== expected) {
    fail(`${platform === "mac" ? "macOS" : "Windows"} release must run on ${expected}; current host is ${process.platform}.`);
  }
}

function assertMacIdentity(identity) {
  return new Promise((resolve, reject) => {
    const child = spawn("security", ["find-identity", "-v", "-p", "codesigning"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 || !output.includes(identity)) {
        reject(new Error(`Missing macOS signing identity: ${identity}`));
      } else {
        resolve();
      }
    });
  });
}

function commandName() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`));
    });
  });
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else files.push(filePath);
    }
  };
  visit(root);
  return files;
}

function verifyArtifacts(platform, version, buildStartedAt) {
  const target = platform === "mac" ? "aarch64-apple-darwin" : "x86_64-pc-windows-msvc";
  const bundleRoot = path.join(tauriRoot, "target", target, "release", "bundle");
  const freshFiles = walkFiles(bundleRoot).filter((filePath) => fs.statSync(filePath).mtimeMs >= buildStartedAt - 2000);
  const names = freshFiles.map((filePath) => path.basename(filePath));
  const findOne = (predicate, label) => {
    const matches = freshFiles.filter((filePath) => predicate(path.basename(filePath)));
    if (matches.length !== 1) {
      fail(`Expected one ${label} for ${platform} ${version}; found ${matches.length} under ${bundleRoot}.`);
    }
    return matches[0];
  };
  const installer = findOne(
    (name) => name.endsWith(platform === "mac" ? ".dmg" : ".exe") && name.includes(version),
    "release installer"
  );

  const updaterBinary = platform === "win"
    ? findOne(
      (name) => name.endsWith(".nsis.zip") || name === path.basename(installer),
      "updater payload"
    )
    : findOne((name) => name.endsWith(".app.tar.gz"), "updater payload");
  const signatureMatches = freshFiles.filter(
    (filePath) => path.basename(filePath) === `${path.basename(updaterBinary)}.sig`
  );
  if (signatureMatches.length !== 1) {
    fail(`Expected one updater signature for ${path.basename(updaterBinary)}; found ${signatureMatches.length}.`);
  }
  const signature = signatureMatches[0];

  const app = platform === "mac" ? path.join(bundleRoot, "macos", "Dartsnut Agent.app") : undefined;
  if (app && !fs.existsSync(app)) fail(`Signed macOS app not found: ${app}`);

  console.log("Release artifacts:");
  for (const filePath of [installer, updaterBinary, signature]) {
    console.log(`  ${path.relative(repoRoot, filePath)}`);
  }
  console.log(`  latest-${platform === "mac" ? "darwin" : "windows"}.json: generated during publish.`);
  console.log(`  files scanned: ${names.length}`);
  return { app };
}

async function verifyMacSignature(appPath, env) {
  await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], env);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  assertHost(options.platform);
  const { env, envFile } = loadBuildEnv(options.platform, options.envFile);
  if (options.platform === "mac") await assertMacIdentity(env.APPLE_SIGNING_IDENTITY);
  const { version, changed } = synchronizeVersion(options.version);
  if (changed.length) console.log(`Synchronized version ${version}: ${changed.join(", ")}`);
  console.log(`Building ${options.platform} release ${version}${envFile ? ` using ${path.relative(repoRoot, envFile)}` : ""}`);

  const buildStartedAt = Date.now();
  const pnpm = commandName();
  await run(
    pnpm,
    ["run", options.platform === "mac" ? "package:tauri:mac" : "package:tauri:win"],
    env
  );
  const artifacts = verifyArtifacts(options.platform, version, buildStartedAt);
  if (options.platform === "mac") await verifyMacSignature(artifacts.app, env);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Release build failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
