import { describe, expect, it } from "vitest";
import {
  autosaveLabel,
  canRetrySave,
  hasUnsavedWork,
  initialAutosaveState,
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

  it("a write in flight is unsaved work, and says so", () => {
    const saving = noteSaving(initialAutosaveState(), 2);
    expect(saving).toEqual({ state: "saving", since: 2 });
    expect(hasUnsavedWork(saving)).toBe(true);
    expect(autosaveLabel(saving)).toBe("Saving…");
  });

  it("a second note that a write started does not restamp the attempt", () => {
    const saving = noteSaving(initialAutosaveState(), 2);
    expect(noteSaving(saving, 9)).toEqual({ state: "saving", since: 2 });
  });

  it("a successful write returns to clean", () => {
    expect(noteSaved()).toEqual({ state: "clean" });
    expect(hasUnsavedWork(noteSaved())).toBe(false);
    expect(canRetrySave(noteSaved())).toBe(false);
    expect(autosaveLabel(noteSaved())).toBeNull();
  });

  it("a failed write is visible, retryable, and still unsaved work", () => {
    const failed = noteSaveFailed(noteSaving(initialAutosaveState(), 6), "disk full", 7);
    expect(failed).toEqual({ state: "failed", message: "disk full", since: 6 });
    expect(hasUnsavedWork(failed)).toBe(true);
    expect(canRetrySave(failed)).toBe(true);
    expect(autosaveLabel(failed)).toBe("Could not save: disk full");
  });

  it("a failure keeps the attempt's start time rather than looking freshly stale", () => {
    const failed = noteSaveFailed(initialAutosaveState(), "read-only filesystem", 99);
    expect(failed).toEqual({ state: "failed", message: "read-only filesystem", since: 99 });
  });

  it("recovering from a failure stamps the new attempt", () => {
    const failed = noteSaveFailed(initialAutosaveState(), "boom", 2);
    expect(noteSaving(failed, 3)).toEqual({ state: "saving", since: 3 });
  });
});
