import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION_MANIFESTS = [
  "package.json",
  "packages/emulator-protocol/package.json",
  "packages/desktop-contracts/package.json"
];

const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function normalizeVersionArgs(args) {
  if (args[0] === "--") args = args.slice(1);
  if (args.length > 1) {
    throw new Error("Usage: pnpm release:publish -- [exact-semver]");
  }
  if (args[0] !== undefined && !EXACT_SEMVER.test(args[0])) {
    throw new Error(`Invalid exact SemVer: ${args[0]}`);
  }
  return args;
}

export function resolveWorkspaceVersion(repoRoot, args) {
  args = normalizeVersionArgs(args);

  const manifests = VERSION_MANIFESTS.map((relativePath) => {
    const filePath = path.join(repoRoot, relativePath);
    return { relativePath, filePath, data: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  });
  const requestedVersion = args[0];

  if (requestedVersion !== undefined) {
    for (const manifest of manifests) {
      manifest.data.version = requestedVersion;
    }
    for (const manifest of manifests) {
      fs.writeFileSync(manifest.filePath, `${JSON.stringify(manifest.data, null, 2)}\n`);
    }
    return requestedVersion;
  }

  const versions = new Map();
  for (const manifest of manifests) {
    const version = String(manifest.data.version || "");
    const files = versions.get(version) || [];
    files.push(manifest.relativePath);
    versions.set(version, files);
  }
  if (versions.size !== 1) {
    const details = [...versions.entries()]
      .map(([version, files]) => `${version || "<missing>"}: ${files.join(", ")}`)
      .join("; ");
    throw new Error(`Workspace package versions do not match: ${details}`);
  }
  const version = manifests[0].data.version;
  if (!EXACT_SEMVER.test(version)) {
    throw new Error(`Workspace version is not exact SemVer: ${version}`);
  }
  return version;
}

export function releaseTargetForPlatform(platform) {
  if (platform === "darwin") {
    return {
      platform: "darwin",
      apiPlatform: "mac",
      packageScript: "package:mac",
      targetTriple: "aarch64-apple-darwin",
      installerExtension: ".dmg",
      tauriTarget: "darwin",
      tauriArch: "aarch64",
      tauriMetadataFile: "latest-darwin.json",
      tauriUpdateExtension: ".app.tar.gz"
    };
  }
  if (platform === "win32") {
    return {
      platform: "win32",
      apiPlatform: "windows",
      packageScript: "package:win",
      targetTriple: "x86_64-pc-windows-msvc",
      installerExtension: ".exe",
      tauriTarget: "windows",
      tauriArch: "x86_64",
      tauriMetadataFile: "latest-windows.json",
      tauriUpdateExtension: ".nsis.zip"
    };
  }
  throw new Error(`Unsupported release platform: ${platform}`);
}

function versionPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}(?=$|[^0-9A-Za-z])`);
}

function oneVersionedFile(files, version, extension, label) {
  const pattern = versionPattern(version);
  const matches = files.filter((name) => name.endsWith(extension) && pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} for version ${version}; found ${matches.length}`);
  }
  return matches[0];
}

function assertFresh(filePath, buildStartedAt) {
  const modifiedAt = fs.statSync(filePath).mtimeMs;
  if (modifiedAt < buildStartedAt - 2000) {
    throw new Error(`Release artifact is stale: ${path.basename(filePath)}`);
  }
}

/** Collect Tauri 2 bundle/update artifacts from a bundle output directory. */
export function collectTauriArtifacts(bundleRoot, target, version, buildStartedAt = 0) {
  if (!fs.existsSync(bundleRoot)) throw new Error(`Tauri bundle directory does not exist: ${bundleRoot}`);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else files.push({ name: entry.name, path: filePath });
    }
  };
  walk(bundleRoot);
  const names = files.map(({ name }) => name);
  const installerName = oneVersionedFile(names, version, target.installerExtension, "Tauri installer");
  const installerMatches = files.filter(({ name }) => name === installerName);
  if (installerMatches.length !== 1) {
    throw new Error(`Expected exactly one Tauri installer for version ${version}; found ${installerMatches.length}`);
  }
  const installer = installerMatches[0];
  // Tauri v2 emits a self-contained signed NSIS executable on Windows. Some
  // older toolchains emit the equivalent `.nsis.zip`; accept both formats.
  // Exclude the installer selected above when falling back to the executable.
  const updateCandidates = files.filter(({ name }) => name.endsWith(target.tauriUpdateExtension));
  if (updateCandidates.length === 0 && target.platform === "win32") {
    // Tauri v2's NSIS updater is self-contained: the installer executable is
    // also the updater payload and its adjacent `.sig` signs those bytes.
    updateCandidates.push(installer);
  }
  if (updateCandidates.length !== 1) {
    throw new Error(`Expected exactly one Tauri updater payload for version ${version}; found ${updateCandidates.length}`);
  }
  const updaterPayload = updateCandidates[0];
  const signaturePath = `${updaterPayload.path}.sig`;
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Missing Tauri updater signature for ${updaterPayload.name}`);
  }
  const signature = { name: path.basename(signaturePath), path: signaturePath };
  for (const file of [installer, updaterPayload, signature]) assertFresh(file.path, buildStartedAt);
  return {
    installer: installer.path,
    updaterPayload: updaterPayload.path,
    signature: signature.path
  };
}

export function tauriUploadNames(target, version, payloadPath) {
  if (!EXACT_SEMVER.test(version)) throw new Error(`Invalid exact SemVer: ${version}`);
  const payloadIsExe = target.platform === "win32" && String(payloadPath || "").toLowerCase().endsWith(".exe");
  const payloadExtension = payloadIsExe ? ".nsis.exe" : target.tauriUpdateExtension;
  const stem = `dartsnut-agent-tauri-${version}-${target.tauriTarget}-${target.tauriArch}`;
  return {
    updaterPayload: `${stem}${payloadExtension}`,
    signature: `${stem}${payloadExtension}.sig`,
    metadata: target.tauriMetadataFile
  };
}

function parseHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} has an invalid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  return url;
}

function validateUploadedUrl(value, expectedName) {
  const url = parseHttpsUrl(value, `Live-update upload URL for ${expectedName}`);
  let uploadedName;
  try {
    uploadedName = decodeURIComponent(path.posix.basename(url.pathname));
  } catch {
    throw new Error(`Live-update upload URL has invalid encoding for ${expectedName}`);
  }
  if (uploadedName !== expectedName) {
    throw new Error(`Live-update upload renamed ${expectedName} to ${uploadedName || "<missing>"}`);
  }
  return url.toString();
}

export function createTauriUpdateManifest({ version, notes = "", pubDate, url, signature }) {
  if (!EXACT_SEMVER.test(version)) throw new Error(`Invalid exact SemVer: ${version}`);
  const normalizedSignature = String(signature || "").trim();
  if (!normalizedSignature) throw new Error("Tauri updater signature is empty");
  const normalizedDate = pubDate instanceof Date ? pubDate : new Date(pubDate);
  if (Number.isNaN(normalizedDate.getTime())) throw new Error("Tauri updater publication date is invalid");
  const manifest = {
    version,
    pub_date: normalizedDate.toISOString(),
    url: parseHttpsUrl(url, "Tauri updater payload URL").toString(),
    signature: normalizedSignature
  };
  if (String(notes).trim()) manifest.notes = String(notes).trim();
  return manifest;
}

export function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
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

export function loadReleaseConfig(repoRoot, processEnv = process.env) {
  const envPath = path.join(repoRoot, ".env.release.local");
  const fileEnv = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, "utf8")) : {};
  const value = (key) => String(processEnv[key] ?? fileEnv[key] ?? "").trim();
  const config = {
    apiBase: value("DARTSNUT_RELEASE_API_BASE").replace(/\/+$/, ""),
    account: value("DARTSNUT_RELEASE_ACCOUNT"),
    password: value("DARTSNUT_RELEASE_PASSWORD"),
    description: value("DARTSNUT_RELEASE_DESCRIPTION")
  };
  const missing = [
    ["DARTSNUT_RELEASE_API_BASE", config.apiBase],
    ["DARTSNUT_RELEASE_ACCOUNT", config.account],
    ["DARTSNUT_RELEASE_PASSWORD", config.password]
  ].filter(([, current]) => !current).map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing release configuration: ${missing.join(", ")}`);
  }
  try {
    const url = new URL(config.apiBase);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
  } catch {
    throw new Error("DARTSNUT_RELEASE_API_BASE must be an absolute HTTP(S) URL");
  }
  return config;
}

async function responseJson(response, endpoint) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${endpoint} returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok || Number(payload.code) !== 1001) {
    const detail = payload.desc || payload.msg || `HTTP ${response.status}`;
    throw new Error(`${endpoint} failed: ${detail}`);
  }
  return payload;
}

export function createReleaseApi(config, fetchImpl = fetch) {
  let token = "";
  const request = async (endpoint, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (token) headers.set("token", token);
    const response = await fetchImpl(`${config.apiBase}${endpoint}`, { ...options, headers });
    return responseJson(response, endpoint);
  };
  const postJson = (endpoint, body) => request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const upload = async (endpoint, filePath, uploadName = path.basename(filePath)) => {
    const form = new FormData();
    form.append("file", await fs.openAsBlob(filePath), uploadName);
    return request(endpoint, { method: "POST", body: form });
  };

  return {
    async login() {
      const payload = await postJson("/platform/user/login", {
        account: config.account,
        password: config.password
      });
      token = String(payload.data?.token || "");
      if (!token) throw new Error("Login response did not include a token");
    },
    async uploadInstaller(filePath) {
      const payload = await upload("/platform/upload/upload-app-installer", filePath);
      if (!payload.data?.url || !payload.data?.md5) {
        throw new Error("Installer upload response is missing URL or MD5");
      }
      return payload.data;
    },
    async findRelease(apiPlatform, version) {
      const pageSize = 100;
      for (let page = 1; ; page += 1) {
        const query = new URLSearchParams({
          platform: apiPlatform,
          version,
          page: String(page),
          size: String(pageSize)
        });
        const payload = await request(`/platform/app-release/list?${query}`);
        const rows = Array.isArray(payload.data?.list) ? payload.data.list : [];
        const match = rows.find(
          (row) => row.platform === apiPlatform && String(row.version) === version
        );
        if (match) return match;
        const total = Number(payload.data?.total) || 0;
        if (page * pageSize >= total || rows.length === 0) return null;
      }
    },
    saveRelease(existing, data) {
      return postJson(existing ? "/platform/app-release/edit" : "/platform/app-release/add", {
        ...(existing ? { id: existing.id } : {}),
        ...data
      });
    },
    async uploadLiveUpdate(filePath, uploadName = path.basename(filePath)) {
      const payload = await upload("/platform/upload/upload-agent-update-yml", filePath, uploadName);
      return {
        ...payload.data,
        url: validateUploadedUrl(payload.data?.url, uploadName)
      };
    }
  };
}

export async function publishBuiltArtifacts({
  api,
  target,
  version,
  artifacts,
  description = "",
  isCurrent = false,
  now = () => new Date(),
  onStage = () => {}
}) {
  const signature = fs.readFileSync(artifacts.signature, "utf8").trim();
  if (!signature) throw new Error("Tauri updater signature is empty");

  await api.login();
  onStage("authenticated");

  const installer = await api.uploadInstaller(artifacts.installer);
  onStage(`installer uploaded: ${path.basename(artifacts.installer)}`);

  const uploadNames = tauriUploadNames(target, version, artifacts.updaterPayload);
  const updaterPayload = await api.uploadLiveUpdate(artifacts.updaterPayload, uploadNames.updaterPayload);
  onStage(`live update uploaded: ${uploadNames.updaterPayload}`);

  await api.uploadLiveUpdate(artifacts.signature, uploadNames.signature);
  onStage(`live update uploaded: ${uploadNames.signature}`);

  const existing = await api.findRelease(target.apiPlatform, version);
  await api.saveRelease(existing, {
    platform: target.apiPlatform,
    version,
    download_url: installer.url,
    download_md5: installer.md5,
    is_current: isCurrent,
    status: true,
    description
  });
  onStage(existing ? "installer metadata updated" : "installer metadata created");

  const manifest = createTauriUpdateManifest({
    version,
    notes: description,
    pubDate: now(),
    url: updaterPayload.url,
    signature
  });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dartsnut-tauri-release-"));
  const metadataPath = path.join(tempRoot, uploadNames.metadata);
  try {
    fs.writeFileSync(metadataPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await api.uploadLiveUpdate(metadataPath, uploadNames.metadata);
    onStage(`live update uploaded: ${uploadNames.metadata}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
