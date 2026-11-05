#!/usr/bin/env node

// Regenerate the vendored Scratch editor bundle from the pin in
// scripts/scratch-gui.pin.json. The built bundle is never committed: it lands in
// public/editor, which is gitignored and copied verbatim into dist by Vite.
//
// The bundle is a self-contained React 16 app and must stay isolated from cero's
// React 18 tree — it is only ever loaded in a same-origin iframe.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export const PIN_PATH = path.join(repoRoot, "scripts", "scratch-gui.pin.json");

/** Files webpack emits that we deliberately do not ship. */
export const DROPPED_ENTRYPOINTS = [
  "player.html",
  "blocks-only.html",
  "compatibility-testing.html",
  // Upstream's own GUI document. The bridge entry supersedes it: ours is the one
  // that answers the host, and shipping both invites loading the wrong one.
  "index.html"
];

export function readPin(pinPath = PIN_PATH) {
  const pin = JSON.parse(fs.readFileSync(pinPath, "utf8"));
  for (const key of ["version", "tag", "repository", "commit", "entrypoint", "output", "url"]) {
    if (typeof pin[key] !== "string" || pin[key] === "") {
      throw new Error(`scratch-gui pin is missing "${key}" (${pinPath})`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) {
    throw new Error(`scratch-gui pin has a non-resolved commit: ${pin.commit}`);
  }
  return pin;
}

export function outputDir(pin, root = repoRoot) {
  return path.join(root, pin.output);
}

export function stampPath(pin, root = repoRoot) {
  return path.join(outputDir(pin, root), ".pin.json");
}

export function stampFor(pin) {
  return {
    package: pin.package,
    version: pin.version,
    commit: pin.commit,
    lockfileSha256: pin.lockfileSha256,
    entrypoint: pin.entrypoint
  };
}

/** True when the on-disk bundle was built from exactly this pin. */
export function isUpToDate(pin, root = repoRoot) {
  if (!pin.lockfileSha256) return false;
  const entry = path.join(outputDir(pin, root), pin.entrypoint);
  const stampFile = stampPath(pin, root);
  if (!fs.existsSync(entry) || !fs.existsSync(stampFile)) return false;
  let recorded;
  try {
    recorded = JSON.parse(fs.readFileSync(stampFile, "utf8"));
  } catch {
    return false;
  }
  const expected = stampFor(pin);
  return Object.keys(expected).every((key) => recorded[key] === expected[key]);
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Keep gui.html plus runtime assets; drop the other entrypoints and source maps. */
export function shouldShip(relativePath) {
  if (relativePath.endsWith(".map")) return false;
  if (DROPPED_ENTRYPOINTS.includes(relativePath)) return false;
  return true;
}

export function listShippableFiles(buildDir) {
  const kept = [];
  const walk = (relative) => {
    const absolute = path.join(buildDir, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(childRelative);
      } else if (entry.isFile() && shouldShip(childRelative)) {
        kept.push(childRelative);
      }
    }
  };
  walk("");
  return kept.sort();
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`);
  }
}

function cloneUpstream(pin, checkoutDir) {
  fs.rmSync(checkoutDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(checkoutDir), { recursive: true });
  // Depth 1 at the tag keeps the download small; the commit check below is what
  // actually enforces the pin, so a moved tag still fails loudly.
  run("git", ["clone", "--depth", "1", "--branch", pin.tag, pin.repository, checkoutDir]);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: checkoutDir, encoding: "utf8" });
  const actual = (head.stdout || "").trim();
  if (actual !== pin.commit) {
    throw new Error(`Upstream ${pin.tag} resolved to ${actual}, but the pin records ${pin.commit}.`);
  }
  const lockfilePath = path.join(checkoutDir, "package-lock.json");
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`Upstream ${pin.tag} has no package-lock.json; refusing an unpinned dependency tree.`);
  }
  const lockfileSha256 = sha256File(lockfilePath);
  if (pin.lockfileSha256 && lockfileSha256 !== pin.lockfileSha256) {
    throw new Error(
      `Lockfile hash drift: upstream lockfile is ${lockfileSha256}, pin records ${pin.lockfileSha256}.`
    );
  }
  return lockfileSha256;
}

/**
 * Copy the bridge files into the checkout.
 *
 * They are additions, never edits: the bridge composes upstream modules the way
 * upstream's own playground does, so no upstream file needs touching. That is
 * what lets the pin stay honest about conveying the editor unmodified.
 */
export function installBridge(pin, checkoutDir, sourceDir) {
  const bridge = pin.bridge;
  if (!bridge) {
    throw new Error("scratch-gui pin has no bridge entry; the editor would never answer the host.");
  }
  for (const fileName of [bridge.entrypoint, bridge.config]) {
    const from = path.join(sourceDir, fileName);
    if (!fs.existsSync(from)) {
      throw new Error(`bridge source is missing: ${from}`);
    }
    fs.copyFileSync(from, path.join(checkoutDir, fileName));
  }
  return [bridge.entrypoint, bridge.config];
}

/**
 * Files upstream generates with `prepublish`, pinned instead.
 *
 * Upstream's `prepublish` downloads a microbit archive from scratch.mit.edu to
 * produce these two, and both land in gitignored paths, so a fresh clone has
 * neither. Fetching them on every regeneration makes the build depend on a
 * third-party HTTP endpoint for an artifact that has not changed since 1.2.0.
 * They are committed beside the bridge patch and copied into place.
 */
export const PINNED_GENERATED_SOURCES = [
  { from: "microbit/microbit-hex-url.cjs", to: "src/generated/microbit-hex-url.cjs" },
  { from: "microbit/scratch-microbit-1.2.0.hex", to: "static/microbit/scratch-microbit-1.2.0.hex" }
];

/** Copy the pinned generated sources into the checkout. */
export function installGeneratedSources(pin, checkoutDir, sourceDir) {
  for (const { from, to } of PINNED_GENERATED_SOURCES) {
    const source = path.join(sourceDir, from);
    if (!fs.existsSync(source)) {
      throw new Error(`pinned generated source is missing: ${source}`);
    }
    const target = path.join(checkoutDir, to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

/**
 * Refuse to build if the checkout has any modified tracked file.
 *
 * The bridge is only allowed to add. If a future pin needs us to patch upstream,
 * this fails loudly rather than shipping an editor we describe as unmodified.
 */
export function assertUpstreamUnmodified(checkoutDir) {
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: checkoutDir,
    encoding: "utf8"
  });
  if (status.error) throw status.error;
  const modified = (status.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .filter((line) => !line.startsWith("??"))
    .filter((line) => !line.includes("node_modules"));
  if (modified.length > 0) {
    throw new Error(
      `the bridge must only add files to the checkout, but these upstream files were modified: ${modified.join(", ")}`
    );
  }
}

function copyBundle(pin, buildDir, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  let copied = 0;
  for (const relative of listShippableFiles(buildDir)) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(buildDir, relative), target);
    copied += 1;
  }
  if (!fs.existsSync(path.join(destination, pin.entrypoint))) {
    throw new Error(`Build did not produce ${pin.entrypoint}; nothing to serve.`);
  }
  return copied;
}

function build(pin) {
  if (!pin.lockfileSha256) {
    throw new Error(
      "scratch-gui pin has no lockfileSha256. Run `node scripts/build-editor-bundle.mjs --write-lockfile-hash` " +
        "against the pinned commit and commit the result."
    );
  }

  const checkoutDir = path.join(os.homedir(), ".cache", "dartsnut", "scratch-gui", pin.commit);
  const buildDir = path.join(checkoutDir, "build");
  const destination = outputDir(pin);
  const bridgeSourceDir = path.join(repoRoot, pin.bridge.sourceDir);

  console.log(`[editor-bundle] fetching ${pin.package} ${pin.version} (${pin.commit.slice(0, 8)})`);
  cloneUpstream(pin, checkoutDir);

  console.log(`[editor-bundle] npm ci`);
  run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: checkoutDir });

  // `npm ci` does not run upstream's `prepublish`, which downloads a microbit
  // archive and generates two files webpack requires. Both are gitignored
  // upstream, so a fresh clone never has them, and the download is a network
  // dependency the build should not carry. They are pinned in the patch
  // directory instead, byte for byte, and installed below.
  console.log(`[editor-bundle] installing pinned generated sources`);
  installGeneratedSources(pin, checkoutDir, bridgeSourceDir);

  console.log(`[editor-bundle] building with webpack`);
  run("npm", ["run", "build"], { cwd: checkoutDir });

  console.log(`[editor-bundle] adding the bridge entry`);
  installBridge(pin, checkoutDir, bridgeSourceDir);
  run("npx", ["webpack", "--config", pin.bridge.config], { cwd: checkoutDir });

  // Checked after both builds: this is the claim the notices file makes, so it is
  // verified on every regeneration rather than trusted.
  assertUpstreamUnmodified(checkoutDir);

  const copied = copyBundle(pin, buildDir, destination);
  fs.writeFileSync(stampPath(pin), `${JSON.stringify(stampFor(pin), null, 2)}\n`);
  console.log(`[editor-bundle] wrote ${copied} files to ${path.relative(repoRoot, destination)}`);
}

function writeLockfileHash(pin) {
  const checkoutDir = path.join(os.homedir(), ".cache", "dartsnut", "scratch-gui", "lockfile-probe");
  cloneUpstream({ ...pin, lockfileSha256: null }, checkoutDir);
  const lockfileSha256 = sha256File(path.join(checkoutDir, "package-lock.json"));
  fs.writeFileSync(
    PIN_PATH,
    `${JSON.stringify({ ...pin, lockfileSha256 }, null, 2)}\n`
  );
  console.log(`[editor-bundle] recorded lockfile sha256 ${lockfileSha256}`);
}

function main() {
  const pin = readPin();
  if (process.argv.includes("--write-lockfile-hash")) {
    writeLockfileHash(pin);
    return;
  }
  if (process.argv.includes("--check")) {
    if (isUpToDate(pin)) {
      console.log("[editor-bundle] up to date");
      return;
    }
    process.exitCode = 1;
    return;
  }
  if (isUpToDate(pin)) return;
  build(pin);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(`[editor-bundle] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
