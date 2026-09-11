import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadBuildEnv, parseArgs, parseEnvFile } from "./build-release.mjs";

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
