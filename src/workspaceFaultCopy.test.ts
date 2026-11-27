import { describe, expect, it } from "vitest";
import {
  UNKNOWN_WORKSPACE_FAULT_COPY,
  WORKSPACE_FAULT_COPY,
  workspaceFaultCopy,
  workspaceFixPrompt,
  type WorkspaceFaultReason,
} from "./workspaceFaultCopy";

/** Every reason `classify_dartsnut_project_files` / `workspace_runnable` can emit. */
const BACKEND_REASONS: WorkspaceFaultReason[] = [
  "missing_pyproject",
  "pyproject_unparseable",
  "pyproject_no_project_table",
  "pyproject_bad_dependencies",
  "missing_project_name",
  "missing_project_version",
  "missing_pydartsnut",
  "conf_unparseable",
  "conf_not_object",
  "conf_missing_widget_keys",
  "missing_main_py",
  "scratch_multiple_projects",
  "scratch_ambiguous_with_python",
  "scratch_unparseable",
];

/** Scratch faults have no agent surface, so they carry no repair prompt. */
const SCRATCH_REASONS: WorkspaceFaultReason[] = [
  "scratch_multiple_projects",
  "scratch_ambiguous_with_python",
  "scratch_unparseable",
];

describe("workspace fault copy", () => {
  it("has copy for every reason the backend can emit", () => {
    for (const reason of BACKEND_REASONS) {
      const copy = WORKSPACE_FAULT_COPY[reason];
      expect(copy, `missing copy for ${reason}`).toBeDefined();
      expect(copy.title.trim()).not.toBe("");
      expect(copy.detail.trim()).not.toBe("");
      expect(copy.fix.trim()).not.toBe("");
    }
  });

  it("distinguishes reasons a user must act on differently", () => {
    const titles = BACKEND_REASONS.map((reason) => WORKSPACE_FAULT_COPY[reason].title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives every Python reason an agent prompt clause", () => {
    for (const reason of BACKEND_REASONS.filter((reason) => !SCRATCH_REASONS.includes(reason))) {
      expect(WORKSPACE_FAULT_COPY[reason].fixPrompt?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("offers no agent repair for a Scratch fault", () => {
    for (const reason of SCRATCH_REASONS) {
      expect(WORKSPACE_FAULT_COPY[reason].fixPrompt).toBeUndefined();
    }
  });

  it("names the rule and the fix in Scratch copy", () => {
    for (const reason of SCRATCH_REASONS) {
      const copy = WORKSPACE_FAULT_COPY[reason];
      expect(copy.fix.toLowerCase()).toMatch(/\.sb3|pyproject\.toml/);
    }
    expect(workspaceFaultCopy("scratch_multiple_projects").title).toContain("Two");
    expect(workspaceFaultCopy("scratch_multiple_projects").fix).toContain("single .sb3");
    expect(workspaceFaultCopy("scratch_ambiguous_with_python").fix).toContain("pyproject.toml");
    expect(workspaceFaultCopy("scratch_unparseable").detail).toContain("project.json");
  });

  it("ignores Scratch faults when building an agent repair prompt", () => {
    // No chat exists to send a Scratch repair to; the prompt stays useful for
    // whatever Python fault was reported alongside it.
    const prompt = workspaceFixPrompt(["scratch_unparseable", "missing_main_py"]);
    expect(prompt).toContain("main.py");
    expect(prompt).not.toContain("Re-export");
  });

  it("builds one prompt covering every reported problem", () => {
    const prompt = workspaceFixPrompt(["missing_main_py", "missing_pydartsnut"]);
    expect(prompt).toContain("main.py");
    expect(prompt).toContain("pydartsnut");
    expect(prompt).toContain("The workspace is not runnable");
  });

  it("does not repeat a clause reported twice", () => {
    const once = workspaceFixPrompt(["missing_main_py"]);
    const twice = workspaceFixPrompt(["missing_main_py", "missing_main_py"]);
    expect(twice).toBe(once);
  });

  it("still produces a usable prompt for an unknown problem", () => {
    expect(workspaceFixPrompt(["some_future_reason"])).toContain("The workspace is not runnable");
  });

  it("falls back for a reason code it does not know", () => {
    expect(workspaceFaultCopy("some_future_reason")).toBe(UNKNOWN_WORKSPACE_FAULT_COPY);
  });

  it("resolves a known reason to its own copy", () => {
    expect(workspaceFaultCopy("missing_main_py")).toBe(WORKSPACE_FAULT_COPY.missing_main_py);
  });
});
