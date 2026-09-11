import { describe, expect, it } from "vitest";
import type { AgentToolCallEvent } from "@dartsnut/desktop-contracts";
import {
  appendToolEventToTimeline,
  describeTimelineError,
  interruptPendingTimelineTools,
  timelineToolRunStatus,
  type TimelineEntry
} from "./rawTimeline";

describe("describeTimelineError", () => {
  it("turns a raw fetch failure into an actionable message", () => {
    expect(describeTimelineError("fetch failed")).toEqual({
      title: "Couldn’t reach the model service",
      message: "Check your internet connection, VPN, or firewall, then try again."
    });
  });

  it("keeps an underlying network error available as technical detail", () => {
    expect(describeTimelineError("Connection error: getaddrinfo ENOTFOUND api.example.com")).toEqual({
      title: "Couldn’t reach the model service",
      message: "Check your internet connection, VPN, or firewall, then try again."
    });
  });
});

const started = (callId: string, toolName = "read_file", at = 1): AgentToolCallEvent => ({
  type: "tool_call",
  phase: "started",
  runId: "run-1",
  callId,
  toolName,
  at,
  inputPreview: { path: `${callId}.txt` }
});

const finished = (
  callId: string,
  status: "succeeded" | "failed" = "succeeded",
  at = 10
): AgentToolCallEvent => ({
  type: "tool_call",
  phase: "finished",
  runId: "run-1",
  callId,
  toolName: "read_file",
  at,
  status,
  durationMs: at - 1,
  resultPreview: status === "succeeded" ? { ok: true } : { ok: false },
  ...(status === "failed" ? { error: "read failed" } : {})
});

describe("tool timeline reducer", () => {
  it("groups contiguous calls and starts a new group after visible content", () => {
    let entries: TimelineEntry[] = [];
    entries = appendToolEventToTimeline(entries, started("a"));
    entries = appendToolEventToTimeline(entries, started("b", "grep_files", 2));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolRun?.calls).toHaveLength(2);

    entries.push({ id: "agent", role: "agent", text: "Checking next." });
    entries = appendToolEventToTimeline(entries, started("c", "glob_files", 3));
    expect(entries).toHaveLength(3);
  });

  it("patches parallel results out of order and ignores duplicates", () => {
    let entries = appendToolEventToTimeline([], started("a"));
    entries = appendToolEventToTimeline(entries, started("b", "grep_files", 2));
    entries = appendToolEventToTimeline(entries, finished("b", "failed", 8));
    entries = appendToolEventToTimeline(entries, finished("a", "succeeded", 9));
    const duplicate = appendToolEventToTimeline(entries, finished("a", "failed", 10));
    expect(duplicate).toEqual(entries);
    expect(entries[0]?.toolRun?.calls.map((call) => call.status)).toEqual(["succeeded", "failed"]);
    expect(timelineToolRunStatus(entries[0]!.toolRun!)).toBe("problem");
  });

  it("marks persisted started-only calls interrupted", () => {
    const entries = interruptPendingTimelineTools(appendToolEventToTimeline([], started("a")));
    expect(entries[0]?.toolRun?.calls[0]).toMatchObject({
      status: "interrupted",
      error: "Tool result was not persisted."
    });
  });
});
