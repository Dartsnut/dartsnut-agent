import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
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
  assert.equal(pin.entrypoint, "index.html");
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
  assert.equal(shouldShip("index.html"), true);
  assert.equal(shouldShip(path.join("static", "assets", "costume.svg")), true);
});

test("shippable listing walks the build directory and drops maps and entrypoints", () => {
  const root = tempRoot();
  try {
    const build = path.join(root, "build");
    writeFile(build, "index.html");
    writeFile(build, "player.html");
    writeFile(build, "gui.js");
    writeFile(build, "gui.js.map");
    writeFile(build, path.join("static", "keep.png"));
    assert.deepEqual(listShippableFiles(build), [
      "gui.js",
      "index.html",
      path.join("static", "keep.png"),
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a bundle is up to date only when the stamp matches the pin", () => {
  const root = tempRoot();
  try {
    const pin = readPin();
    const destination = outputDir(pin, root);
    assert.equal(isUpToDate(pin, root), false, "nothing built yet");

    fs.mkdirSync(destination, { recursive: true });
    assert.equal(isUpToDate(pin, root), false, "entrypoint missing");

    fs.writeFileSync(path.join(destination, pin.entrypoint), "<html></html>");
    assert.equal(isUpToDate(pin, root), false, "stamp missing");

    fs.writeFileSync(stampPath(pin, root), JSON.stringify(stampFor(pin)));
    assert.equal(isUpToDate(pin, root), true);

    // A stamp from a different pin must force a rebuild rather than silently
    // serving a bundle built from another upstream commit.
    fs.writeFileSync(
      stampPath(pin, root),
      JSON.stringify({ ...stampFor(pin), commit: "0".repeat(40) }),
    );
    assert.equal(isUpToDate(pin, root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a pin without a lockfile hash never counts as up to date", () => {
  const root = tempRoot();
  try {
    const pin = { ...readPin(), lockfileSha256: "" };
    const destination = outputDir(pin, root);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, pin.entrypoint), "<html></html>");
    fs.writeFileSync(stampPath(pin, root), JSON.stringify(stampFor(pin)));
    assert.equal(isUpToDate(pin, root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
