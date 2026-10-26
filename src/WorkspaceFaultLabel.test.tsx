import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceFaultLabel } from "./WorkspaceFaultLabel";
import { WORKSPACE_FAULT_COPY } from "./workspaceFaultCopy";

describe("WorkspaceFaultLabel", () => {
  it("names the fault and offers the fix for the given reason", () => {
    const copy = WORKSPACE_FAULT_COPY.missing_main_py;
    const markup = renderToStaticMarkup(
      <WorkspaceFaultLabel reason="missing_main_py" onRetry={vi.fn()} retrying={false} defaultExpanded />
    );
    expect(markup).toContain(copy.title);
    expect(markup).toContain(copy.detail);
    expect(markup).toContain(copy.fix);
  });

  it("keeps the fix text collapsed until asked", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceFaultLabel reason="missing_main_py" onRetry={vi.fn()} retrying={false} />
    );
    expect(markup).not.toContain(WORKSPACE_FAULT_COPY.missing_main_py.fix);
  });

  it("itemises every problem when the backend reported several", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceFaultLabel
        reason="missing_project_name"
        problems={["missing_project_name", "missing_project_version", "missing_pydartsnut"]}
        onRetry={vi.fn()}
        retrying={false}
        defaultExpanded
      />
    );
    for (const problem of ["missing_project_name", "missing_project_version", "missing_pydartsnut"] as const) {
      expect(markup).toContain(WORKSPACE_FAULT_COPY[problem].fix);
    }
    expect(markup).toContain("+2 more");
  });

  it("is announced as an alert", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceFaultLabel reason="missing_pyproject" onRetry={vi.fn()} retrying={false} />
    );
    expect(markup).toContain('role="alert"');
  });

  it("exposes a retry control that blocks while a retry is in flight", () => {
    const idle = renderToStaticMarkup(
      <WorkspaceFaultLabel reason="missing_pyproject" onRetry={vi.fn()} retrying={false} />
    );
    const busy = renderToStaticMarkup(
      <WorkspaceFaultLabel reason="missing_pyproject" onRetry={vi.fn()} retrying />
    );
    expect(idle).not.toContain('disabled=""');
    expect(busy).toContain('disabled=""');
  });

  it("does not render a dismiss control", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceFaultLabel reason="conf_unparseable" onRetry={vi.fn()} retrying={false} />
    );
    expect(markup).not.toContain("Dismiss");
  });
});
