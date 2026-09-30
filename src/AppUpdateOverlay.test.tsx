import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppUpdateStatus } from "@dartsnut/desktop-contracts";
import { UpdateReadyOverlay } from "./App";

const availableStatus: AppUpdateStatus = {
  kind: "available",
  currentVersion: "1.5.4",
  availableVersion: "1.5.5",
  percent: 0,
  message: "Update available."
};

describe("update overlay", () => {
  it("shows manual download, skip, and auto-download preference for available updates", () => {
    const markup = renderToStaticMarkup(
      <UpdateReadyOverlay
        status={availableStatus}
        autoUpdateEnabled={false}
        installing={false}
        error={null}
        releaseNotes={{ version: "1.5.5", phase: "loaded", body: "## Changes\n\n- Improved project building\n- More resilient conversations" }}
        onDownload={vi.fn()}
        onAutoUpdateChange={vi.fn()}
        onInstallNow={vi.fn()}
        onLater={vi.fn()}
      />
    );
    expect(markup).toContain("Update available");
    expect(markup).toContain("Download update");
    expect(markup).toContain("Skip");
    expect(markup).toContain("Automatically download updates");
    expect(markup).toContain("Improved project building");
    expect(markup).toContain("More resilient conversations");
    expect(markup).toContain('data-analytics-id="app_update_download"');
  });

  it("retains install prompt after download completes", () => {
    const markup = renderToStaticMarkup(
      <UpdateReadyOverlay
        status={{ ...availableStatus, kind: "ready", percent: 100 }}
        autoUpdateEnabled={false}
        installing={false}
        error={null}
        releaseNotes={{ version: "1.5.5", phase: "loaded", body: "## Changes\n\n- Improved project building" }}
        onDownload={vi.fn()}
        onAutoUpdateChange={vi.fn()}
        onInstallNow={vi.fn()}
        onLater={vi.fn()}
      />
    );
    expect(markup).toContain("Update ready");
    expect(markup).toContain("Update now");
    expect(markup).toContain("Next launch");
    expect(markup).toContain("Improved project building");
    expect(markup).not.toContain("Automatically download updates");
  });

  it("never displays notes from another release", () => {
    const markup = renderToStaticMarkup(
      <UpdateReadyOverlay
        status={availableStatus}
        autoUpdateEnabled={false}
        installing={false}
        error={null}
        releaseNotes={{ version: "1.5.4", phase: "loaded", body: "Stale release prose" }}
        onDownload={vi.fn()}
        onAutoUpdateChange={vi.fn()}
        onInstallNow={vi.fn()}
        onLater={vi.fn()}
      />
    );
    expect(markup).not.toContain("Stale release prose");
    expect(markup).toContain("Loading release notes…");
  });

  it.each([
    [{ version: "1.5.5", phase: "loaded", body: null } as const, "No release notes published for this version."],
    [{ version: "1.5.5", phase: "error", body: null } as const, "Release notes unavailable right now."]
  ])("shows the correct empty or error message", (releaseNotes, message) => {
    const markup = renderToStaticMarkup(
      <UpdateReadyOverlay
        status={availableStatus}
        autoUpdateEnabled={false}
        installing={false}
        error={null}
        releaseNotes={releaseNotes}
        onDownload={vi.fn()}
        onAutoUpdateChange={vi.fn()}
        onInstallNow={vi.fn()}
        onLater={vi.fn()}
      />
    );
    expect(markup).toContain(message);
  });
});
