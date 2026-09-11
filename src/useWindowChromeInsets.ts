import { useLayoutEffect } from "react";
import type { WindowChromeInsets } from "@dartsnut/desktop-contracts";
import { tauriClient } from "./lib/tauriClient";

function applyWindowChromeInsetsCssVars(insets: WindowChromeInsets): void {
  const root = document.documentElement;
  root.style.setProperty("--window-control-inset-top", `${insets.top}px`);
  root.style.setProperty("--window-control-inset-left", `${insets.left}px`);
  root.style.setProperty("--window-control-inset-right", `${insets.right}px`);
  root.style.setProperty("--window-control-inset-bottom", `${insets.bottom}px`);
}

/** Syncs native window chrome safe-area into `:root` CSS variables for `.app-shell` padding. */
export function useWindowChromeInsets(): void {
  useLayoutEffect(() => {
    void tauriClient.getWindowChromeInsets()
      .then(applyWindowChromeInsetsCssVars)
      .catch(() => applyWindowChromeInsetsCssVars({ top: 0, left: 0, right: 0, bottom: 0 }));
    try {
      return tauriClient.onWindowChromeInsets(applyWindowChromeInsetsCssVars);
    } catch {
      return undefined;
    }
  }, []);
}
