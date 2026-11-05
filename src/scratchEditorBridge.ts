import {
  BRIDGE_CHANNEL,
  BRIDGE_PROTOCOL_VERSION,
  inspectScratchEditorMessage,
  type ScratchEditorErrorReason,
  type ScratchEditorHostMessage,
  type ScratchEditorMessage,
  type ScratchProjectIdentity
} from "@dartsnut/desktop-contracts";
import { SCRATCH_EDITOR_BUNDLE_URL } from "./editorBundleUrl";
import { panelToScratch } from "./scratchInput";

/**
 * Host side of the editor bridge.
 *
 * The iframe is a separate document, so everything crosses as `postMessage`.
 * The host never trusts a payload blindly: `inspectScratchEditorMessage` is the
 * one place that decides whether a message is ours, ours at a version we do not
 * speak, or none of our business. Keeping that decision in the shared package
 * means a shape change is a compile error rather than a silent drop.
 *
 * Nothing here touches the filesystem. Bytes arrive from the guarded Tauri
 * command and are handed to the iframe; the iframe holds no capability of its
 * own.
 */

/** Where the editor is in its lifecycle. */
export type ScratchEditorPhase =
  /** The document is loading; nothing can be delivered yet. */
  | { phase: "mounting" }
  /** The document loaded but the bridge has not answered. */
  | { phase: "waiting-for-bridge" }
  /** The bridge answered and a project load is in flight. */
  | { phase: "loading"; identity: ScratchProjectIdentity }
  /** The project is loaded and editable. */
  | { phase: "ready"; identity: ScratchProjectIdentity }
  /** The editor cannot work. The workspace is fine; the editor is not. */
  | { phase: "failed"; reason: ScratchEditorErrorReason; detail: string };

/** How long the bridge may stay silent after the document loads. */
export const BRIDGE_HANDSHAKE_TIMEOUT_MS = 10_000;

export interface ScratchEditorBridgeHandlers {
  /** Read the project through the guarded command and post it into the editor. */
  onReady: () => Promise<void>;
  /** A save arrived from the editor. Consumed by autosave (#19). */
  onSave: (message: { identity: ScratchProjectIdentity; bytes: Uint8Array }) => void;
  onFailed: (phase: Extract<ScratchEditorPhase, { phase: "failed" }>) => void;
}

/**
 * A host-side controller bound to one iframe.
 *
 * `attach` wires the message listener and returns a detach function; the panel
 * calls detach on unmount and on project switch, so a torn-down iframe cannot
 * deliver a save into the next project.
 */
export function attachScratchEditorBridge(options: {
  iframe: HTMLIFrameElement;
  handlers: ScratchEditorBridgeHandlers;
}): { detach: () => void; post: (message: ScratchEditorHostMessage) => boolean } {
  const { iframe, handlers } = options;
  let ready = false;

  const post = (message: ScratchEditorHostMessage): boolean => {
    const target = iframe.contentWindow;
    if (!target) return false;
    const transfer =
      message.kind === "load-project" ? [message.bytes.buffer as ArrayBuffer] : [];
    target.postMessage(message satisfies ScratchEditorMessage, "*", transfer);
    return true;
  };

  const onMessage = (event: MessageEvent) => {
    // Same-origin by construction, but the check keeps a nested or embedded
    // frame from speaking on the editor's behalf.
    if (event.source !== iframe.contentWindow) return;
    const inspection = inspectScratchEditorMessage(event.data);
    if (inspection.state === "foreign") return;
    if (inspection.state === "outdated") {
      handlers.onFailed({
        phase: "failed",
        reason: "protocol-mismatch",
        detail: `The editor bundle speaks bridge version ${String(
          inspection.version
        )}, but this app speaks ${BRIDGE_PROTOCOL_VERSION}. Rebuild the editor bundle.`
      });
      return;
    }
    const message = inspection.message;
    if (message.kind === "editor-ready") {
      if (ready) return;
      ready = true;
      void handlers.onReady();
      return;
    }
    if (message.kind === "save-project") {
      handlers.onSave({ identity: message.project, bytes: message.bytes });
      return;
    }
    if (message.kind === "editor-error") {
      handlers.onFailed({ phase: "failed", reason: message.reason, detail: message.detail });
    }
  };

  window.addEventListener("message", onMessage);

  // The hello tells the editor the host's version before it announces itself, so
  // an editor built from a different pin fails as a version mismatch rather than
  // as silence.
  const onLoad = () => {
    post({ channel: BRIDGE_CHANNEL, version: BRIDGE_PROTOCOL_VERSION, kind: "hello" });
  };
  iframe.addEventListener("load", onLoad);

  return {
    detach: () => {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
    },
    post
  };
}

/** The load message for a project's bytes. */
export function loadProjectMessage(
  identity: ScratchProjectIdentity,
  bytes: Uint8Array
): ScratchEditorHostMessage {
  return {
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    kind: "load-project",
    project: identity,
    bytes
  };
}

/**
 * A dart throw, already mapped into stage coordinates, or `null` when the hit
 * fell in the letterbox band and must be dropped.
 */
export function dartMessage(
  index: number,
  px: number,
  py: number
): ScratchEditorHostMessage | null {
  const mapped = panelToScratch(px, py);
  if (!mapped) return null;
  return {
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    kind: "dart",
    index,
    x: mapped.x,
    y: mapped.y
  };
}

/** A face-button change in the key name the editor's key hat reports. */
export function keyMessage(code: string, pressed: boolean): ScratchEditorHostMessage {
  return {
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    kind: "key",
    code,
    pressed
  };
}

/** Decode the guarded command's base64 payload into the bytes the bridge transfers. */
export function decodeProjectBytes(bytesBase64: string): Uint8Array {
  const binary = atob(bytesBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * The inverse of `decodeProjectBytes`, for a save travelling to the guarded
 * command. Chunked because `String.fromCharCode` on a large array overflows the
 * argument limit, and a project archive is easily a few megabytes.
 */
export function encodeProjectBytes(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function scratchEditorUrl(): string {
  return SCRATCH_EDITOR_BUNDLE_URL;
}
