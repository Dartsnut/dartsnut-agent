import { describe, expect, it } from "vitest";
import {
  isSameCommunityVersion,
  mergeCommunityVersionHistory
} from "./communityVersionHistory";
import type { CommunityVersionSummary } from "@dartsnut/desktop-contracts";

function version(overrides: Partial<CommunityVersionSummary> = {}): CommunityVersionSummary {
  return {
    id: 10,
    appSystemId: 20,
    projectType: "game",
    version: "1.0.1",
    description: "Release notes",
    status: "1",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    reviewAction: "",
    reviewComment: "",
    reviewedAt: null,
    preview: ["https://example.test/preview.png"],
    ...overrides
  };
}

describe("community version history", () => {
it("retains a successful submission while list results lag", () => {
  const pending = version({ id: "pending:game:20:1.0.1" });
  const result = mergeCommunityVersionHistory([], [pending]);

  expect(result.versions).toEqual([pending]);
  expect(result.pendingVersions).toEqual([pending]);
});

it("replaces a pending row with the authoritative response", () => {
  const pending = version({ id: "pending:game:20:1.0.1", status: "1" });
  const server = version({ id: 99, status: "2", reviewAction: "approve" });
  const result = mergeCommunityVersionHistory([server], [pending]);

  expect(result.versions).toEqual([server]);
  expect(result.pendingVersions).toEqual([]);
});

it("acknowledges an exact id even when the version label differs", () => {
  expect(isSameCommunityVersion(version({ id: 99, version: "1.0.1" }), version({ id: 99, version: "1.0.2" }))).toBe(true);
});
});
