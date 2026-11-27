import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION } from "@dartsnut/desktop-contracts";
import { attachScratchEditorBridge } from "./scratchEditorBridge";

const HELLO = { channel: BRIDGE_CHANNEL, version: BRIDGE_PROTOCOL_VERSION, kind: "hello" };
const noHandlers = { onReady: vi.fn(), onSave: vi.fn(), onFailed: vi.fn() };

function fakeIframe(readyState: DocumentReadyState) {
  const posted: unknown[] = [];
  const iframe = {
    contentWindow: { postMessage: (message: unknown) => posted.push(message) },
    contentDocument: { readyState },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  } as unknown as HTMLIFrameElement;
  return { iframe, posted };
}

describe("attachScratchEditorBridge", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { origin: "http://localhost" }
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The editor posts `editor-ready` once per hello, and each of those triggers a
  // project load. Two hellos on one attach means two overlapping loads:
  // `vm.loadProject` clears then installs across an await, so the project is
  // duplicated and the editor saves that duplicate over the user's file.
  it("says hello exactly once when the document has already loaded", () => {
    const { iframe, posted } = fakeIframe("complete");
    attachScratchEditorBridge({ iframe, handlers: noHandlers });
    expect(posted).toEqual([HELLO]);
    expect(iframe.addEventListener).not.toHaveBeenCalledWith("load", expect.any(Function), expect.anything());
  });

  it("waits for the load event when the document is still loading", () => {
    const { iframe, posted } = fakeIframe("loading");
    attachScratchEditorBridge({ iframe, handlers: noHandlers });
    expect(posted).toEqual([]);
    expect(iframe.addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
  });
});
