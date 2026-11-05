import {
  FACE_BUTTONS,
  DART_COUNT,
  buttonKey,
  padClickToPanel,
  type FaceButton
} from "./scratchInput";

export interface ScratchControlsProps {
  /** Send a dart; the mapping decides whether the hit is inside the stage. */
  onDart: (index: number, px: number, py: number) => void;
  /** Send a face-button change. */
  onKey: (code: string, pressed: boolean) => void;
  /** The dart the next throw is attributed to. */
  dartIndex: number;
  onDartIndexChange: (index: number) => void;
  /** Darts already thrown, so they can be cleared. */
  dartCount: number;
  onClearDarts: () => void;
}

const BUTTON_LABELS: Record<FaceButton, string> = {
  a: "A",
  b: "B",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right"
};

/**
 * The device's physical inputs, for testing without hardware.
 *
 * A dart pad, the five face buttons, and a clear action. Hits outside the
 * letterboxed stage are dropped by the mapping, not clamped, so a throw that
 * visibly misses here cannot score — which is what makes the preview trustworthy.
 */
export function ScratchControls({
  onDart,
  onKey,
  dartIndex,
  onDartIndexChange,
  dartCount,
  onClearDarts
}: ScratchControlsProps) {
  return (
    <div className="scratch-controls">
      <div className="scratch-controls__darts">
        <label className="scratch-controls__dart-picker">
          <span>Dart</span>
          <select
            value={dartIndex}
            onChange={(event) => onDartIndexChange(Number(event.target.value))}
            aria-label="Which dart is being thrown"
          >
            {Array.from({ length: DART_COUNT }, (_, offset) => offset + 1).map((index) => (
              <option key={index} value={index}>
                {index}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="scratch-controls__clear"
          onClick={onClearDarts}
          disabled={dartCount === 0}
        >
          Clear darts{dartCount > 0 ? ` (${dartCount})` : ""}
        </button>
      </div>
      <div className="scratch-controls__pad" role="group" aria-label="Dart pad">
        <span className="scratch-controls__pad-hint">
          Click the play area to throw
        </span>
        <div className="scratch-controls__plot" role="presentation">
          {/* The pad is a click target over the stage rectangle only. Hits in the
              bands are sent and then dropped by the mapping, so the behaviour
              the user sees is the device's. */}
          <div
            className="scratch-controls__play-area"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              // The mapping is a decision, not layout arithmetic: it lives in
              // scratchInput with a test, so a click cannot land on the wrong
              // pixel without a test failing.
              const point = padClickToPanel(
                event.clientX - rect.left,
                event.clientY - rect.top,
                rect.width,
                rect.height
              );
              if (!point) return;
              onDart(dartIndex, point.px, point.py);
            }}
          />
        </div>
      </div>
      <div className="scratch-controls__buttons" role="group" aria-label="Face buttons">
        {FACE_BUTTONS.map((button) => (
          <button
            key={button}
            type="button"
            className="scratch-controls__button"
            onPointerDown={(event) => {
              const code = buttonKey(button);
              if (code) onKey(code, true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={() => {
              const code = buttonKey(button);
              if (code) onKey(code, false);
            }}
            onPointerCancel={() => {
              const code = buttonKey(button);
              if (code) onKey(code, false);
            }}
          >
            {BUTTON_LABELS[button]}
          </button>
        ))}
      </div>
    </div>
  );
}
