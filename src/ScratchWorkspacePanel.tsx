import { useCallback, useEffect, useRef, useState } from "react";
import type { ScratchProjectFileResult } from "@dartsnut/desktop-contracts";
import {
  attachScratchEditorBridge,
  decodeProjectBytes,
  loadProjectMessage,
  scratchEditorUrl,
  type ScratchEditorPhase
} from "./scratchEditorBridge";

export interface ScratchWorkspacePanelProps {
  /** Identity of the active project; a change means a full reload. */
  projectId: string | null;
  /** Read the workspace's `.sb3` through the guarded backend command. */
  readProject: () => Promise<ScratchProjectFileResult>;
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
export function ScratchWorkspacePanel({ projectId, readProject }: ScratchWorkspacePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const postRef = useRef<((message: ReturnType<typeof loadProjectMessage>) => boolean) | null>(null);
  const [phase, setPhase] = useState<ScratchEditorPhase>({ phase: "mounting" });
  const [error, setError] = useState<PanelError | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    const result = await readProject();
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
  }, [readProject]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setError(null);
    setPhase({ phase: "mounting" });

    const bridge = attachScratchEditorBridge({
      iframe,
      handlers: {
        onReady: load,
        onSave: () => {
          // Autosave lands in #19; the seam is deliberately empty here rather
          // than writing half an implementation no ticket asked for.
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

    return () => {
      window.clearTimeout(timer);
      bridge.detach();
      postRef.current = null;
    };
  }, [load, projectId, attempt]);

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
    </section>
  );
}
