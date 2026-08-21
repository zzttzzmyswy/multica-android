/**
 * Release-version comparison for the machine CLI update section (iteration-83,
 * A2.4) — mirrors web `update-section.tsx` semantics: versions that cannot be
 * ordered against a release tag (git-describe / dev builds) never claim
 * "update available" or "Latest".
 */

/** Parses a released CLI version ("v0.4.17" / "0.4.17") into comparable parts,
 *  or null when the string is not a release version.
 *
 *  A daemon built from source reports a `git describe` string
 *  ("v0.4.17-12-gabc1234") or the ldflags default ("dev"), and neither can be
 *  ordered against a release tag. This mirrors `IsReleaseVersion` in
 *  server/internal/cli/update.go, which is how the daemon's own auto-update
 *  loop decides the same question.
 */
export function parseReleaseVersion(v: string): number[] | null {
  const parts = v.trim().replace(/^v/, "").split(".");
  if (parts.length !== 3) return null;
  const parsed: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    parsed.push(Number(part));
  }
  return parsed;
}

/** True when `latest` is strictly newer than `current`.
 *
 *  An unparseable version on either side compares as "no update available".
 *  Number("dev") is NaN, and every NaN comparison is false, so the old
 *  component-wise scan fell through to the next component and reported an
 *  upgrade for a version string it had never actually read — inviting the
 *  operator to replace a locally built binary on the strength of a claim we
 *  could not make.
 */
export function isNewer(latest: string, current: string): boolean {
  const l = parseReleaseVersion(latest);
  const c = parseReleaseVersion(current);
  if (!l || !c) return false;
  for (const [i, lv] of l.entries()) {
    const cv = c[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/multica-ai/multica/releases/latest";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let cachedLatestVersion: string | null = null;
let cachedAt = 0;

/** GitHub `releases/latest` tag name, memoized for 10 minutes. Fails silent —
 *  the update section degrades to "unknown" instead of surfacing the network
 *  error. Anonymous-accessible; no auth header needed.
 */
export async function fetchGithubLatestVersion(): Promise<string | null> {
  if (cachedLatestVersion && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedLatestVersion;
  }
  try {
    const resp = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { tag_name?: unknown };
    cachedLatestVersion = typeof data.tag_name === "string" ? data.tag_name : null;
    cachedAt = Date.now();
    return cachedLatestVersion;
  } catch {
    return null;
  }
}