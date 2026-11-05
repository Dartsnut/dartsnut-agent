import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  assertUpstreamUnmodified,
  installBridge,
  installGeneratedSources,
  PINNED_GENERATED_SOURCES,
  DROPPED_ENTRYPOINTS,
  isUpToDate,
  listShippableFiles,
  outputDir,
  readPin,
  shouldShip,
  stampFor,
  stampPath,
} from "./build-editor-bundle.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dartsnut-editor-bundle-"));
}

function writeFile(root, relative, contents = "x") {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

test("the pin resolves to a real upstream commit and a lockfile hash", () => {
  const pin = readPin();
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
  assert.match(pin.lockfileSha256, /^[0-9a-f]{64}$/);
  assert.equal(pin.entrypoint, "dartsnut.html");
  // The url is what the iframe loads; it must point at the entrypoint the pin
  // names, or the editor is served from a path that does not exist.
  assert.ok(pin.url.endsWith(`/${pin.entrypoint}`));
});

test("a pin with an unresolved commit is refused", () => {
  const root = tempRoot();
  try {
    const pinPath = path.join(root, "pin.json");
    const pin = { ...readPin(), commit: "v4.0.4" };
    fs.writeFileSync(pinPath, JSON.stringify(pin));
    assert.throws(() => readPin(pinPath), /non-resolved commit/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a pin missing a required key is refused", () => {
  const root = tempRoot();
  try {
    const pinPath = path.join(root, "pin.json");
    // lockfileSha256 is intentionally optional in readPin: --write-lockfile-hash
    // runs before a hash exists. The bootstrap-relevant keys are the rest.
    const { entrypoint: _dropped, ...partial } = readPin();
    fs.writeFileSync(pinPath, JSON.stringify(partial));
    assert.throws(() => readPin(pinPath), /missing "entrypoint"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("other entrypoints and source maps are not shipped", () => {
  for (const dropped of DROPPED_ENTRYPOINTS) {
    assert.equal(shouldShip(dropped), false, dropped);
  }
  assert.equal(shouldShip("chunks/gui.js.map"), false);
  assert.equal(shouldShip("dartsnut.html"), true);
  // Upstream's own GUI document is superseded by the bridge entry: shipping both
  // invites loading the one that never answers the host.
  assert.equal(shouldShip("index.html"), false);
  assert.equal(shouldShip(path.join("static", "assets", "costume.svg")), true);
});

test("shippable listing walks the build directory and drops maps and entrypoints", () => {
  const root = tempRoot();
  try {
    const build = path.join(root, "build");
    writeFile(build, "dartsnut.html");
    writeFile(build, "index.html");
    writeFile(build, "player.html");
    writeFile(build, "gui.js");
    writeFile(build, "gui.js.map");
    writeFile(build, path.join("static", "keep.png"));
    assert.deepEqual(listShippableFiles(build), [
      "dartsnut.html",
      "gui.js",
      path.join("static", "keep.png"),
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A root with the real bridge patch sources copied in, so the hash resolves. */
function rootWithBridgeSources() {
  const root = tempRoot();
  const pin = readPin();
  const sources = path.join(root, pin.bridge.sourceDir);
  for (const { from } of PINNED_GENERATED_SOURCES) {
    const target = path.join(sources, from);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `pinned:${from}`);
  }
  for (const name of [pin.bridge.entrypoint, pin.bridge.config]) {
    fs.writeFileSync(path.join(sources, name), `// ${name}`);
  }
  return { root, pin, sources };
}

test("a bundle is up to date only when the stamp matches the pin", () => {
  const { root, pin } = rootWithBridgeSources();
  try {
    const destination = outputDir(pin, root);
    assert.equal(isUpToDate(pin, root), false, "nothing built yet");

    fs.mkdirSync(destination, { recursive: true });
    assert.equal(isUpToDate(pin, root), false, "entrypoint missing");

    fs.writeFileSync(path.join(destination, pin.entrypoint), "<html></html>");
    assert.equal(isUpToDate(pin, root), false, "stamp missing");

    fs.writeFileSync(stampPath(pin, root), JSON.stringify(stampFor(pin, root)));
    assert.equal(isUpToDate(pin, root), true);

    // A stamp from a different pin must force a rebuild rather than silently
    // serving a bundle built from another upstream commit.
    fs.writeFileSync(
      stampPath(pin, root),
      JSON.stringify({ ...stampFor(pin, root), commit: "0".repeat(40) }),
    );
    assert.equal(isUpToDate(pin, root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("editing the bridge invalidates the bundle", () => {
  // Without this, the stamp only described the upstream pin, so a bridge change
  // was a no-op and the previous editor shipped: a fix could look verified while
  // never reaching the bundle.
  const { root, pin, sources } = rootWithBridgeSources();
  try {
    const destination = outputDir(pin, root);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, pin.entrypoint), "<html></html>");
    fs.writeFileSync(stampPath(pin, root), JSON.stringify(stampFor(pin, root)));
    assert.equal(isUpToDate(pin, root), true);

    fs.writeFileSync(path.join(sources, pin.bridge.entrypoint), "// edited bridge");
    assert.equal(
      isUpToDate(pin, root),
      false,
      "a changed bridge must force a rebuild"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a pin without a lockfile hash never counts as up to date", () => {
  const { root } = rootWithBridgeSources();
  try {
    const pin = { ...readPin(), lockfileSha256: "" };
    const destination = outputDir(pin, root);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, pin.entrypoint), "<html></html>");
    fs.writeFileSync(stampPath(pin, root), JSON.stringify(stampFor(pin, root)));
    assert.equal(isUpToDate(pin, root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the pin names bridge files that exist in the repo", () => {
  const pin = readPin();
  assert.ok(pin.bridge, "the pin must describe the bridge entry");
  for (const fileName of [pin.bridge.entrypoint, pin.bridge.config]) {
    const source = path.join(process.cwd(), pin.bridge.sourceDir, fileName);
    assert.ok(fs.existsSync(source), `missing bridge source: ${source}`);
  }
});

test("installing the bridge copies both files and returns their names", () => {
  const root = tempRoot();
  try {
    const pin = readPin();
    const checkout = path.join(root, "checkout");
    const sources = path.join(root, "sources");
    fs.mkdirSync(checkout, { recursive: true });
    fs.mkdirSync(sources, { recursive: true });
    for (const fileName of [pin.bridge.entrypoint, pin.bridge.config]) {
      fs.writeFileSync(path.join(sources, fileName), "// bridge");
    }
    const installed = installBridge(pin, checkout, sources);
    assert.deepEqual(installed, [pin.bridge.entrypoint, pin.bridge.config]);
    for (const fileName of installed) {
      assert.ok(fs.existsSync(path.join(checkout, fileName)), fileName);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a bridge source that is missing is refused rather than silently skipped", () => {
  const root = tempRoot();
  try {
    const pin = readPin();
    const checkout = path.join(root, "checkout");
    fs.mkdirSync(checkout, { recursive: true });
    assert.throws(
      () => installBridge(pin, checkout, path.join(root, "nowhere")),
      /bridge source is missing/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assertUpstreamUnmodified accepts additions and rejects edits", () => {
  const root = tempRoot();
  try {
    const checkout = path.join(root, "checkout");
    fs.mkdirSync(checkout, { recursive: true });
    const git = (...args) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
        cwd: checkout,
        stdio: "pipe",
      });
    git("init", "-q");
    fs.writeFileSync(path.join(checkout, "upstream.js"), "// upstream");
    git("add", "upstream.js");
    git("commit", "-q", "-m", "upstream");

    // The bridge only ever adds.
    fs.writeFileSync(path.join(checkout, "dartsnut-gui.jsx"), "// bridge");
    assert.doesNotThrow(() => assertUpstreamUnmodified(checkout));

    // Editing upstream is exactly the claim the notices file must never make.
    fs.writeFileSync(path.join(checkout, "upstream.js"), "// patched");
    assert.throws(() => assertUpstreamUnmodified(checkout), /only add files/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the pinned generated sources exist and are committed with the bridge", () => {
  const pin = readPin();
  for (const { from } of PINNED_GENERATED_SOURCES) {
    const source = path.join(process.cwd(), pin.bridge.sourceDir, from);
    assert.ok(
      fs.existsSync(source),
      `missing pinned generated source: ${source}. These are gitignored upstream, so they must ship with the bridge or the build needs the network.`
    );
  }
});

test("installing pinned generated sources writes both upstream paths", () => {
  const root = tempRoot();
  try {
    const checkout = path.join(root, "checkout");
    const sources = path.join(root, "sources");
    fs.mkdirSync(checkout, { recursive: true });
    for (const { from } of PINNED_GENERATED_SOURCES) {
      const target = path.join(sources, from);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "pinned");
    }
    installGeneratedSources(checkout, sources);
    for (const { to } of PINNED_GENERATED_SOURCES) {
      assert.ok(fs.existsSync(path.join(checkout, to)), to);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the pinned hex is large enough to be the real archive, not a placeholder", () => {
  const pin = readPin();
  const hex = path.join(
    process.cwd(),
    pin.bridge.sourceDir,
    "microbit/scratch-microbit-1.2.0.hex"
  );
  assert.ok(fs.statSync(hex).size > 100_000, "the microbit hex looks like a stub");
});
