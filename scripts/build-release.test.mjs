import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadBuildEnv, parseArgs, parseEnvFile } from "./build-release.mjs";
import { loadLocalBuildEnvironment, resolveUpdaterEndpoint, updaterConfigOverride } from "./run-tauri-build.mjs";

test("resolveUpdaterEndpoint prefers the process environment", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dartsnut-updater-env-"));
  try {
    const envPath = path.join(root, ".env.release.local");
    fs.writeFileSync(envPath, "DARTSNUT_UPDATER_ENDPOINT=https://local.example/latest-{{target}}.json\n");
    assert.equal(
      resolveUpdaterEndpoint({ DARTSNUT_UPDATER_ENDPOINT: "https://ci.example/latest-{{target}}.json" }, envPath),
      "https://ci.example/latest-{{target}}.json"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveUpdaterEndpoint reads only the updater endpoint from the local release file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dartsnut-updater-env-"));
  try {
    const envPath = path.join(root, ".env.release.local");
    fs.writeFileSync(envPath, [
      "DARTSNUT_RELEASE_PASSWORD=do-not-forward",
      "DARTSNUT_UPDATER_ENDPOINT='https://local.example/latest-{{target}}.json'"
    ].join("\n"));
    assert.equal(
      resolveUpdaterEndpoint({}, envPath),
      "https://local.example/latest-{{target}}.json"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("updaterConfigOverride emits a concrete Tauri config layer", () => {
  const endpoint = "https://updates.example.com/latest-{{target}}.json";
  assert.deepEqual(JSON.parse(updaterConfigOverride(endpoint)), {
    plugins: { updater: { endpoints: [endpoint] } }
  });
  assert.doesNotMatch(updaterConfigOverride(endpoint), /DARTSNUT_UPDATER_ENDPOINT/);
});

test("loadLocalBuildEnvironment loads signing inputs without release credentials", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dartsnut-direct-build-env-"));
  try {
    const keyPath = path.join(root, "release.key");
    const envPath = path.join(root, ".env.release.local");
    fs.writeFileSync(keyPath, "private key contents\n");
    fs.writeFileSync(envPath, [
      "DARTSNUT_UPDATER_ENDPOINT=https://updates.example.com/latest-{{target}}.json",
      "TAURI_SIGNING_PRIVATE_KEY_PATH=release.key",
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=secret",
      "DARTSNUT_RELEASE_PASSWORD=do-not-forward",
      "DARTSNUT_GOOGLE_DESKTOP_CLIENT_SECRET=do-not-embed"
    ].join("\n"));
    const env = loadLocalBuildEnvironment({}, envPath);
    assert.equal(env.TAURI_SIGNING_PRIVATE_KEY, "private key contents");
    assert.equal(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "secret");
    assert.equal(env.DARTSNUT_RELEASE_PASSWORD, undefined);
    assert.equal(env.DARTSNUT_GOOGLE_DESKTOP_CLIENT_SECRET, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parseArgs accepts platform, version, and env file", () => {
  assert.deepEqual(
    parseArgs(["--platform", "win", "--version", "1.7.5", "--env-file", ".env.release.local"], "win32"),
    {
      help: false,
      platform: "win",
      version: "1.7.5",
      envFile: ".env.release.local"
    }
  );
});

test("parseArgs accepts package-manager separator after platform", () => {
  assert.deepEqual(parseArgs(["--platform", "mac", "--", "--version", "2.0.0"], "darwin"), {
    help: false,
    platform: "mac",
    version: "2.0.0",
    envFile: undefined
  });
});

test("parseArgs accepts positional version and native host default", () => {
  assert.deepEqual(parseArgs(["1.7.5"], "darwin"), {
    help: false,
    platform: "mac",
    version: "1.7.5",
    envFile: undefined
  });
});

test("parseArgs rejects unsupported host without explicit platform", () => {
  assert.throws(
    () => parseArgs([], "linux"),
    /Platform required on this host/
  );
});

test("parseArgs rejects non-SemVer versions", () => {
  assert.throws(
    () => parseArgs(["--version", "next"], "win32"),
    /Invalid exact SemVer: next/
  );
});

test("parseEnvFile handles comments, export, and quoted values", () => {
  assert.deepEqual(parseEnvFile([
    "# comment",
    "export TAURI_SIGNING_PRIVATE_KEY_PATH='keys/release.key'",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=secret=value",
    "TAURI_SIGNING_PUBLIC_KEY=abc"
  ].join("\n")), {
    TAURI_SIGNING_PRIVATE_KEY_PATH: "keys/release.key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "secret=value",
    TAURI_SIGNING_PUBLIC_KEY: "abc"
  });
});

test("loadBuildEnv reads private key path into key content", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dartsnut-release-"));
  try {
    const keyPath = path.join(tempRoot, "release.key");
    const envPath = path.join(tempRoot, ".env.release.local");
    const publicKey = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"))
      .plugins.updater.pubkey;
    fs.writeFileSync(keyPath, "private key contents\n");
    fs.writeFileSync(envPath, [
      `TAURI_SIGNING_PRIVATE_KEY_PATH=${keyPath}`,
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=",
      `TAURI_SIGNING_PUBLIC_KEY=${publicKey}`,
      "DARTSNUT_UPDATER_ENDPOINT=https://updates.example.com/latest.json"
    ].join("\n"));

    const { env } = loadBuildEnv("win", envPath, {});
    assert.equal(env.TAURI_SIGNING_PRIVATE_KEY, "private key contents");
    assert.equal(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "");
    assert.equal(env.TAURI_SIGNING_PUBLIC_KEY, publicKey);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("loadBuildEnv supports repository-root release env files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dartsnut-release-root-env-"));
  try {
    const keyPath = path.join(root, "release.key");
    const envPath = path.join(root, ".env.release.local");
    const publicKey = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"))
      .plugins.updater.pubkey;
    fs.writeFileSync(keyPath, "private key contents\n");
    fs.writeFileSync(envPath, [
      `TAURI_SIGNING_PRIVATE_KEY_PATH=${keyPath}`,
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=secret",
      `TAURI_SIGNING_PUBLIC_KEY=${publicKey}`,
      "DARTSNUT_UPDATER_ENDPOINT=https://updates.example.com/latest.json",
      "DARTSNUT_MACOS_SIGNING_IDENTITY=Test Signing Identity"
    ].join("\n"));

    const { env } = loadBuildEnv("mac", envPath, {});
    assert.equal(env.TAURI_SIGNING_PRIVATE_KEY, "private key contents");
    assert.equal(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "secret");
    assert.equal(env.APPLE_SIGNING_IDENTITY, "Test Signing Identity");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
