export async function fetchGithubReleaseNotes(version: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(
    `https://api.github.com/repos/Dartsnut/dartsnut-agent/releases/tags/${encodeURIComponent(version)}`,
    { headers: { Accept: "application/vnd.github+json" }, signal }
  );
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed: ${response.status}`);
  }

  const release: unknown = await response.json();
  if (
    !release || typeof release !== "object" ||
    !("tag_name" in release) || release.tag_name !== version ||
    ("draft" in release && release.draft === true) ||
    !("body" in release) || (release.body !== null && typeof release.body !== "string")
  ) {
    throw new Error("GitHub release response is invalid");
  }
  return release.body?.trim() || null;
}
