/**
 * The postMessage protocol between the host renderer and the vendored Scratch
 * editor running in a same-origin iframe.
 *
 * The editor is a separate React 16 application loaded from `/editor/index.html`
 * (see `src/editorBundleUrl.ts`). It cannot import this package, so the two
 * sides agree on wire shapes here and the editor's own bridge re-states them in
 * plain JavaScript. The host side is fully typed, which is what makes a message
 * shape change a compile error rather than a runtime mystery.
 *
 * `BRIDGE_PROTOCOL_VERSION` is carried on every envelope. An editor built from a
 * pin whose bridge speaks a different version is reported as an editor error
 * instead of silently receiving messages it does not understand.
 *
 * The editor holds no filesystem capability. Project bytes travel host → editor
 * in a `load-project` message after the host reads them through the guarded
 * Tauri command, and editor → host saves travel as bytes back through the host.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

export const BRIDGE_CHANNEL = "dartsnut.scratch-editor";

/** Identity of the project a load or save refers to. */
export interface ScratchProjectIdentity {
  /** Stable project id from the app's project store. */
  projectId: string;
  /** Workspace-relative file name of the `.sb3`, e.g. `game.sb3`. */
  fileName: string;
}

/**
 * Host → editor. Sent once the iframe has signalled its document is ready; the
 * editor answers with `editor-ready` when its VM can accept a project.
 */
export interface ScratchEditorHelloMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "hello";
}

/**
 * Editor → host. The editor cannot accept a project before this arrives, which
 * is what orders the handshake: a load is never posted into a half-mounted VM.
 */
export interface ScratchEditorReadyMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "editor-ready";
}

/**
 * Host → editor. Carries the project's bytes so a slow editor mount cannot
 * orphan them: the host holds this message until `editor-ready` arrives.
 *
 * `bytes` is a `Uint8Array` transferred as the message `transfer` list, so the
 * archive is not structured-cloned twice.
 */
export interface ScratchEditorLoadProjectMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "load-project";
  project: ScratchProjectIdentity;
  bytes: Uint8Array;
}

/**
 * Editor → host. Reported once per load, so the host can leave the loading
 * state, and so a successful load is distinguishable from a silent no-op.
 */
export interface ScratchEditorProjectLoadedMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "project-loaded";
  project: ScratchProjectIdentity;
}

/**
 * Editor → host. Emitted when the VM begins serialising a save. The host does
 * not yet write it: autosave is #19, and this message is the typed seam it will
 * consume.
 */
export interface ScratchEditorSaveProjectMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "save-project";
  project: ScratchProjectIdentity;
  bytes: Uint8Array;
}

/**
 * What the guard rejected, or that the archive could not be read. These are
 * *editor load* reasons, never workspace faults: the workspace was classified as
 * Scratch at open, so a read failure is the editor's problem to report.
 */
export type ScratchProjectReadFailure =
  /** No workspace is selected. */
  | "no_workspace"
  /** The resolved path would escape the workspace root. */
  | "outside_workspace"
  /** The workspace no longer holds exactly one usable `.sb3`. */
  | "project_missing"
  /** The file exists but could not be read. */
  | "read_failed";

/**
 * Return shape of the guarded read command. Bytes cross the Tauri IPC boundary
 * base64-encoded, matching the way emulator frames already travel; the renderer
 * decodes them into the `Uint8Array` the bridge transfers.
 */
export type ScratchProjectFileResult =
  | { ok: true; identity: ScratchProjectIdentity; bytesBase64: string }
  | { ok: false; reason: ScratchProjectReadFailure; message: string };

/** A dart throw in the device's 128×160 panel space. Consumed by #20. */
export interface ScratchEditorDartMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "dart";
  /** One-based dart number, 1–12. */
  index: number;
  /** Panel-space coordinates, not stage coordinates. */
  x: number;
  y: number;
}

/** A face-button press. Consumed by #20. */
export interface ScratchEditorKeyMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "key";
  /** Scratch key name: `space`, `x`, or an arrow. */
  code: string;
  pressed: boolean;
}

/**
 * Editor → host. The editor is mounted but cannot work — a failed VM load, or a
 * bridge whose version the editor does not speak. Distinct from a workspace
 * fault: the workspace is fine, the editor did not come up.
 */
export interface ScratchEditorErrorMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "editor-error";
  reason: ScratchEditorErrorReason;
  detail: string;
}

export type ScratchEditorErrorReason =
  /** The iframe document never signalled ready; the bundle probably failed to load. */
  | "bundle-unreachable"
  /** The editor's bridge speaks a protocol version this host does not. */
  | "protocol-mismatch"
  /** The VM refused the archive. */
  | "project-load-failed"
  /** The bridge reported a fault it has no more specific reason for. */
  | "bridge-failed";

/**
 * Host → editor. Write now: any pending debounced save must not be dropped when
 * the project is switched away from or the window closes.
 */
export interface ScratchEditorFlushMessage {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  kind: "flush";
}

export type ScratchEditorHostMessage =
  | ScratchEditorHelloMessage
  | ScratchEditorFlushMessage
  | ScratchEditorLoadProjectMessage;

export type ScratchEditorEditorMessage =
  | ScratchEditorReadyMessage
  | ScratchEditorProjectLoadedMessage
  | ScratchEditorSaveProjectMessage
  | ScratchEditorDartMessage
  | ScratchEditorKeyMessage
  | ScratchEditorErrorMessage;

export type ScratchEditorMessage = ScratchEditorHostMessage | ScratchEditorEditorMessage;

/**
 * What a `message` event payload turned out to be.
 *
 * `foreign` is every payload that is not ours at all — other channels, and the
 * ordinary window traffic a webview carries. `outdated` is our channel at a
 * version this host does not speak, which is the one case worth telling the user
 * about: an editor pin bump that broke the bridge should read as an editor
 * error, not as a blank frame.
 */
export type ScratchEditorBridgeInspection =
  | { state: "foreign" }
  | { state: "outdated"; version: unknown }
  | { state: "usable"; message: ScratchEditorEditorMessage };

const EDITOR_MESSAGE_KINDS: ReadonlySet<string> = new Set([
  "editor-ready",
  "project-loaded",
  "save-project",
  "dart",
  "key",
  "editor-error",
]);

/**
 * Classifies an untyped `message` payload in one place, so the host never has to
 * ask two questions of the same envelope to tell silence from drift.
 */
export function inspectScratchEditorMessage(value: unknown): ScratchEditorBridgeInspection {
  if (typeof value !== "object" || value === null) return { state: "foreign" };
  const envelope = value as { channel?: unknown; version?: unknown; kind?: unknown };
  if (envelope.channel !== BRIDGE_CHANNEL || typeof envelope.kind !== "string") {
    return { state: "foreign" };
  }
  if (envelope.version !== BRIDGE_PROTOCOL_VERSION) {
    return { state: "outdated", version: envelope.version };
  }
  if (!EDITOR_MESSAGE_KINDS.has(envelope.kind)) return { state: "foreign" };
  return { state: "usable", message: value as ScratchEditorEditorMessage };
}

/**
 * Narrows an untyped `message` payload to an editor → host message. Foreign
 * traffic, other channels, and other protocol versions all return `null`; use
 * `inspectScratchEditorMessage` when the difference matters.
 */
export function parseScratchEditorMessage(value: unknown): ScratchEditorEditorMessage | null {
  const inspection = inspectScratchEditorMessage(value);
  return inspection.state === "usable" ? inspection.message : null;
}
