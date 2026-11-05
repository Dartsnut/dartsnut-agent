/**
 * Autosave state for a Scratch project.
 *
 * A project is written shortly after the user stops editing, so there is no Save
 * button to forget. The failures that matter are the ones a user cannot see:
 * a write that never happened, or one that failed while they kept working. This
 * module is the decision layer for that, kept pure so it can be tested without
 * an editor, a VM, or a filesystem.
 */

/**
 * What the panel shows about persistence.
 *
 * There is deliberately no "pending edit" state. The debounce lives inside the
 * editor, which only posts bytes once it has serialised them, so the host never
 * observes an edit it has not been handed. Modelling an edit the host cannot see
 * would be a state no code path can ever enter.
 */
export type AutosaveState =
  /** Nothing is in flight and the last write succeeded. */
  | { state: "clean" }
  /** A write is in flight. */
  | { state: "saving"; since: number }
  /** The last write failed. The bytes are retained so they are not lost. */
  | { state: "failed"; message: string; since: number };

export function initialAutosaveState(): AutosaveState {
  return { state: "clean" };
}

/** A write started. Bytes arrived from the editor, so a write is real. */
export function noteSaving(current: AutosaveState, now: number): AutosaveState {
  if (current.state === "saving") return current;
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

/** Is there bytes the editor produced that are not confirmed on disk? */
export function hasUnsavedWork(current: AutosaveState): boolean {
  return current.state === "saving" || current.state === "failed";
}

/** Should the panel offer a retry? Only a failure has a retry worth offering. */
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
    case "saving":
      return "Saving…";
    case "failed":
      return `Could not save: ${current.message}`;
  }
}
