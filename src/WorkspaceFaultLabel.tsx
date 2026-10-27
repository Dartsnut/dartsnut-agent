import { ChevronDown, LoaderCircle, RotateCw } from "lucide-react";
import { useState } from "react";
import { cn } from "./cn";
import { workspaceFaultCopy, type WorkspaceFaultReason } from "./workspaceFaultCopy";

export type WorkspaceFaultLabelProps = {
  /** Backend reason code for the workspace fault. */
  reason: WorkspaceFaultReason;
  /** Every problem the backend found; falls back to `reason` alone. */
  problems?: WorkspaceFaultReason[];
  /** Re-runs classification, then pokes the runtime when the workspace is healthy. */
  onRetry: () => void | Promise<void>;
  retrying: boolean;
  /** Starts with the fix text shown; collapsed by default. */
  defaultExpanded?: boolean;
};

/**
 * Persistent indicator that the selected workspace cannot run the emulator.
 *
 * Not dismissible by design: it reports a state, not an event. Hiding it would
 * restore the blank-panel ambiguity this exists to remove. The detail area
 * collapses; the strip does not.
 */
export function WorkspaceFaultLabel({
  reason,
  problems,
  onRetry,
  retrying,
  defaultExpanded = false,
}: WorkspaceFaultLabelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const faulted = problems && problems.length > 0 ? problems : [reason];
  const headline = workspaceFaultCopy(faulted[0]);
  return (
    <div
      className="mx-3 mt-3 flex shrink-0 flex-col gap-1.5 rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-xs text-[var(--color-error-text)]"
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{headline.title}</span>
          <span className="ml-1.5 opacity-80">{headline.detail}</span>
          {faulted.length > 1 ? (
            <span className="ml-1.5 opacity-80">+{faulted.length - 1} more</span>
          ) : null}
        </span>
        <button
          type="button"
          className="shrink-0 rounded-md border border-[var(--color-error-border)] px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--color-error-soft-bg)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={retrying}
          onClick={() => void onRetry()}
          title="Re-check the workspace and restart the emulator"
        >
          {retrying ? (
            <LoaderCircle size={12} className="animate-spin" aria-hidden />
          ) : (
            <RotateCw size={12} aria-hidden />
          )}
          <span className="ml-1">Retry</span>
        </button>
      </div>
      <button
        type="button"
        className="flex w-fit shrink-0 items-center gap-1 text-[11px] font-medium opacity-80 hover:opacity-100"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <ChevronDown size={12} className={cn("transition-transform", expanded && "rotate-180")} aria-hidden />
        What to fix
      </button>
      {expanded ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[11px] leading-relaxed opacity-90">
          {faulted.map((problem) => {
            const copy = workspaceFaultCopy(problem);
            return (
              <li key={problem} className="flex flex-col gap-0.5">
                <span className="font-medium">{copy.title}</span>
                <span>{copy.fix}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
