import { describe, expect, it, vi } from "vitest";
import { startTauriAppUpdateCheck } from "./appUpdateStartup";

describe("Tauri startup update check", () => {
  it("checks once when Tauri renderer starts", async () => {
    const checkAppUpdate = vi.fn(() => Promise.resolve({ ok: true }));

    startTauriAppUpdateCheck(checkAppUpdate);
    expect(checkAppUpdate).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(checkAppUpdate).toHaveBeenCalledTimes(1);
  });

  it("swallows best-effort check failures", async () => {
    const checkAppUpdate = vi.fn(() => Promise.reject(new Error("offline")));

    startTauriAppUpdateCheck(checkAppUpdate);
    expect(checkAppUpdate).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(checkAppUpdate).toHaveBeenCalledTimes(1);
  });
});
