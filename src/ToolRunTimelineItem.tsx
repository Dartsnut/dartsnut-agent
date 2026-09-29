import { memo, useState } from "react";
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleX,
  LoaderCircle,
  MinusCircle
} from "lucide-react";
import type { TimelineToolCall, TimelineToolRun } from "./rawTimeline";
import { timelineToolRunStatus } from "./rawTimeline";

function previewObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const PATCH_FILE_HEADER = /^\*\*\* (?:Add File|Update File|Delete File): (.+)$/m;

function firstPatchPath(patch: string): string | null {
  const match = patch.match(PATCH_FILE_HEADER);
  return match?.[1] ?? null;
}

function patchLineDiff(patch: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) deleted += 1;
  }
  return { added, deleted };
}

function inputPath(call: TimelineToolCall): string | null {
  const input = previewObject(call.inputPreview);
  if (call.toolName === "apply_patch" && typeof input?.patch === "string") {
    const path = firstPatchPath(input.patch);
    if (path) return path;
  }
  const value = input?.path ?? input?.source;
  return typeof value === "string" && value.trim() ? value : null;
}

export function callDiff(call: TimelineToolCall): { added: number; deleted: number } | null {
  const input = previewObject(call.inputPreview);
  if (!input) return null;
  if (call.toolName === "apply_patch" && typeof input.patch === "string") {
    return patchLineDiff(input.patch);
  }
  return null;
}

export function actionLabel(call: TimelineToolCall): string {
  const path = inputPath(call);
  const running = call.status === "running";
  const labels: Record<string, [string, string]> = {
    list_files: ["Listing files", "Listed files"],
    glob_files: ["Finding files", "Found files"],
    grep_files: ["Searching files", "Searched files"],
    read_file: ["Reading", "Read"],
    apply_patch: ["Patching", "Patched"],
    get_dartsnut_skill: ["Loading skill", "Loaded skill"],
    check_python: ["Checking Python", "Checked Python"],
    reload_emulator: ["Reloading emulator", "Reloaded emulator"],
    observe_emulator: ["Observing display", "Observed display"],
    get_emulator_logs: ["Fetching emulator logs", "Fetched emulator logs"],
    control_emulator_input: ["Controlling emulator", "Controlled emulator"],
    run_emulator_scenario: ["Running emulator scenario", "Ran emulator scenario"]
  };
  const pair = labels[call.toolName];
  const base = pair ? pair[running ? 0 : 1] : `${running ? "Running" : "Finished"} ${call.toolName}`;
  if (call.toolName === "apply_patch") {
    const input = previewObject(call.inputPreview);
    const patch = typeof input?.patch === "string" ? input.patch : "";
    if (patch.includes("*** Move to: ") && patch.includes("*** Update File: ")) {
      const from = patch.match(/^\*\*\* Update File: (.+)$/m)?.[1];
      const to = patch.match(/^\*\*\* Move to: (.+)$/m)?.[1];
      if (from && to) return `${base} ${from} → ${to}`;
    }
  }
  return path ? `${base} ${path}` : base;
}

function durationLabel(durationMs?: number): string | null {
  if (durationMs == null) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function statusLabel(status: TimelineToolCall["status"]): string {
  return status === "running" ? "Running" : status.charAt(0).toUpperCase() + status.slice(1);
}

function previewText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StatusIcon({ status }: { status: TimelineToolCall["status"] }) {
  if (status === "running") return <LoaderCircle className="tool-run__spinner" size={14} aria-hidden />;
  if (status === "succeeded") return <Check size={14} aria-hidden />;
  if (status === "failed") return <CircleX size={14} aria-hidden />;
  if (status === "refused") return <Ban size={14} aria-hidden />;
  if (status === "skipped") return <MinusCircle size={14} aria-hidden />;
  return <CircleAlert size={14} aria-hidden />;
}

export function ToolCallDetails({ call }: { call: TimelineToolCall }) {
  return <div className="tool-run-call__details">
    {call.inputPreview !== undefined ? <div className="tool-run-call__preview">
      <span>Input</span><pre>{previewText(call.inputPreview)}</pre>
    </div> : null}
    {call.resultPreview !== undefined || call.error ? <div className="tool-run-call__preview">
      <span>{call.status === "failed" ? "Error" : "Result"}</span>
      <pre>{previewText(call.error ?? call.resultPreview)}</pre>
    </div> : null}
  </div>;
}

function ToolCallRow({ call }: { call: TimelineToolCall }) {
  const [open, setOpen] = useState(false);
  const hasDetails = call.inputPreview !== undefined || call.resultPreview !== undefined || Boolean(call.error);
  const diff = callDiff(call);
  return (
    <li className={`tool-run-call tool-run-call--${call.status}`}>
      <button
        type="button"
        className="tool-run-call__summary"
        aria-expanded={hasDetails ? open : undefined}
        disabled={!hasDetails}
        onClick={() => hasDetails && setOpen((value) => !value)}
      >
        <span className="tool-run-call__state"><StatusIcon status={call.status} /></span>
        <span className="tool-run-call__label">{actionLabel(call)}</span>
        {diff ? <span className="tool-run-call__diff" aria-label="Line changes">
          <span className="entry-status-detail__add">+{diff.added}</span>
          <span className="entry-status-detail__del">-{diff.deleted}</span>
        </span> : null}
        <span className="tool-run-call__status">{statusLabel(call.status)}</span>
        {durationLabel(call.durationMs) ? <span className="tool-run-call__duration">{durationLabel(call.durationMs)}</span> : null}
        {hasDetails ? open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden /> : null}
      </button>
      {open ? <ToolCallDetails call={call} /> : null}
    </li>
  );
}

export const ToolRunTimelineItem = memo(function ToolRunTimelineItem({ run }: { run: TimelineToolRun }) {
  const [open, setOpen] = useState(false);
  const status = timelineToolRunStatus(run);
  const active = [...run.calls].reverse().find((call) => call.status === "running");
  const last = run.calls.at(-1);
  const problemCount = run.calls.filter((call) => call.status !== "running" && call.status !== "succeeded").length;
  const summary = status === "running"
    ? `${active ? actionLabel(active) : "Using tools"} · ${run.calls.length} ${run.calls.length === 1 ? "tool" : "tools"}`
    : status === "problem"
      ? `${problemCount} of ${run.calls.length} ${run.calls.length === 1 ? "tool" : "tools"} had a problem`
      : `Used ${run.calls.length} ${run.calls.length === 1 ? "tool" : "tools"}${last ? ` · ${actionLabel(last)}` : ""}`;
  return (
    <div className={`tool-run tool-run--${status}`}>
      <button type="button" className="tool-run__summary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="tool-run__state">
          {status === "running" ? <LoaderCircle className="tool-run__spinner" size={15} aria-hidden />
            : status === "succeeded" ? <Check size={15} aria-hidden /> : <CircleAlert size={15} aria-hidden />}
        </span>
        <span className="tool-run__label" role="status">{summary}</span>
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
      </button>
      {open ? <ol className="tool-run__rail">{run.calls.map((call) => <ToolCallRow key={call.callId} call={call} />)}</ol> : null}
    </div>
  );
});
