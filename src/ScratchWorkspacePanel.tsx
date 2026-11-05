import { useCallback, useEffect, useRef, useState } from "react";
import {
  BRIDGE_CHANNEL,
  BRIDGE_PROTOCOL_VERSION,
  type ScratchProjectFileResult
} from "@dartsnut/desktop-contracts";
import { ScratchControls } from "./ScratchControls";
import { buttonKey, dartMessage as mapDart, scratchKeyFor, type ThrownDart } from "./scratchInput";
import {
  attachScratchEditorBridge,
  dartMessage,
  decodeProjectBytes,
  encodeProjectBytes,
  keyMessage,
  loadProjectMessage,
  scratchEditorUrl,
  type ScratchEditorPhase
} from "./scratchEditorBridge";
import {
  autosaveLabel,
  canRetrySave,
  initialAutosaveState,
  noteSaveFailed,
  noteSaved,
  noteSaving,
  type AutosaveState
} from "./scratchAutosave";

export interface ScratchWorkspacePanelProps {
  /** Identity of the active project; a change means a full reload. */
  projectId: string | null;
  /** Read the workspace's `.sb3` through the guarded backend command. */
  readProject: () => Promise<ScratchProjectFileResult>;
  /**
   * Write editor bytes back through the guarded backend command. The identity
   * travels with the bytes so a save that arrives after a project switch is
   * refused rather than written into the wrong file.
   */
  saveProject: (
    bytesBase64: string,
    identity: { projectId: string; fileName: string }
  ) => Promise<{ ok: boolean; message?: string }>;
  /**
   * Receives a function that flushes pending work and settles once it is on
   * disk. The quit path awaits this before the webview is destroyed, because
   * closing the window is not a place the renderer gets to save afterwards.
   */
  onFlushHandle?: (flush: () => Promise<void>) => void;
}

type PanelError = { reason: string; detail: string; retryable: boolean };

function readFailure(error: Extract<ScratchProjectFileResult, { ok: false }>): PanelError {
  return {
    reason: error.reason,
    detail: error.message,
    // A missing workspace or an escaped path will not fix itself on retry; a
    // transient read fault might.
    retryable: error.reason === "read_failed"
  };
}

/**
 * The Scratch editor for a Scratch workspace.
 *
 * Replaces the agent timeline and composer entirely: a Scratch project has no
 * chat, so there is nothing for an agent surface to act on. The editor takes the
 * whole body width rather than the chat rail's column, which clips the sprite
 * and costume panes at the app's minimum window size.
 *
 * Failures here are editor failures, not workspace faults — the workspace was
 * already classified as Scratch at open, so a blank frame means the editor did
 * not come up, and the copy says that.
 */
export function ScratchWorkspacePanel({
  projectId,
  readProject,
  saveProject,
  onFlushHandle
}: ScratchWorkspacePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const postRef = useRef<((message: ReturnType<typeof loadProjectMessage>) => boolean) | null>(null);
  const [phase, setPhase] = useState<ScratchEditorPhase>({ phase: "mounting" });
  const [error, setError] = useState<PanelError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [autosave, setAutosave] = useState<AutosaveState>(initialAutosaveState);
  const [dartIndex, setDartIndex] = useState(1);
  const [thrown, setThrown] = useState<ThrownDart[]>([]);

  // The host passes these as inline arrows, so they are new identities on every
  // render. Reading them through refs keeps the bridge effect stable: keyed on
  // them directly, every App render would tear the bridge down, reset the phase
  // to "mounting", and restart the handshake timer.
  const readRef = useRef(readProject);
  readRef.current = readProject;

  const load = useCallback(async () => {
    const result = await readRef.current();
    if (!result.ok) {
      setError(readFailure(result));
      setPhase({ phase: "failed", reason: "project-load-failed", detail: result.message });
      return;
    }
    setError(null);
    setPhase({ phase: "loading", identity: result.identity });
    const post = postRef.current;
    const bytes = decodeProjectBytes(result.bytesBase64);
    if (!post || !post(loadProjectMessage(result.identity, bytes))) {
      setPhase({
        phase: "failed",
        reason: "bridge-failed",
        detail: "The editor is not accepting messages."
      });
      return;
    }
    setPhase({ phase: "ready", identity: result.identity });
  }, []);

  // Saves are serialised through this chain: the editor emits a save, the host
  // writes it, and a failure keeps the bytes visible rather than dropping them.
  // Bytes and their identity travel together: a retry must write the same
  // project the bytes came from, not whatever is open when the user clicks.
  const lastBytes = useRef<{ bytes: Uint8Array; identity: { projectId: string; fileName: string } } | null>(null);
  const saveRef = useRef(saveProject);
  saveRef.current = saveProject;

  // The most recent write, so a quit-time flush can wait for it rather than
  // assuming it finished.
  const inFlight = useRef<Promise<void> | null>(null);

  const persist = useCallback((bytes: Uint8Array, identity: { projectId: string; fileName: string }) => {
    // Held so a failed write can be retried without asking the editor to
    // re-serialise: the bytes the user already produced are the bytes to write.
    lastBytes.current = { bytes, identity };
    setAutosave((current) => noteSaving(current, Date.now()));
    const write = (async () => {
      const result = await saveRef.current(encodeProjectBytes(bytes), identity);
      if (result.ok) {
        setAutosave(noteSaved());
        return;
      }
      setAutosave((current) =>
        noteSaveFailed(
          current,
          result.message ?? "the project could not be written",
          Date.now()
        )
      );
    })();
    inFlight.current = write;
    void write;
    return write;
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setError(null);
    setPhase({ phase: "mounting" });

    const bridge = attachScratchEditorBridge({
      iframe,
      handlers: {
        onReady: load,
        onSave: (message) => {
          void persist(message.bytes, message.identity);
        },
        onFailed: (failed) => {
          setError({ reason: failed.reason, detail: failed.detail, retryable: true });
          setPhase(failed);
        }
      }
    });
    postRef.current = bridge.post;

    // A document that loads but never answers leaves the panel mounted and
    // silent. Time-box it so the user sees a reason instead of an empty frame.
    const timer = window.setTimeout(() => {
      setPhase((current) => {
        if (current.phase !== "mounting" && current.phase !== "waiting-for-bridge") return current;
        setError({
          reason: "bundle-unreachable",
          detail: "The Scratch editor did not start. The editor bundle may be missing from this build.",
          retryable: true
        });
        return { phase: "failed", reason: "bundle-unreachable", detail: "The editor did not start." };
      });
    }, 10_000);

    /**
     * Write now, and settle once the write is on disk.
     *
     * The editor serialises asynchronously, so posting `flush` and returning
     * would be a lie: the bytes arrive on a later message, and the host write
     * begins then. This waits for that round trip, which is what the quit path
     * needs before the webview is destroyed.
     */
    const flush = async () => {
      const posted = bridge.post({
        channel: BRIDGE_CHANNEL,
        version: BRIDGE_PROTOCOL_VERSION,
        kind: "flush"
      });
      if (!posted) return;
      // Give the editor a turn to serialise and post; the write it triggers is
      // captured in `inFlight`.
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const pending = inFlight.current;
      if (pending) await pending;
    };

    // A window close through the OS does not reliably run effect cleanup, so
    // these remain as a belt-and-braces flush for the paths that do fire.
    const onLeave = () => {
      void flush();
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    onFlushHandle?.(flush);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      // Flush before detaching: a debounced write that has not fired yet is
      // exactly the edit a project switch would otherwise drop.
      void flush();
      bridge.detach();
      postRef.current = null;
    };
  }, [load, persist, projectId, attempt, onFlushHandle]);

  const failed = phase.phase === "failed";

  return (
    <section
      className="scratch-workspace-panel relative flex h-full min-h-0 w-full flex-col"
      aria-label="Scratch editor"
    >
      {error ? (
        <div className="scratch-workspace-panel__error" role="alert">
          <p className="scratch-workspace-panel__error-title">The Scratch editor did not load</p>
          <p className="scratch-workspace-panel__error-detail">{error.detail}</p>
          {error.retryable ? (
            <button
              type="button"
              className="scratch-workspace-panel__retry"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {/* Persistence status. Silence while working: a "saved" badge flashing on
          every keystroke is noise, and a failure has to be impossible to miss. */}
      {autosaveLabel(autosave) ? (
        <div
          className={`scratch-workspace-panel__autosave scratch-workspace-panel__autosave--${autosave.state}`}
          role={autosave.state === "failed" ? "alert" : "status"}
        >
          <span>{autosaveLabel(autosave)}</span>
          {canRetrySave(autosave) && lastBytes.current ? (
            <button
              type="button"
              className="scratch-workspace-panel__retry"
              onClick={() => {
                const held = lastBytes.current;
                if (held) void persist(held.bytes, held.identity);
              }}
            >
              Retry save
            </button>
          ) : null}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title="Scratch editor"
        src={scratchEditorUrl()}
        className="scratch-workspace-panel__frame"
        // Same-origin is required for the bundle's workers and storage; the
        // editor holds no Tauri capability, so origin sharing is not what keeps
        // it safe — the guarded commands are.
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
        style={{ display: failed ? "none" : undefined }}
      />
      {/* Keyboard forwarding: a kid tests with the laptop's own keys, so space
          and the arrows drive the same hats the face buttons do. Only while the
          editor has focus — otherwise typing anywhere in the app would jump a
          sprite. */}
      {!failed ? (
        <div
          className="scratch-workspace-panel__keyboard-capture"
          tabIndex={0}
          onKeyDown={(event) => {
            const code = scratchKeyFor(event.key);
            if (!code) return;
            // The editor owns the key here: a key that both jumped a sprite and
            // triggered an app shortcut is a bug you chase for a day.
            event.stopPropagation();
            event.preventDefault();
            const post = postRef.current;
            if (post) post(keyMessage(code, true));
          }}
          onKeyUp={(event) => {
            const code = scratchKeyFor(event.key);
            if (!code) return;
            event.stopPropagation();
            const post = postRef.current;
            if (post) post(keyMessage(code, false));
          }}
          aria-label="Keyboard input for the project"
        />
      ) : null}
      {/* The device's physical inputs, so a game can be exercised on a laptop
          before it ever reaches hardware. */}
      {!failed ? (
        <ScratchControls
          dartIndex={dartIndex}
          onDartIndexChange={setDartIndex}
          thrownDarts={thrown}
          onRemoveDart={(dart) => {
            // Host bookkeeping only: the device keeps darts in physical slots
            // and re-arms them, which the preview does not model. A project
            // resets its own visuals from its own scripts.
            setThrown((current) => current.filter((item) => item.id !== dart.id));
          }}
          onClearDarts={() => setThrown([])}
          onDart={(index, px, py) => {
            const post = postRef.current;
            if (!post) return;
            // The mapping owns the band-drop rule and the index guard; this
            // only wraps a mapped hit in the bridge envelope.
            const mapped = mapDart(index, px, py);
            if (!mapped) return;
            const message = dartMessage(mapped.index, mapped.x, mapped.y);
            post(message);
            setThrown((current) => [
              ...current,
              { id: `${mapped.index}-${Date.now()}-${current.length}`, index: mapped.index, x: mapped.x, y: mapped.y }
            ]);
          }}
          onKey={(code, pressed) => {
            const post = postRef.current;
            if (!post) return;
            post(keyMessage(code, pressed));
          }}
        />
      ) : null}
    </section>
  );
}
