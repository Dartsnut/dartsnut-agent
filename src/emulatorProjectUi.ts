import type { ProjectType, WidgetConfigSnapshot } from "@dartsnut/desktop-contracts";

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

export function canStartOrReloadEmulator(workspacePath: string | null | undefined): boolean {
  return Boolean(workspacePath?.trim());
}
