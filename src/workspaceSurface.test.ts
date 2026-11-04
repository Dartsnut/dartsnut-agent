import { describe, expect, it } from "vitest";
import {
  isScratchWorkspace,
  resolveWorkspaceSurface,
  shouldShowEmulatorPane,
  shouldShowPersonaPicker,
  workspaceProjectKind,
} from "./workspaceSurface";

const python = { projectKind: "python" as const };
const scratch = { projectKind: "scratch" as const };

describe("workspace surface decisions", () => {
  it("reads the kind the backend sent, and nothing else", () => {
    expect(workspaceProjectKind(python)).toBe("python");
    expect(workspaceProjectKind(scratch)).toBe("scratch");
    expect(workspaceProjectKind({ projectKind: null })).toBeNull();
    expect(workspaceProjectKind(null)).toBeNull();
    expect(workspaceProjectKind(undefined)).toBeNull();
  });

  it("routes a Scratch workspace away from the chat surface", () => {
    expect(resolveWorkspaceSurface(scratch)).toBe("scratch-notice");
    expect(resolveWorkspaceSurface(python)).toBe("chat");
  });

  it("shows no workspace surface before a workspace is selected", () => {
    expect(resolveWorkspaceSurface({ projectKind: null })).toBe("none");
    expect(resolveWorkspaceSurface(null)).toBe("none");
  });

  it("never offers a persona picker on a Scratch workspace", () => {
    expect(shouldShowPersonaPicker(scratch, "picking")).toBe(false);
    expect(shouldShowPersonaPicker(python, "picking")).toBe(true);
  });

  it("keeps the persona picker off every phase that is not picking", () => {
    for (const phase of ["idle", "ready", "hydrating", "creating-chat", "creating-project", "booting"]) {
      expect(shouldShowPersonaPicker(python, phase)).toBe(false);
    }
  });

  it("hides the emulator pane for Scratch and keeps it for Python", () => {
    const scratchSelected = { ...scratch, workspaceRoot: "/projects/game" };
    const pythonSelected = { ...python, workspaceRoot: "/projects/demo" };
    expect(shouldShowEmulatorPane(scratchSelected, { runtimeSetupVisible: false })).toBe(false);
    expect(shouldShowEmulatorPane(pythonSelected, { runtimeSetupVisible: false })).toBe(true);
  });

  it("keeps runtime setup outranking the pane decision", () => {
    const pythonSelected = { ...python, workspaceRoot: "/projects/demo" };
    expect(shouldShowEmulatorPane(pythonSelected, { runtimeSetupVisible: true })).toBe(false);
  });

  it("shows no emulator pane without a selected workspace", () => {
    expect(shouldShowEmulatorPane(null, { runtimeSetupVisible: false })).toBe(false);
    expect(
      shouldShowEmulatorPane({ projectKind: "python", workspaceRoot: null }, { runtimeSetupVisible: false }),
    ).toBe(false);
  });

  it("treats only the exact scratch kind as Scratch", () => {
    expect(isScratchWorkspace(scratch)).toBe(true);
    expect(isScratchWorkspace(python)).toBe(false);
    expect(isScratchWorkspace({ projectKind: null })).toBe(false);
    // A future kind must not silently inherit the Scratch surface.
    expect(isScratchWorkspace({ projectKind: "python" })).toBe(false);
  });
});
