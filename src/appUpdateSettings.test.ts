import { describe, expect, it } from "vitest";
import type { AppUpdateStatus } from "@dartsnut/desktop-contracts";
import { appUpdateSettingsModel } from "./appUpdateSettings";

function status(
  kind: AppUpdateStatus["kind"],
  availableVersion: string | null = null
): AppUpdateStatus {
  return {
    kind,
    currentVersion: "1.0.0",
    availableVersion,
    percent: null,
    message: null
  };
}

describe("app update Settings row", () => {
  it("keeps a skipped available update visible and maps Update to download", () => {
    const skippedStatus = {
      ...status("available", "1.1.0"),
      dismissedVersion: "1.1.0"
    };

    expect(appUpdateSettingsModel(skippedStatus, null, false)).toEqual({
      description: "Version 1.1.0 is available.",
      label: "Update",
      action: "download",
      disabled: false
    });
  });

  it("maps a ready update to installation and prevents duplicate clicks while installing", () => {
    expect(appUpdateSettingsModel(status("ready", "1.1.0"), null, true)).toEqual({
      description: "Version 1.1.0 is ready to install.",
      label: "Preparing...",
      action: "install",
      disabled: true
    });
  });

  it("keeps checking and downloading states non-actionable", () => {
    expect(appUpdateSettingsModel(status("checking"), null, false)).toMatchObject({
      label: "Checking...",
      action: "check",
      disabled: true
    });
    expect(appUpdateSettingsModel(status("downloading", "1.1.0"), null, false)).toMatchObject({
      description: "Downloading version 1.1.0.",
      label: "Downloading...",
      disabled: true
    });
  });
});
