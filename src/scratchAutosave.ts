/**
 * Autosave state for a Scratch project.
 *
 * A project is written shortly after the user stops editing, so there is no Save
 * button to forget. The failures that matter are the ones a user cannot see:
 * a write that never happened, or one that failed while they kept working. This
 * module is the decision layer for that, kept pure so it can be tested without
 * an editor, a VM, or a filesystem.
 */

/** What the panel shows about persistence. */
export type AutosaveState =
  /** Nothing has been edited since the last successful write. */
  | { state: "clean" }
  /** An edit is waiting for the debounce to elapse. */
  | { state: "pending"; since: number }
  /** A write is in flight. */
  | { state: "saving"; since: number }
  /** The last write failed. `dirty` survives so the bytes are not lost. */
  | { state: "failed"; message: string; since: number };

/**
 * A pending write is flushed on switch and on close. An edit arriving inside the
 * debounce window is the whole reason this exists: quitting must not drop it.
 */
export const AUTOSAVE_DEBOUNCE_MS = 1000;

export function initialAutosaveState(): AutosaveState {
  return { state: "clean" };
}

/** An edit landed. A failure stays visible until a write succeeds. */
export function noteEdit(current: AutosaveState, now: number): AutosaveState {
  if (current.state === "saving") return current;
  return { state: "pending", since: now };
}

/** A write started. */
export function noteSaving(current: AutosaveState, now: number): AutosaveState {
  if (current.state !== "pending" && current.state !== "failed") return current;
  return { state: "saving", since: now };
}

/** A write succeeded: the project on disk now matches the editor. */
export function noteSaved(): AutosaveState {
  return { state: "clean" };
}

/** A write failed. The message is user-facing copy, not a code. */
export function noteSaveFailed(current: AutosaveState, message: string, now: number): AutosaveState {
  const since = "since" in current ? current.since : now;
  return { state: "failed", message, since };
}

/** Is there an edit that is not yet on disk? */
export function hasUnsavedWork(current: AutosaveState): boolean {
  return current.state === "pending" || current.state === "saving" || current.state === "failed";
}

/**
 * Should the panel offer a retry? A failed write is retryable; a pending one is
 * simply going to happen on its own.
 */
export function canRetrySave(current: AutosaveState): boolean {
  return current.state === "failed";
}

/**
 * The line under the stage. Silence is deliberate while things are working:
 * a "saved" badge that flashes on every keystroke is noise, while a failure has
 * to be impossible to miss.
 */
export function autosaveLabel(current: AutosaveState): string | null {
  switch (current.state) {
    case "clean":
      return null;
    case "pending":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "failed":
      return `Could not save: ${current.message}`;
  }
}
