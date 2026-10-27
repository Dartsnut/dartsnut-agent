import { useEffect } from "react";

/**
 * Clears a transient message after `ms`. Shared by every toast-like state so
 * the timings stay visible in one place instead of three copy-pasted effects.
 */
export function useAutoDismiss(
  value: string | null,
  ms: number,
  clear: (next: null) => void,
): void {
  useEffect(() => {
    if (!value) return;
    const timeout = window.setTimeout(() => clear(null), ms);
    return () => window.clearTimeout(timeout);
  }, [clear, ms, value]);
}
