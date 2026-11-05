import { describe, expect, it } from "vitest";
import {
  BRIDGE_CHANNEL,
  BRIDGE_PROTOCOL_VERSION,
  inspectScratchEditorMessage,
  parseScratchEditorMessage,
} from "../src/scratchEditorBridge";

const envelope = {
  channel: BRIDGE_CHANNEL,
  version: BRIDGE_PROTOCOL_VERSION,
};

describe("scratch editor bridge envelope", () => {
  it("accepts each editor to host message at the current version", () => {
    const messages = [
      { ...envelope, kind: "editor-ready" },
      { ...envelope, kind: "project-loaded", project: { projectId: "p1", fileName: "game.sb3" } },
      { ...envelope, kind: "save-project", project: { projectId: "p1", fileName: "game.sb3" }, bytes: new Uint8Array([1]) },
      { ...envelope, kind: "dart", index: 3, x: 64, y: 80 },
      { ...envelope, kind: "key", code: "space", pressed: true },
      { ...envelope, kind: "editor-error", reason: "project-load-failed", detail: "bad zip" },
    ];
    for (const message of messages) {
      expect(parseScratchEditorMessage(message)).toEqual(message);
    }
  });

  it("rejects traffic that is not ours, without claiming it is old", () => {
    const foreign = [
      null,
      undefined,
      "editor-ready",
      42,
      {},
      { kind: "editor-ready" },
      { channel: "some-other-app", version: BRIDGE_PROTOCOL_VERSION, kind: "editor-ready" },
      // React devtools and other webview traffic must not be mistaken for ours.
      { channel: BRIDGE_CHANNEL },
    ];
    for (const value of foreign) {
      expect(inspectScratchEditorMessage(value)).toEqual({ state: "foreign" });
      expect(parseScratchEditorMessage(value)).toBeNull();
    }
  });

  it("names a version mismatch so an editor pin bump reads as an error, not a blank frame", () => {
    const future = { channel: BRIDGE_CHANNEL, version: BRIDGE_PROTOCOL_VERSION + 1, kind: "editor-ready" };
    expect(inspectScratchEditorMessage(future)).toEqual({
      state: "outdated",
      version: BRIDGE_PROTOCOL_VERSION + 1,
    });
    expect(parseScratchEditorMessage(future)).toBeNull();
  });

  it("rejects our channel and version carrying a kind we do not know", () => {
    const unknownKind = { ...envelope, kind: "teleport-sprite" };
    expect(inspectScratchEditorMessage(unknownKind)).toEqual({ state: "foreign" });
  });

  it("rejects a host-bound message arriving from the editor", () => {
    // `hello` and `load-project` are host → editor. If one comes back, something
    // is echoing frames, and the host must not act on it.
    expect(inspectScratchEditorMessage({ ...envelope, kind: "hello" })).toEqual({ state: "foreign" });
    expect(parseScratchEditorMessage({ ...envelope, kind: "load-project" })).toBeNull();
  });
});
