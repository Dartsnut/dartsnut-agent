import { describe, expect, it, vi } from "vitest";
import type { AppUpdateStatus } from "@dartsnut/desktop-contracts";
import { createAutomaticAppUpdateDownloader } from "./appUpdateAutoDownload";

function status(kind: AppUpdateStatus["kind"], availableVersion: string | null = null): AppUpdateStatus {
  return {
    kind,
    currentVersion: "1.0.0",
    availableVersion,
    percent: null,
    message: null
  };
}

describe("automatic app update downloads", () => {
  it("downloads an available version once when enabled", () => {
    const download = vi.fn();
    const onStatus = createAutomaticAppUpdateDownloader(download);

    onStatus(status("available", "1.1.0"), false);
    expect(download).not.toHaveBeenCalled();

    onStatus(status("available", "1.1.0"), true);
    onStatus(status("available", "1.1.0"), true);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("allows another attempt after a new check and ignores non-available states", () => {
    const download = vi.fn();
    const onStatus = createAutomaticAppUpdateDownloader(download);

    onStatus(status("ready", "1.1.0"), true);
    onStatus(status("available"), true);
    onStatus(status("available", "1.1.0"), true);
    onStatus(status("checking"), true);
    onStatus(status("available", "1.1.0"), true);

    expect(download).toHaveBeenCalledTimes(2);
  });
});
