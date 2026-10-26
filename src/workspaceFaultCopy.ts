import type { DeployEligibilityReason } from "@dartsnut/desktop-contracts";

/**
 * Copy for the sticky workspace-fault label shown in the emulator panel.
 *
 * Every string below is a PLACEHOLDER. Replace the bodies, keep the keys: the
 * keys mirror the `reason` codes produced by `classify_dartsnut_project_files`
 * and `workspace_runnable` (src-tauri/src/commands.rs).
 *
 * `workspace_not_selected` is deliberately absent: no workspace is selected, so
 * the emulator panel renders no fault label for it.
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
}

export const WORKSPACE_FAULT_COPY: Record<WorkspaceFaultReason, WorkspaceFaultCopy> = {
  missing_pyproject: {
    title: "TODO: missing pyproject.toml",
    detail: "TODO: no pyproject.toml in the workspace",
    fix: "TODO: create a pyproject.toml with [project] name, version, dependencies",
  },
  pyproject_unparseable: {
    title: "TODO: pyproject.toml does not parse",
    detail: "TODO: TOML syntax error",
    fix: "TODO: fix the TOML syntax",
  },
  pyproject_no_project_table: {
    title: "TODO: no [project] table",
    detail: "TODO: pyproject.toml parses but lacks a [project] table",
    fix: "TODO: add a [project] table",
  },
  pyproject_bad_dependencies: {
    title: "TODO: bad dependencies entry",
    detail: "TODO: [project].dependencies is not an array of strings",
    fix: "TODO: declare dependencies as a list of strings",
  },
  missing_project_name: {
    title: "TODO: no project name",
    detail: "TODO: [project].name is empty",
    fix: "TODO: set [project].name",
  },
  missing_project_version: {
    title: "TODO: no project version",
    detail: "TODO: [project].version is empty",
    fix: "TODO: set [project].version",
  },
  missing_pydartsnut: {
    title: "TODO: pydartsnut not declared",
    detail: "TODO: [project].dependencies does not include pydartsnut",
    fix: "TODO: add pydartsnut to [project].dependencies",
  },
  conf_unparseable: {
    title: "TODO: conf.json does not parse",
    detail: "TODO: JSON syntax error in conf.json",
    fix: "TODO: fix the conf.json syntax",
  },
  conf_not_object: {
    title: "TODO: conf.json is not an object",
    detail: "TODO: conf.json top level is not a JSON object",
    fix: "TODO: replace conf.json with a JSON object",
  },
  conf_missing_widget_keys: {
    title: "TODO: conf.json missing widget keys",
    detail: "TODO: conf.json declares a widget but lacks size/fields",
    fix: "TODO: add size and fields, or set type to game",
  },
  missing_main_py: {
    title: "TODO: no main.py",
    detail: "TODO: the project has no main.py, so it cannot run",
    fix: "TODO: create main.py",
  },
};

/** Fallback for a reason code the renderer does not know yet. */
export const UNKNOWN_WORKSPACE_FAULT_COPY: WorkspaceFaultCopy = {
  title: "TODO: workspace needs attention",
  detail: "TODO: shown when the reason code has no copy entry",
  fix: "TODO: open workspace settings, or report the code",
};

export function workspaceFaultCopy(reason: string): WorkspaceFaultCopy {
  return WORKSPACE_FAULT_COPY[reason as WorkspaceFaultReason] ?? UNKNOWN_WORKSPACE_FAULT_COPY;
}
