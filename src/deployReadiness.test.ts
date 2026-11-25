import { describe, expect, it } from "vitest";
import { isDeployReady } from "./deployReadiness";

const ready = (projectType: "game" | "widget" | "scratch") =>
  ({ ok: true, appId: "demo", version: "1.0.0", projectType }) as const;

describe("deploy readiness", () => {
  // A healthy Scratch workspace reports `projectType: "scratch"`. Re-listing the
  // kinds at the gate refused it, so the drawer never opened on a workspace the
  // backend had just called fine.
  it("opens the drawer for every kind the backend classified as ok", () => {
    expect(isDeployReady(ready("game"))).toBe(true);
    expect(isDeployReady(ready("widget"))).toBe(true);
    expect(isDeployReady(ready("scratch"))).toBe(true);
  });

  it("keeps the drawer shut for a refused workspace", () => {
    expect(isDeployReady({ ok: false, reason: "missing_pyproject" })).toBe(false);
    expect(isDeployReady({ ok: false, reason: "scratch_multiple_projects" })).toBe(false);
  });

  it("keeps the drawer shut before the first classification arrives", () => {
    expect(isDeployReady(null)).toBe(false);
    expect(isDeployReady(undefined)).toBe(false);
  });
});
