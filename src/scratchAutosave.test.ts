import { describe, expect, it } from "vitest";
import {
  autosaveLabel,
  canRetrySave,
  hasUnsavedWork,
  initialAutosaveState,
  noteEdit,
  noteSaveFailed,
  noteSaved,
  noteSaving
} from "./scratchAutosave";

describe("scratch autosave state", () => {
  it("starts clean and says nothing while there is nothing to say", () => {
    const state = initialAutosaveState();
    expect(state).toEqual({ state: "clean" });
    expect(hasUnsavedWork(state)).toBe(false);
    expect(autosaveLabel(state)).toBeNull();
  });

  it("an edit becomes pending work", () => {
    const pending = noteEdit(initialAutosaveState(), 1000);
    expect(pending).toEqual({ state: "pending", since: 1000 });
    expect(hasUnsavedWork(pending)).toBe(true);
    expect(autosaveLabel(pending)).toBe("Unsaved changes");
  });

  it("editing again while saving does not disturb the in-flight write", () => {
    const saving = noteSaving(noteEdit(initialAutosaveState(), 1), 2);
    expect(saving).toEqual({ state: "saving", since: 2 });
    // A write is already carrying the bytes; a second edit must not reset it to
    // pending, or the debounce would restart mid-write.
    expect(noteEdit(saving, 3)).toEqual({ state: "saving", since: 2 });
  });

  it("a successful write returns to clean", () => {
    const saving = noteSaving(noteEdit(initialAutosaveState(), 1), 2);
    expect(noteSaved()).toEqual({ state: "clean" });
    expect(hasUnsavedWork(noteSaved())).toBe(false);
    // Nothing to retry once the write landed.
    expect(canRetrySave(noteSaved())).toBe(false);
    expect(noteSaving(saving, 4)).toEqual({ state: "saving", since: 2 });
  });

  it("a failed write is visible, retryable, and still unsaved work", () => {
    const failed = noteSaveFailed(noteSaving(noteEdit(initialAutosaveState(), 5), 6), "disk full", 7);
    expect(failed).toEqual({ state: "failed", message: "disk full", since: 6 });
    expect(hasUnsavedWork(failed)).toBe(true);
    expect(canRetrySave(failed)).toBe(true);
    expect(autosaveLabel(failed)).toBe("Could not save: disk full");
  });

  it("a failure keeps its original timestamp rather than looking freshly stale", () => {
    const pending = noteEdit(initialAutosaveState(), 42);
    const failed = noteSaveFailed(pending, "read-only filesystem", 99);
    expect(failed).toEqual({ state: "failed", message: "read-only filesystem", since: 42 });
  });

  it("only a failure offers a retry, never a pending write that will happen anyway", () => {
    expect(canRetrySave(noteEdit(initialAutosaveState(), 1))).toBe(false);
    expect(canRetrySave(noteSaveFailed(initialAutosaveState(), "boom", 2))).toBe(true);
  });

  it("a write cannot begin from clean: there would be nothing to save", () => {
    expect(noteSaving(initialAutosaveState(), 3)).toEqual({ state: "clean" });
  });

  it("recovering from a failure goes through saving, not straight to clean", () => {
    const failed = noteSaveFailed(noteEdit(initialAutosaveState(), 1), "boom", 2);
    const retrying = noteSaving(failed, 3);
    // The retry stamps when the write begins, not when the edit landed: the
    // timestamp answers "how long has this been unpersisted" for the current
    // attempt, and a failure already showed its own age.
    expect(retrying).toEqual({ state: "saving", since: 3 });
    expect(autosaveLabel(noteSaved())).toBeNull();
  });
});
