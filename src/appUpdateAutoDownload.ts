import type { AppUpdateStatus } from "@dartsnut/desktop-contracts";

export function createAutomaticAppUpdateDownloader(download: () => void) {
  let attemptedVersion: string | null = null;

  return (status: AppUpdateStatus | null, enabled: boolean): void => {
    if (status?.kind === "checking") {
      attemptedVersion = null;
      return;
    }
    if (
      !enabled ||
      status?.kind !== "available" ||
      !status.availableVersion ||
      attemptedVersion === status.availableVersion
    ) {
      return;
    }
    attemptedVersion = status.availableVersion;
    download();
  };
}
