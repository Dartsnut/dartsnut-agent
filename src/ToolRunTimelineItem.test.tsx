import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolCallDetails, ToolRunTimelineItem } from "./ToolRunTimelineItem";
import type { TimelineToolRun } from "./rawTimeline";

function run(status: "running" | "succeeded" | "failed"): TimelineToolRun {
  return {
    runId: "run-1",
    calls: [{
      callId: "call-1",
      toolName: "read_file",
      startedAt: 1,
      status,
      inputPreview: { path: "main.py" },
      ...(status !== "running" ? { durationMs: 42, resultPreview: { ok: status === "succeeded" } } : {}),
      ...(status === "failed" ? { error: "permission denied" } : {})
    }]
  };
}

describe("ToolRunTimelineItem", () => {
  it("renders running tool groups collapsed with accessible disclosure state", () => {
    const markup = renderToStaticMarkup(<ToolRunTimelineItem run={run("running")} />);
    expect(markup).toContain("Reading main.py · 1 tool");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("Input</span>");
  });

  it("renders completed and failed summaries", () => {
    expect(renderToStaticMarkup(<ToolRunTimelineItem run={run("succeeded")} />))
      .toContain("Used 1 tool · Read main.py");
    expect(renderToStaticMarkup(<ToolRunTimelineItem run={run("failed")} />))
      .toContain("1 of 1 tool had a problem");
  });

  it("renders structured input and failed result details", () => {
    const call = run("failed").calls[0]!;
    const markup = renderToStaticMarkup(<ToolCallDetails call={call} />);
    expect(markup).toContain("Input</span>");
    expect(markup).toContain("main.py");
    expect(markup).toContain("Error</span>");
    expect(markup).toContain("permission denied");
  });
});
