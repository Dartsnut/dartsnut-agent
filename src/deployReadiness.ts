import type { DeployEligibility } from "@dartsnut/desktop-contracts";

/**
 * Whether the workspace is ready for the Deploy drawer.
 *
 * The backend answers `ok: true` only after it classified the folder as a real
 * project and named its kind — game, widget, or scratch. Re-listing the kinds
 * here is what silently refused Scratch workspaces: the drawer stayed shut while
 * the workspace was healthy, and the toggle blamed a fault that did not exist.
 */
export function isDeployReady(
  eligibility: DeployEligibility | null | undefined,
): boolean {
  return eligibility?.ok === true;
}
