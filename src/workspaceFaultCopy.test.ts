import { describe, expect, it } from "vitest";
import {
  UNKNOWN_WORKSPACE_FAULT_COPY,
  WORKSPACE_FAULT_COPY,
  workspaceFaultCopy,
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

  it("falls back for a reason code it does not know", () => {
    expect(workspaceFaultCopy("some_future_reason")).toBe(UNKNOWN_WORKSPACE_FAULT_COPY);
  });

  it("resolves a known reason to its own copy", () => {
    expect(workspaceFaultCopy("missing_main_py")).toBe(WORKSPACE_FAULT_COPY.missing_main_py);
  });
});
