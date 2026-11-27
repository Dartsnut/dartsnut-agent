import { describe, expect, it } from "vitest";
import {
  BUTTON_KEYS,
  DART_COUNT,
  DART_VARIABLES,
  FACE_BUTTONS,
  buttonKey,
  computeGeometry,
  dartMessage,
  isInsideStage,
  padClickToPanel,
  panelToScratch,
  scratchKeyFor
} from "./scratchInput";

describe("scratch panel geometry", () => {
  it("letterboxes a 4:3 stage into the square play area exactly as the firmware does", () => {
    const g = computeGeometry();
    // 128/480 is the binding ratio, so the stage fills the width and 96 rows
    // remain, centred at y=16..111 with 16 black rows above and below.
    expect(g.width).toBe(128);
    expect(g.height).toBe(96);
    expect(g.ox).toBe(0);
    expect(g.oy).toBe(16);
  });

  it("treats the letterbox bands as outside the stage", () => {
    expect(isInsideStage(64, 0)).toBe(false);
    expect(isInsideStage(64, 15)).toBe(false);
    expect(isInsideStage(64, 16)).toBe(true);
    expect(isInsideStage(64, 111)).toBe(true);
    expect(isInsideStage(64, 112)).toBe(false);
    expect(isInsideStage(64, 127)).toBe(false);
  });

  it("drops a hit in the band rather than clamping it to the edge", () => {
    // Clamping would let a throw that visibly missed the stage still score,
    // which is the one divergence from hardware worth a test of its own.
    expect(panelToScratch(64, 4)).toBeNull();
    expect(panelToScratch(64, 124)).toBeNull();
  });

  it("maps stage centre and corners into Scratch coordinates", () => {
    // Centre of 128x96 at oy=16 is (64, 16 + 48) = (64, 64).
    const centre = panelToScratch(64, 64);
    expect(centre).not.toBeNull();
    expect(centre!.x).toBeCloseTo(0, 5);
    expect(centre!.y).toBeCloseTo(0, 5);

    // Top-left inside the stage maps to the stage's top-left corner.
    const topLeft = panelToScratch(0, 16);
    expect(topLeft!.x).toBeCloseTo(-240, 5);
    expect(topLeft!.y).toBeCloseTo(180, 5);

    const bottomRight = panelToScratch(127, 111);
    expect(bottomRight!.x).toBeGreaterThan(230);
    expect(bottomRight!.y).toBeLessThan(-170);
  });
});

describe("dart messages", () => {
  it("carries a valid dart through with its index", () => {
    const message = dartMessage(3, 64, 64);
    expect(message).not.toBeNull();
    expect(message!.index).toBe(3);
    expect(message!.x).toBeCloseTo(0, 5);
    expect(message!.y).toBeCloseTo(0, 5);
  });

  it("sends nothing at all for a hit in the band", () => {
    expect(dartMessage(1, 64, 2)).toBeNull();
    expect(dartMessage(1, 64, 126)).toBeNull();
  });

  it("refuses an index outside the twelve darts", () => {
    expect(dartMessage(0, 64, 64)).toBeNull();
    expect(dartMessage(DART_COUNT + 1, 64, 64)).toBeNull();
    expect(dartMessage(1.5, 64, 64)).toBeNull();
  });

  it("exposes the same three variables and broadcast the runner writes", () => {
    expect([...DART_VARIABLES]).toEqual(["dart_x", "dart_y", "dart_index"]);
    expect(DART_COUNT).toBe(12);
  });
});

describe("face buttons", () => {
  it("maps each button to the key the editor's key hat reports", () => {
    expect(buttonKey("a")).toBe(BUTTON_KEYS.a);
    expect(buttonKey("b")).toBe("x");
    expect(buttonKey("up")).toBe("ArrowUp");
    expect(buttonKey("down")).toBe("ArrowDown");
    expect(buttonKey("left")).toBe("ArrowLeft");
    expect(buttonKey("right")).toBe("ArrowRight");
  });

  it("has no equivalent for home or reserved, so they are not forwarded", () => {
    expect(buttonKey("home")).toBeNull();
    expect(buttonKey("reserved")).toBeNull();
    expect(buttonKey("nonsense")).toBeNull();
  });

  it("offers exactly the six mapped buttons", () => {
    expect([...FACE_BUTTONS]).toHaveLength(6);
    for (const button of FACE_BUTTONS) {
      expect(buttonKey(button)).not.toBeNull();
    }
  });
});

describe("keyboard forwarding", () => {
  it("maps the laptop keys a kid would use to the same names as the buttons", () => {
    expect(scratchKeyFor(" ")).toBe(" ");
    expect(scratchKeyFor("x")).toBe("x");
    expect(scratchKeyFor("ArrowUp")).toBe("ArrowUp");
    expect(scratchKeyFor("ArrowLeft")).toBe("ArrowLeft");
  });

  it("ignores keys the device cannot produce", () => {
    // Forwarding everything would let a project bind to a key hardware lacks.
    expect(scratchKeyFor("Enter")).toBeNull();
    expect(scratchKeyFor("q")).toBeNull();
    expect(scratchKeyFor("Shift")).toBeNull();
    expect(scratchKeyFor("Escape")).toBeNull();
  });
});

describe("pad clicks", () => {
  it("maps the rendered pad onto play-area pixels", () => {
    // Centre of a 128x128 pad is play-area centre.
    expect(padClickToPanel(64, 64, 128, 128)).toEqual({ px: 64, py: 64 });
    // The origin corner.
    expect(padClickToPanel(0, 0, 128, 128)).toEqual({ px: 0, py: 0 });
  });

  it("scales a pad rendered at another size", () => {
    // A 96px pad is the CSS size; the play area stays 128 pixels wide.
    expect(padClickToPanel(48, 48, 96, 96)).toEqual({ px: 64, py: 64 });
    expect(padClickToPanel(96, 96, 96, 96)).toEqual({ px: 128, py: 128 });
  });

  it("refuses a degenerate pad rather than dividing by zero", () => {
    expect(padClickToPanel(10, 10, 0, 96)).toBeNull();
    expect(padClickToPanel(10, 10, 96, 0)).toBeNull();
  });

  it("refuses a click outside the pad", () => {
    expect(padClickToPanel(-1, 10, 128, 128)).toBeNull();
    expect(padClickToPanel(200, 10, 128, 128)).toBeNull();
  });
});
