const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

let helpers;
test.before(async () => {
  helpers = await import("./publish_release_helpers.mjs");
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "publish-release-"));
}

function writeManifests(root, versions) {
  helpers.VERSION_MANIFESTS.forEach((relativePath, index) => {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({ name: `package-${index}`, version: versions[index] }, null, 2)}\n`);
  });
}

function writeArtifact(dir, name, contents = "artifact") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), contents);
}

test("resolveWorkspaceVersion updates all manifests for exact SemVer", () => {
  const root = tempDir();
  try {
    writeManifests(root, Array(helpers.VERSION_MANIFESTS.length).fill("1.5.4"));
    assert.equal(helpers.resolveWorkspaceVersion(root, ["--", "1.6.0-beta.1"]), "1.6.0-beta.1");
    for (const relativePath of helpers.VERSION_MANIFESTS) {
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, relativePath))).version, "1.6.0-beta.1");
    }
    assert.throws(() => helpers.resolveWorkspaceVersion(root, ["minor"]), /Invalid exact SemVer/);
    assert.throws(() => helpers.resolveWorkspaceVersion(root, ["1.6.0", "extra"]), /Usage/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveWorkspaceVersion rejects mismatched current versions", () => {
  const root = tempDir();
  try {
    writeManifests(root, ["1.5.4", "1.5.4", "1.5.3"]);
    assert.throws(() => helpers.resolveWorkspaceVersion(root, []), /do not match/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("releaseTargetForPlatform maps host package command and rejects unsupported hosts", () => {
  const mac = helpers.releaseTargetForPlatform("darwin");
  const windows = helpers.releaseTargetForPlatform("win32");
  assert.equal(mac.packageScript, "package:mac");
  assert.equal(mac.tauriMetadataFile, "latest-darwin.json");
  assert.equal(windows.packageScript, "package:win");
  assert.equal(windows.tauriMetadataFile, "latest-windows.json");
  assert.throws(() => helpers.releaseTargetForPlatform("linux"), /Unsupported release platform/);
});

test("Tauri updater endpoint is injected by the release build wrapper", () => {
  const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
  assert.equal(config.plugins.updater.endpoints, undefined);
  const releaseConfig = JSON.parse(fs.readFileSync("src-tauri/tauri.release.conf.json", "utf8"));
  assert.equal(releaseConfig.plugins, undefined);
});

test("collectTauriArtifacts selects only exact-version signed Tauri artifacts", () => {
  const root = tempDir();
  try {
    writeArtifact(root, "Dartsnut Agent_1.7.4_aarch64.dmg");
    writeArtifact(root, "Dartsnut.Agent_1.7.4_aarch64.app.tar.gz");
    writeArtifact(root, "Dartsnut.Agent_1.7.4_aarch64.app.tar.gz.sig");
    const artifacts = helpers.collectTauriArtifacts(
      root,
      helpers.releaseTargetForPlatform("darwin"),
      "1.7.4"
    );
    assert.match(artifacts.installer, /\.dmg$/);
    assert.equal(path.basename(artifacts.updaterPayload), "Dartsnut.Agent_1.7.4_aarch64.app.tar.gz");
    assert.equal(path.basename(artifacts.signature), "Dartsnut.Agent_1.7.4_aarch64.app.tar.gz.sig");
    assert.throws(
      () => helpers.collectTauriArtifacts(root, helpers.releaseTargetForPlatform("darwin"), "1.7.4", Date.now() + 5000),
      /stale/
    );
    writeArtifact(root, "Other_1.7.4_aarch64.app.tar.gz");
    writeArtifact(root, "Other_1.7.4_aarch64.app.tar.gz.sig");
    assert.throws(
      () => helpers.collectTauriArtifacts(root, helpers.releaseTargetForPlatform("darwin"), "1.7.4"),
      /updater payload.*found 2/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectTauriArtifacts accepts Tauri-generated updater names without version", () => {
  const root = tempDir();
  try {
    writeArtifact(root, "Dartsnut Agent_1.7.4_aarch64.dmg");
    writeArtifact(root, "Dartsnut Agent.app.tar.gz");
    writeArtifact(root, "Dartsnut Agent.app.tar.gz.sig");
    const artifacts = helpers.collectTauriArtifacts(root, helpers.releaseTargetForPlatform("darwin"), "1.7.4");
    assert.equal(path.basename(artifacts.updaterPayload), "Dartsnut Agent.app.tar.gz");
    writeArtifact(root, "Other Agent.app.tar.gz");
    writeArtifact(root, "Other Agent.app.tar.gz.sig");
    assert.throws(
      () => helpers.collectTauriArtifacts(root, helpers.releaseTargetForPlatform("darwin"), "1.7.4"),
      /updater payload.*found 2/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectTauriArtifacts discovers Tauri sibling bundle directories", () => {
  const root = tempDir();
  try {
    fs.mkdirSync(path.join(root, "dmg"));
    fs.mkdirSync(path.join(root, "macos"));
    writeArtifact(path.join(root, "dmg"), "Dartsnut Agent_1.7.4_aarch64.dmg");
    writeArtifact(path.join(root, "macos"), "Dartsnut.Agent_1.7.4_aarch64.app.tar.gz");
    writeArtifact(path.join(root, "macos"), "Dartsnut.Agent_1.7.4_aarch64.app.tar.gz.sig");
    const artifacts = helpers.collectTauriArtifacts(root, helpers.releaseTargetForPlatform("darwin"), "1.7.4");
    assert.match(artifacts.installer, /dmg[\\/]Dartsnut Agent_1\.7\.4_aarch64\.dmg$/);
    assert.match(artifacts.updaterPayload, /macos[\\/]Dartsnut\.Agent_1\.7\.4_aarch64\.app\.tar\.gz$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectTauriArtifacts validates Windows payload type and adjacent signature", () => {
  const root = tempDir();
  try {
    writeArtifact(path.join(root, "nsis"), "Dartsnut Agent_1.7.4_x64-setup.exe");
    writeArtifact(path.join(root, "nsis"), "Dartsnut Agent_1.7.4_x64-setup.nsis.zip");
    writeArtifact(path.join(root, "other"), "Dartsnut Agent_1.7.4_x64-setup.nsis.zip.sig");
    assert.throws(
      () => helpers.collectTauriArtifacts(root, helpers.releaseTargetForPlatform("win32"), "1.7.4"),
      /Missing Tauri updater signature/
    );
    writeArtifact(path.join(root, "nsis"), "Dartsnut Agent_1.7.4_x64-setup.nsis.zip.sig");
    const artifacts = helpers.collectTauriArtifacts(root, helpers.releaseTargetForPlatform("win32"), "1.7.4");
    assert.match(artifacts.updaterPayload, /\.nsis\.zip$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tauriUploadNames preserves Windows executable updater format", () => {
  const target = helpers.releaseTargetForPlatform("win32");
  assert.equal(
    helpers.tauriUploadNames(target, "1.7.4").updaterPayload,
    "dartsnut-agent-tauri-1.7.4-windows-x86_64.nsis.zip"
  );
  assert.equal(
    helpers.tauriUploadNames(target, "1.7.4", "Dartsnut Agent_1.7.4_x64-setup.exe").updaterPayload,
    "dartsnut-agent-tauri-1.7.4-windows-x86_64.nsis.exe"
  );
});

test("collectTauriArtifacts accepts self-contained Windows NSIS updater", () => {
  const root = tempDir();
  try {
    writeArtifact(path.join(root, "nsis"), "Dartsnut Agent_1.7.4_x64-setup.exe");
    writeArtifact(path.join(root, "nsis"), "Dartsnut Agent_1.7.4_x64-setup.exe.sig");
    const artifacts = helpers.collectTauriArtifacts(
      root,
      helpers.releaseTargetForPlatform("win32"),
      "1.7.4"
    );
    assert.equal(artifacts.installer, artifacts.updaterPayload);
    assert.match(artifacts.signature, /setup\.exe\.sig$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Tauri upload names and manifest use dedicated signed artifact names", () => {
  const macNames = helpers.tauriUploadNames(helpers.releaseTargetForPlatform("darwin"), "1.7.4");
  const windowsNames = helpers.tauriUploadNames(helpers.releaseTargetForPlatform("win32"), "1.7.4");
  assert.deepEqual(macNames, {
    updaterPayload: "dartsnut-agent-tauri-1.7.4-darwin-aarch64.app.tar.gz",
    signature: "dartsnut-agent-tauri-1.7.4-darwin-aarch64.app.tar.gz.sig",
    metadata: "latest-darwin.json"
  });
  assert.deepEqual(windowsNames, {
    updaterPayload: "dartsnut-agent-tauri-1.7.4-windows-x86_64.nsis.zip",
    signature: "dartsnut-agent-tauri-1.7.4-windows-x86_64.nsis.zip.sig",
    metadata: "latest-windows.json"
  });
  assert.deepEqual(helpers.createTauriUpdateManifest({
    version: "1.7.4",
    notes: " Release notes ",
    pubDate: new Date("2026-09-04T00:00:00.000Z"),
    url: "https://updates.example.com/agent-update/dartsnut-agent-tauri-1.7.4-darwin-aarch64.app.tar.gz",
    signature: " signed-value\n"
  }), {
    version: "1.7.4",
    notes: "Release notes",
    pub_date: "2026-09-04T00:00:00.000Z",
    url: "https://updates.example.com/agent-update/dartsnut-agent-tauri-1.7.4-darwin-aarch64.app.tar.gz",
    signature: "signed-value"
  });
  assert.throws(() => helpers.createTauriUpdateManifest({
    version: "1.7.4",
    pubDate: new Date("2026-09-04T00:00:00.000Z"),
    url: "https://files.example/update.app.tar.gz",
    signature: ""
  }), /signature is empty/);
});

test("publishBuiltArtifacts updates matching release and uploads metadata last", async () => {
  const root = tempDir();
  const calls = [];
  const existing = { id: 7, platform: "mac", version: "1.5.4" };
  try {
    writeArtifact(root, "app.dmg");
    writeArtifact(root, "app.app.tar.gz");
    writeArtifact(root, "app.app.tar.gz.sig", "signed-value\n");
    const api = {
      async login() { calls.push(["login"]); },
      async uploadInstaller(file) {
        calls.push(["installer", path.basename(file)]);
        return { url: "https://files.example/app.dmg", md5: "abc123" };
      },
      async findRelease(platform, version) {
        calls.push(["find", platform, version]);
        return existing;
      },
      async saveRelease(row, data) { calls.push(["save", row, data]); },
      async uploadLiveUpdate(file, uploadName) {
        calls.push(["update", uploadName, fs.readFileSync(file, "utf8")]);
        return { url: `https://updates.example.com/agent-update/${uploadName}` };
      }
    };
    await helpers.publishBuiltArtifacts({
      api,
      target: helpers.releaseTargetForPlatform("darwin"),
      version: "1.5.4",
      description: "Release notes",
      now: () => new Date("2026-09-04T00:00:00.000Z"),
      artifacts: {
        installer: path.join(root, "app.dmg"),
        updaterPayload: path.join(root, "app.app.tar.gz"),
        signature: path.join(root, "app.app.tar.gz.sig")
      }
    });
    const saveCall = calls.find((call) => call[0] === "save");
    assert.equal(saveCall[1], existing);
    assert.deepEqual(saveCall[2], {
      platform: "mac",
      version: "1.5.4",
      download_url: "https://files.example/app.dmg",
      download_md5: "abc123",
      is_current: false,
      status: true,
      description: "Release notes"
    });
    const updateCalls = calls.filter((call) => call[0] === "update");
    assert.deepEqual(updateCalls.map((call) => call[1]), [
      "dartsnut-agent-tauri-1.5.4-darwin-aarch64.app.tar.gz",
      "dartsnut-agent-tauri-1.5.4-darwin-aarch64.app.tar.gz.sig",
      "latest-darwin.json"
    ]);
    assert.equal(calls.at(-1)[1], "latest-darwin.json");
    assert.deepEqual(JSON.parse(updateCalls.at(-1)[2]), {
      version: "1.5.4",
      notes: "Release notes",
      pub_date: "2026-09-04T00:00:00.000Z",
      url: "https://updates.example.com/agent-update/dartsnut-agent-tauri-1.5.4-darwin-aarch64.app.tar.gz",
      signature: "signed-value"
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publishBuiltArtifacts stops before release save and metadata when signature upload fails", async () => {
  const root = tempDir();
  const calls = [];
  try {
    writeArtifact(root, "app.dmg");
    writeArtifact(root, "app.app.tar.gz");
    writeArtifact(root, "app.app.tar.gz.sig", "signed-value");
    const api = {
      async login() { calls.push("login"); },
      async uploadInstaller() { calls.push("installer"); return { url: "https://files.example/app.dmg", md5: "md5" }; },
      async findRelease() { calls.push("find"); return null; },
      async saveRelease() { calls.push("save"); },
      async uploadLiveUpdate(_file, uploadName) {
        calls.push(uploadName);
        if (uploadName.endsWith(".sig")) throw new Error("upload failed");
        return { url: `https://files.example/${uploadName}` };
      }
    };
    await assert.rejects(() => helpers.publishBuiltArtifacts({
      api,
      target: helpers.releaseTargetForPlatform("darwin"),
      version: "1.5.4",
      artifacts: {
        installer: path.join(root, "app.dmg"),
        updaterPayload: path.join(root, "app.app.tar.gz"),
        signature: path.join(root, "app.app.tar.gz.sig")
      }
    }), /upload failed/);
    assert.deepEqual(calls, [
      "login",
      "installer",
      "dartsnut-agent-tauri-1.5.4-darwin-aarch64.app.tar.gz",
      "dartsnut-agent-tauri-1.5.4-darwin-aarch64.app.tar.gz.sig"
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loadReleaseConfig reads ignored env and validates required values", () => {
  const root = tempDir();
  const emptyRoot = tempDir();
  try {
    fs.writeFileSync(path.join(root, ".env.release.local"), [
      "DARTSNUT_RELEASE_API_BASE=https://api.example.com/",
      "DARTSNUT_RELEASE_ACCOUNT=release-admin",
      "DARTSNUT_RELEASE_PASSWORD='secret value'",
      "DARTSNUT_RELEASE_DESCRIPTION=Notes"
    ].join("\n"));
    assert.deepEqual(helpers.loadReleaseConfig(root, {}), {
      apiBase: "https://api.example.com",
      account: "release-admin",
      password: "secret value",
      description: "Notes"
    });
    assert.throws(
      () => helpers.loadReleaseConfig(emptyRoot, {}),
      /Missing release configuration/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test("createReleaseApi uses exact duplicate match, token header, and edit endpoint", async () => {
  const calls = [];
  const payloads = [
    { code: 1001, data: { token: "admin-token" } },
    {
      code: 1001,
      data: {
        total: 3,
        list: [
          { id: 1, platform: "mac", version: "1.5.40" },
          { id: 2, platform: "windows", version: "1.5.4" },
          { id: 3, platform: "mac", version: "1.5.4" }
        ]
      }
    },
    { code: 1001, data: null }
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(payloads.shift()), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const api = helpers.createReleaseApi({
    apiBase: "https://api.example.com",
    account: "admin",
    password: "secret"
  }, fetchImpl);

  await api.login();
  const existing = await api.findRelease("mac", "1.5.4");
  assert.equal(existing.id, 3);
  await api.saveRelease(existing, { platform: "mac", version: "1.5.4" });

  assert.equal(calls[0].options.headers.has("token"), false);
  assert.equal(calls[1].options.headers.get("token"), "admin-token");
  assert.match(calls[1].url, /platform=mac/);
  assert.match(calls[1].url, /version=1.5.4/);
  assert.match(calls[2].url, /\/platform\/app-release\/edit$/);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    id: 3,
    platform: "mac",
    version: "1.5.4"
  });
});

test("createReleaseApi paginates substring results and creates when exact version is absent", async () => {
  const calls = [];
  const payloads = [
    { code: 1001, data: { token: "admin-token" } },
    {
      code: 1001,
      data: {
        total: 101,
        list: Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          platform: "windows",
          version: `2.0.0-${index}`
        }))
      }
    },
    {
      code: 1001,
      data: { total: 101, list: [{ id: 101, platform: "windows", version: "2.0.0-other" }] }
    },
    { code: 1001, data: null }
  ];
  const api = helpers.createReleaseApi({
    apiBase: "https://api.example.com",
    account: "admin",
    password: "secret"
  }, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(payloads.shift()), { status: 200 });
  });

  await api.login();
  const existing = await api.findRelease("windows", "2.0.0");
  assert.equal(existing, null);
  await api.saveRelease(existing, { platform: "windows", version: "2.0.0" });

  assert.match(calls[1].url, /page=1/);
  assert.match(calls[2].url, /page=2/);
  assert.match(calls[3].url, /\/platform\/app-release\/add$/);
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    platform: "windows",
    version: "2.0.0"
  });
});

test("createReleaseApi preserves requested live-update filename and validates returned OSS URL", async () => {
  const root = tempDir();
  try {
    const filePath = path.join(root, "generated.json");
    fs.writeFileSync(filePath, "{}\n");
    const calls = [];
    const api = helpers.createReleaseApi({
      apiBase: "https://api.example.com",
      account: "admin",
      password: "secret"
    }, async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        code: 1001,
        data: { url: "https://updates.example.com/agent-update/latest-darwin.json" }
      }), { status: 200 });
    });

    const uploaded = await api.uploadLiveUpdate(filePath, "latest-darwin.json");
    assert.equal(uploaded.url, "https://updates.example.com/agent-update/latest-darwin.json");
    assert.match(calls[0].url, /\/platform\/upload\/upload-agent-update-yml$/);
    assert.equal(calls[0].options.body.get("file").name, "latest-darwin.json");

    const renamedApi = helpers.createReleaseApi({
      apiBase: "https://api.example.com",
      account: "admin",
      password: "secret"
    }, async () => new Response(JSON.stringify({
      code: 1001,
      data: { url: "https://updates.example.com/agent-update/latest.json" }
    }), { status: 200 }));
    await assert.rejects(
      () => renamedApi.uploadLiveUpdate(filePath, "latest-darwin.json"),
      /renamed latest-darwin\.json to latest\.json/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createReleaseApi surfaces API failure without exposing credentials", async () => {
  const api = helpers.createReleaseApi({
    apiBase: "https://api.example.com",
    account: "admin",
    password: "do-not-log"
  }, async () => new Response(JSON.stringify({
    code: 1004,
    data: null,
    msg: "Incorrect password",
    desc: null
  }), { status: 200 }));

  await assert.rejects(api.login(), (error) => {
    assert.match(error.message, /Incorrect password/);
    assert.doesNotMatch(error.message, /do-not-log/);
    return true;
  });
});
