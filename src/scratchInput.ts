/**
 * Dart and button input for the Scratch preview.
 *
 * This mirrors the device's runner deliberately, because a preview that diverges
 * from the device is worse than no preview: a game that scores on the laptop and
 * misses on hardware teaches the wrong thing. The firmware is the source of
 * truth for every rule here — its panel geometry, its dart variables and
 * broadcast, and its button-to-key table.
 *
 * The physical panel is 128×160, but the *play area* that dart coordinates
 * address is 128×128 at the origin. The Scratch stage is 4:3 and cannot fill a
 * square play area, so it is letterboxed to 128×96 centred at y=16..111, leaving
 * 16 black rows above and below. A hit landing in those rows is **dropped**, not
 * clamped: a throw that visibly missed the stage must not score.
 */

/** The physical panel. */
export const PANEL = { width: 128, height: 160 } as const;

/** The region dart coordinates address. */
export const PLAY = { x: 0, y: 0, width: 128, height: 128 } as const;

/** The Scratch stage's own coordinate space. */
export const STAGE = { width: 480, height: 360 } as const;

export interface StageGeometry {
  /** Panel pixels per stage pixel. */
  scale: number;
  /** Letterboxed stage size in panel pixels. */
  width: number;
  height: number;
  /** Top-left of the letterboxed stage inside the play area. */
  ox: number;
  oy: number;
}

/**
 * The letterbox, computed the same way the firmware computes it: scale to fit,
 * floor the result, and centre what is left.
 */
export function computeGeometry(): StageGeometry {
  const scale = Math.min(PLAY.width / STAGE.width, PLAY.height / STAGE.height);
  const width = Math.floor(STAGE.width * scale);
  const height = Math.floor(STAGE.height * scale);
  return {
    scale,
    width,
    height,
    ox: PLAY.x + Math.floor((PLAY.width - width) / 2),
    oy: PLAY.y + Math.floor((PLAY.height - height) / 2)
  };
}

/** True when a play-area pixel falls inside the letterboxed stage. */
export function isInsideStage(px: number, py: number): boolean {
  const g = computeGeometry();
  return px >= g.ox && px < g.ox + g.width && py >= g.oy && py < g.oy + g.height;
}

/**
 * A play-area pixel to a Scratch stage coordinate, or `null` when the hit falls
 * in the letterbox band and must be dropped.
 *
 * Returning `null` rather than the nearest edge is the whole point: the device
 * drops these, so clamping would let a visible miss score.
 */
export function panelToScratch(px: number, py: number): { x: number; y: number } | null {
  if (!isInsideStage(px, py)) return null;
  const g = computeGeometry();
  return {
    x: (px - g.ox) / g.scale - STAGE.width / 2,
    y: STAGE.height / 2 - (py - g.oy) / g.scale
  };
}

/** The stage variables the runner writes before it broadcasts. */
export const DART_VARIABLES = ["dart_x", "dart_y", "dart_index"] as const;

/** The broadcast a project listens for. */
export const DART_BROADCAST = "dart";

/** How many darts a device has. */
export const DART_COUNT = 12;

/**
 * Face button to Scratch key, matching the editor's key hat. Home and reserved
 * have no Scratch equivalent and are not forwarded.
 */
export const BUTTON_KEYS = {
  a: " ",
  b: "x",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight"
} as const;

export type FaceButton = keyof typeof BUTTON_KEYS;

export const FACE_BUTTONS: readonly FaceButton[] = ["a", "b", "up", "down", "left", "right"];

/**
 * What the host sends for a throw. `null` means the hit fell in the letterbox
 * band and the caller must send nothing at all.
 */
export function dartMessage(
  index: number,
  px: number,
  py: number
): { index: number; x: number; y: number } | null {
  const mapped = panelToScratch(px, py);
  if (!mapped) return null;
  if (!Number.isInteger(index) || index < 1 || index > DART_COUNT) return null;
  return { index, x: mapped.x, y: mapped.y };
}

/** The key name for a face button, or `null` for a button with no equivalent. */
export function buttonKey(button: string): string | null {
  return (BUTTON_KEYS as Record<string, string | undefined>)[button] ?? null;
}

/**
 * A browser key to the Scratch key name the editor's hat reports, or `null` when
 * the key has no device equivalent.
 *
 * Only the five mapped buttons and the two keyboard aliases a project can
 * already use are forwarded: forwarding every key would let a project bind to
 * keys the device cannot produce.
 */
export function scratchKeyFor(key: string): string | null {
  switch (key) {
    case " ":
    case "Spacebar":
      return " ";
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
      return key;
    case "x":
    case "X":
      return "x";
    default:
      return null;
  }
}

/**
 * A click inside the rendered pad to a play-area pixel.
 *
 * This is a decision, not layout arithmetic, so it lives here with a test rather
 * than inline in JSX: a click that maps to the wrong pixel throws a dart at the
 * wrong place, and that is exactly the failure a preview must not have.
 *
 * The pad renders the play area, so the divisor is `PLAY` — not the panel, and
 * not a bare literal that would silently disagree if the geometry changed.
 */
export function padClickToPanel(
  offsetX: number,
  offsetY: number,
  renderedWidth: number,
  renderedHeight: number
): { px: number; py: number } | null {
  if (renderedWidth <= 0 || renderedHeight <= 0) return null;
  const px = Math.round((offsetX / renderedWidth) * PLAY.width);
  const py = Math.round((offsetY / renderedHeight) * PLAY.height);
  if (px < 0 || py < 0 || px > PLAY.width || py > PLAY.height) return null;
  return { px, py };
}
