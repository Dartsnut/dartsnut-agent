import type { DeployEligibilityReason } from "@dartsnut/desktop-contracts";

/**
 * Copy for the sticky workspace-fault label shown in the emulator panel.
 *
 * The keys mirror the `reason` codes produced by
 * `classify_dartsnut_project_files` and `workspace_runnable`
 * (src-tauri/src/commands.rs). `workspace_not_selected` is deliberately absent:
 * no workspace is selected, so the emulator panel renders no fault label.
 *
 * `fix` is written for the human reading the panel. `fixPrompt` is written for
 * the agent, as an imperative clause: `workspaceFixPrompt` stitches the
 * applicable clauses into one request.
 */

/** Every eligibility reason *except* "no workspace selected" — that state shows no panel. */
export type WorkspaceFaultReason = Exclude<DeployEligibilityReason, "workspace_not_selected">;

export interface WorkspaceFaultCopy {
  /** One line, the headline. Names the fault; shown in the always-visible strip. */
  title: string;
  /** One line, what the fault means. Shown in the strip beside the title. */
  detail: string;
  /** One line, the concrete fix. Shown in the expandable detail area. */
  fix: string;
  /** Imperative clause handed to the agent when the user asks it to fix the fault. */
  fixPrompt: string;
}

export const WORKSPACE_FAULT_COPY: Record<WorkspaceFaultReason, WorkspaceFaultCopy> = {
  missing_pyproject: {
    title: "Missing pyproject.toml",
    detail: "No pyproject.toml in the workspace",
    fix: "Create a pyproject.toml with [project] name, version, dependencies",
    fixPrompt:
      "create a pyproject.toml with a [project] table containing a non-empty name and version and pydartsnut in dependencies",
  },
  pyproject_unparseable: {
    title: "pyproject.toml does not parse",
    detail: "TOML syntax error",
    fix: "Fix the TOML syntax",
    fixPrompt: "fix the TOML syntax error in pyproject.toml",
  },
  pyproject_no_project_table: {
    title: "No [project] table",
    detail: "pyproject.toml parses but lacks a [project] table",
    fix: "Add a [project] table",
    fixPrompt: "add a [project] table to pyproject.toml",
  },
  pyproject_bad_dependencies: {
    title: "Bad dependencies entry",
    detail: "[project].dependencies is not an array of strings",
    fix: "Declare dependencies as a list of strings",
    fixPrompt: "declare [project].dependencies in pyproject.toml as a list of strings",
  },
  missing_project_name: {
    title: "No project name",
    detail: "[project].name is empty in pyproject.toml",
    fix: "Set [project].name in pyproject.toml",
    fixPrompt: "set a non-empty [project].name in pyproject.toml",
  },
  missing_project_version: {
    title: "No project version",
    detail: "[project].version is empty in pyproject.toml",
    fix: "Set [project].version in pyproject.toml",
    fixPrompt: "set a non-empty [project].version in pyproject.toml",
  },
  missing_pydartsnut: {
    title: "pydartsnut not declared",
    detail: "[project].dependencies does not include pydartsnut, program will not run on device",
    fix: "Add pydartsnut to [project].dependencies in pyproject.toml",
    fixPrompt: "add pydartsnut to [project].dependencies in pyproject.toml",
  },
  conf_unparseable: {
    title: "conf.json does not parse",
    detail: "JSON syntax error in conf.json",
    fix: "Fix the conf.json syntax",
    fixPrompt: "fix the JSON syntax error in conf.json",
  },
  conf_not_object: {
    title: "conf.json is not an object",
    detail: "conf.json top level is not a JSON object",
    fix: "Replace conf.json with a JSON object",
    fixPrompt: "replace conf.json with a JSON object",
  },
  conf_missing_widget_keys: {
    title: "conf.json missing widget keys",
    detail: "conf.json declares a widget but lacks size/fields",
    fix: "Add size and fields",
    fixPrompt: "add size and fields to conf.json, or set its type to game",
  },
  missing_main_py: {
    title: "No main.py",
    detail: "The project has no main.py, so it cannot run",
    fix: "Rename entry point to main.py",
    fixPrompt: "create or rename the entry point to main.py at the workspace root",
  },
};

/** Fallback for a reason code the renderer does not know yet. */
export const UNKNOWN_WORKSPACE_FAULT_COPY: WorkspaceFaultCopy = {
  title: "TODO: workspace needs attention",
  detail: "TODO: shown when the reason code has no copy entry",
  fix: "TODO: open workspace settings, or report the code",
  fixPrompt: "make the workspace runnable again",
};

export function workspaceFaultCopy(reason: string): WorkspaceFaultCopy {
  return WORKSPACE_FAULT_COPY[reason as WorkspaceFaultReason] ?? UNKNOWN_WORKSPACE_FAULT_COPY;
}

/**
 * One prompt covering every fault the backend reported, so the agent fixes the
 * workspace in a single pass instead of one problem per turn.
 */
export function workspaceFixPrompt(problems: readonly string[]): string {
  const clauses: string[] = [];
  for (const problem of problems) {
    const clause = workspaceFaultCopy(problem).fixPrompt.trim().replace(/\.$/, "");
    if (clause && !clauses.includes(clause)) {
      clauses.push(clause);
    }
  }
  const list = clauses.length > 0 ? clauses.join("; ") : UNKNOWN_WORKSPACE_FAULT_COPY.fixPrompt;
  return `The workspace is not runnable: ${list}. Make the minimum changes needed to leave it runnable, preserve the requested behavior and unrelated files, then finish.`;
}
