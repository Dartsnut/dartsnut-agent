import { tauriClient } from "./lib/tauriClient";

/** Start one best-effort Tauri update check after renderer listeners are ready. */
export function startTauriAppUpdateCheck(
  checkAppUpdate: () => Promise<unknown> = tauriClient.checkAppUpdate
): void {
  void Promise.resolve().then(() => {
    void checkAppUpdate().catch(() => {
      // Update checks are best effort; the updater command emits error status.
    });
  });
}
