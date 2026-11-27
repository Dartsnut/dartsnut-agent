import type { BootstrapState, ProjectKind } from "@dartsnut/desktop-contracts";

/**
 * Which surface a workspace calls for, decided from the backend's project kind.
 *
 * A Scratch project has no chat: no composer, no persona, no agent. It shows the
 * block editor instead, at full body width — the chat rail's narrower column
 * clips the sprite and costume panes at the app's minimum window size, and a
 * Scratch editor that scrolls sideways is worse than none.
 */
export type WorkspaceSurface = "scratch-editor" | "chat" | "none";

type ProjectKindSource = Pick<BootstrapState, "projectKind">;

/** Read the backend's kind. `null` in, `null` out: no bootstrap, no kind. */
export function workspaceProjectKind(
  bootstrap: ProjectKindSource | null | undefined,
): ProjectKind | null {
  return bootstrap?.projectKind ?? null;
}

export function isScratchWorkspace(
  bootstrap: ProjectKindSource | null | undefined,
): boolean {
  return workspaceProjectKind(bootstrap) === "scratch";
}

/** The left-hand surface. Never infers kind from eligibility or a missing chat. */
export function resolveWorkspaceSurface(
  bootstrap: ProjectKindSource | null | undefined,
): WorkspaceSurface {
  const kind = workspaceProjectKind(bootstrap);
  if (kind === null) return "none";
  return kind === "scratch" ? "scratch-editor" : "chat";
}

/**
 * The editor owns the whole body for a Scratch project, so the chat rail's column
 * constraint must not apply to it.
 */
export function shouldUseFullBodyWidth(
  bootstrap: ProjectKindSource | null | undefined,
): boolean {
  return isScratchWorkspace(bootstrap);
}

/** No chat exists for a Scratch project, so no persona can be offered for one. */
export function shouldShowPersonaPicker(
  bootstrap: ProjectKindSource | null | undefined,
  personaPhase: string,
): boolean {
  return personaPhase === "picking" && !isScratchWorkspace(bootstrap);
}

/**
 * The emulator panel is hidden for Scratch: the editor stage is the surface the
 * user trusts, and a second rendering of the same project would be a second
 * truth. Deploy keeps its own gate and is unaffected.
 */
export function shouldShowEmulatorPane(
  bootstrap: Pick<BootstrapState, "projectKind" | "workspaceRoot"> | null | undefined,
  options: { runtimeSetupVisible: boolean },
): boolean {
  if (options.runtimeSetupVisible) return false;
  if (!bootstrap?.workspaceRoot) return false;
  return !isScratchWorkspace(bootstrap);
}
