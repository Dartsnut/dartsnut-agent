import type { AppUpdateStatus } from "@dartsnut/desktop-contracts";

export type AppUpdateSettingsAction = "check" | "download" | "install";

export interface AppUpdateSettingsModel {
  description: string;
  label: string;
  action: AppUpdateSettingsAction;
  disabled: boolean;
}

export function appUpdateSettingsModel(
  status: AppUpdateStatus | null,
  error: string | null,
  installing: boolean
): AppUpdateSettingsModel {
  const availableVersion = status?.availableVersion;
  const hasUpdate = Boolean(availableVersion) && (status?.kind === "available" || status?.kind === "ready");
  const action: AppUpdateSettingsAction =
    hasUpdate && status?.kind === "available"
      ? "download"
      : hasUpdate && status?.kind === "ready"
        ? "install"
        : "check";

  let description = error;
  if (!description && status) {
    if (status.kind === "available" && availableVersion) {
      description = `Version ${availableVersion} is available.`;
    } else if (status.kind === "downloading" && availableVersion) {
      description = `Downloading version ${availableVersion}.`;
    } else if (status.kind === "ready" && availableVersion) {
      description = `Version ${availableVersion} is ready to install.`;
    } else if (status.kind === "not_available") {
      description = status.message ?? "Dartsnut Agent is up to date.";
    } else if (status.kind === "error") {
      description = status.message ?? "Update check failed.";
    }
  }

  return {
    description: description ?? "Check for a newer desktop version.",
    label: installing
      ? "Preparing..."
      : status?.kind === "checking"
        ? "Checking..."
        : status?.kind === "downloading"
          ? "Downloading..."
          : hasUpdate
            ? "Update"
            : "Check for updates",
    action,
    disabled: installing || status?.kind === "checking" || status?.kind === "downloading"
  };
}
