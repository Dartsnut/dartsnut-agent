import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowControls } from "./WindowControls";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    isFullscreen: vi.fn().mockResolvedValue(false),
    minimize: vi.fn(),
    onResized: vi.fn().mockResolvedValue(vi.fn()),
    setFullscreen: vi.fn(),
    toggleMaximize: vi.fn()
  })
}));

afterEach(() => {
  Reflect.deleteProperty(globalThis, "navigator");
});

describe("WindowControls", () => {

  it("renders Windows controls with reference SVG icons", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });

    const markup = renderToStaticMarkup(<WindowControls />);
    expect(markup).toContain("window-controls--windows");
    expect(markup).toContain('viewBox="0 0 10 1"');
    expect(markup).toContain('viewBox="0 0 10 10"');
  });
});
