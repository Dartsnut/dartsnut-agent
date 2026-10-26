import type { ProjectType, WidgetConfigSnapshot } from "@dartsnut/desktop-contracts";
import type { WorkspaceFaultReason } from "./workspaceFaultCopy";

export function shouldShowWidgetParams(
  projectType: string | null | undefined,
  configStatus: WidgetConfigSnapshot["status"],
): boolean {
  const normalizedProjectType = projectType?.toLowerCase() ?? null;
  if (normalizedProjectType === "widget") return true;
  if (normalizedProjectType === "game") return false;
  return configStatus === "ready";
}

export function isWidgetConfigForWorkspace(
  confPath: string | null | undefined,
  workspacePath: string | null | undefined,
): boolean {
  if (!confPath || !workspacePath) return false;
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedConfigPath = normalize(confPath);
  const normalizedWorkspacePath = normalize(workspacePath);
  return normalizedConfigPath === `${normalizedWorkspacePath}/conf.json`;
}

export function isResolvedEmulatorWorkspace(
  stateWorkspacePath: string | null | undefined,
  workspacePath: string | null | undefined,
): boolean {
  if (!workspacePath) return false;
  if (!stateWorkspacePath) return true;
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalize(stateWorkspacePath) === normalize(workspacePath);
}

export function isRunningProcessWorkspaceMismatch(
  processRunning: boolean,
  processPath: string | null | undefined,
  workspacePath: string | null | undefined,
): boolean {
  return Boolean(
    processRunning &&
      processPath &&
      workspacePath &&
      !isResolvedEmulatorWorkspace(processPath, workspacePath),
  );
}

export function resolveEmulatorProjectType(
  processType: string | null | undefined,
  processRunning: boolean,
  processPath: string | null | undefined,
  workspaceType: ProjectType | null | undefined,
  workspacePath: string | null | undefined,
): ProjectType | null {
  const normalizedProcessType = processType?.toLowerCase();
  const knownProcessType = normalizedProcessType === "game" || normalizedProcessType === "widget"
    ? normalizedProcessType
    : null;
  if (processRunning && knownProcessType) {
    return knownProcessType;
  }
  if (workspaceType === "game" || workspaceType === "widget") {
    return workspaceType;
  }
  if (processPath && isResolvedEmulatorWorkspace(processPath, workspacePath) && knownProcessType) {
    return knownProcessType;
  }
  return null;
}

export function canStartOrReloadEmulator(
  workspacePath: string | null | undefined,
  options: { workspaceFaulted?: boolean } = {},
): boolean {
  if (options.workspaceFaulted) return false;
  return Boolean(workspacePath?.trim());
}

/**
 * A running emulator pinned to a different, valid workspace is the more
 * specific truth: the user is looking at a stale panel, not a broken project.
 * The workspace fault label yields to it.
 */
export function shouldShowWorkspaceFaultLabel(
  faultReason: WorkspaceFaultReason | null | undefined,
  runningProcessWorkspaceMismatch: boolean,
): boolean {
  return Boolean(faultReason) && !runningProcessWorkspaceMismatch;
}
