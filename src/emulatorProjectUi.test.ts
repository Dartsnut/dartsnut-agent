import { describe, expect, it } from "vitest";
import { canStartOrReloadEmulator, isResolvedEmulatorWorkspace, isRunningProcessWorkspaceMismatch, isWidgetConfigForWorkspace, resolveEmulatorProjectType, shouldShowWidgetParams } from "./emulatorProjectUi";

describe("emulator project UI", () => {
  it("hides widget params for games despite a stale ready config", () => {
    expect(shouldShowWidgetParams("game", "ready")).toBe(false);
    expect(shouldShowWidgetParams("GAME", "ready")).toBe(false);
  });

  it("shows widget params for widgets", () => {
    expect(shouldShowWidgetParams("widget", "not_widget")).toBe(true);
  });

  it("uses config readiness only until project type resolves", () => {
    expect(shouldShowWidgetParams(null, "ready")).toBe(true);
    expect(shouldShowWidgetParams(null, "not_widget")).toBe(false);
  });

  it("enables start/reload when an active workspace is available", () => {
    expect(canStartOrReloadEmulator("/projects/demo")).toBe(true);
    expect(canStartOrReloadEmulator("  ")).toBe(false);
  });

  it("rejects config from previous workspace", () => {
    expect(isWidgetConfigForWorkspace("/projects/old/conf.json", "/projects/new")).toBe(false);
    expect(isWidgetConfigForWorkspace("C:\\projects\\new\\conf.json", "C:\\projects\\new")).toBe(true);
  });

  it("does not show stale emulator type during workspace switch", () => {
    expect(isResolvedEmulatorWorkspace("/projects/old", "/projects/new")).toBe(false);
    expect(isResolvedEmulatorWorkspace(null, "/projects/new")).toBe(true);
  });

  it("keeps running process type authoritative for card selection", () => {
    expect(resolveEmulatorProjectType("game", true, "/projects/old", "widget", "/projects/new")).toBe("game");
    expect(resolveEmulatorProjectType("widget", true, "/projects/old", "game", "/projects/new")).toBe("widget");
    expect(resolveEmulatorProjectType("game", false, "/projects/old", "widget", "/projects/new")).toBe("widget");
  });

  it("detects a running process from another workspace", () => {
    expect(isRunningProcessWorkspaceMismatch(true, "/projects/old", "/projects/new")).toBe(true);
    expect(isRunningProcessWorkspaceMismatch(true, "/projects/new", "/projects/new")).toBe(false);
    expect(isRunningProcessWorkspaceMismatch(false, "/projects/old", "/projects/new")).toBe(false);
    expect(isRunningProcessWorkspaceMismatch(true, null, "/projects/new")).toBe(false);
  });

});
