import { afterEach, describe, expect, it, vi } from "vitest";

const { setShellUiTheme } = vi.hoisted(() => ({
  setShellUiTheme: vi.fn(async (_theme: string) => undefined)
}));

vi.mock("./lib/tauriClient", () => ({
  tauriClient: { setShellUiTheme }
}));

import { applyTheme } from "./theme";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
});

describe("applyTheme", () => {
  it("keeps system as the shell preference while resolving renderer colors", () => {
    const stored = new Map<string, string>();
    let shellTheme: string | null = null;
    const dataset: Record<string, string> = {};
    const darkClasses = new Set<string>();

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => stored.set(key, value)
        },
        matchMedia: () => ({ matches: true })
      }
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: {
          dataset,
          classList: {
            toggle: (name: string, enabled: boolean) => enabled ? darkClasses.add(name) : darkClasses.delete(name),
            contains: (name: string) => darkClasses.has(name)
          }
        }
      }
    });

    applyTheme("system");
    shellTheme = setShellUiTheme.mock.calls.at(-1)?.[0] ?? null;

    expect(dataset.theme).toBe("light");
    expect(darkClasses.has("dark")).toBe(false);
    expect(stored.get("dartsnut-theme")).toBe("system");
    expect(shellTheme).toBe("system");
  });
});
