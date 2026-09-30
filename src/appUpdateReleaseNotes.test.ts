import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGithubReleaseNotes } from "./appUpdateReleaseNotes";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function mockRelease(status: number, release: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => release });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

describe("GitHub release notes", () => {
  it("requests the exact updater version, passes the abort signal, and trims Markdown", async () => {
    const fetchMock = mockRelease(200, { tag_name: "2.1.0", draft: false, body: "  # Changes\n\n- Improved project building  \n" });
    const controller = new AbortController();
    await expect(fetchGithubReleaseNotes("2.1.0", controller.signal)).resolves.toBe("# Changes\n\n- Improved project building");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/Dartsnut/dartsnut-agent/releases/tags/2.1.0",
      { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal }
    );
  });

  it("rejects missing, mismatched, draft, or malformed releases", async () => {
    const signal = new AbortController().signal;
    for (const [status, release] of [
      [404, null],
      [200, { tag_name: "2.0.0", draft: false, body: "wrong version" }],
      [200, { tag_name: "2.1.0", draft: true, body: "unpublished" }],
      [200, { tag_name: "2.1.0", body: 42 }],
      [200, { tag_name: "2.1.0" }]
    ] as const) {
      mockRelease(status, release);
      await expect(fetchGithubReleaseNotes("2.1.0", signal)).rejects.toThrow();
    }
  });

  it("returns null for empty or null bodies", async () => {
    const signal = new AbortController().signal;
    for (const body of [null, "  \n  "]) {
      mockRelease(200, { tag_name: "2.1.0", draft: false, body });
      await expect(fetchGithubReleaseNotes("2.1.0", signal)).resolves.toBeNull();
    }
  });
});
