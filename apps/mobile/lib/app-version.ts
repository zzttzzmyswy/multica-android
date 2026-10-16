/**
 * App version helpers for the GitHub-Release update flow.
 *
 * `compareVersions` is the only entry point the rest of the codebase needs;
 * parsing rules live here so the "is this tag newer than what's installed"
 * decision is unit-tested in the Node vitest lane.
 *
 * ## Why the tag is not simply "a version with a leading v"
 *
 * Release tags on this fork are namespaced: server / CLI / desktop ship `v*`
 * while the Android channel ships `mobile-v*` (apps/mobile/CLAUDE.md, "Build &
 * release" — the mobile cadence is deliberately decoupled from main's tags).
 * The prefix changed on 2026-10-11 at `mobile-v0.6.59`; before that the channel
 * published bare `v0.6.58`.
 *
 * The first implementation stripped exactly one leading `v` and rejected every
 * segment that was not all digits, so `mobile-v0.6.83` parsed to `null` and
 * `compareVersions` reported 0 — i.e. "equal", i.e. "you're on the latest
 * version". Nothing about that was loud: the About page showed an up-to-date
 * claim over a `latestTag` that plainly disagreed with the installed version.
 * The update channel was dead for ~40 releases and the UI said so only in the
 * negative. Hence the two rules below:
 *
 *   1. A release tag is `<namespace>-...-v<semver>` — strip a leading run of
 *      `name-` segments, then an optional `v`, then read the numeric core.
 *   2. "I could not read these two versions" must be distinguishable from
 *      "these two versions are equal". Callers need to say "can't tell", not
 *      inherit a confident-looking 0.
 */
export type VersionComparison = -1 | 0 | 1;

/**
 * Outcome of a comparison. `null` is the unreadable case and is deliberately
 * NOT collapsed into `0`: `0` means the two versions were both read and are
 * equal, `null` means at least one could not be read at all. Callers that can
 * only act on an ordering should use `compareVersions`, which keeps the old
 * safe-direction `0`; callers that render a claim to the user should branch on
 * `null` and say the check failed.
 */
export type VersionOrdering = VersionComparison | null;

/**
 * Pull the numeric core out of a release tag or app version.
 *
 * Accepts `0.1.0`, `v0.1.0`, `mobile-v0.6.83`, `mobile-v0.6.83-rc.1`,
 * `android-release-v1.2.3+build7`. Returns `null` when the string carries no
 * leading dotted-numeric version at all (empty, `abc`, `dev`, `1.2.x`).
 */
export function parseVersionSegments(version: string): number[] | null {
  const trimmed = version.trim();
  if (!trimmed) return null;

  // Namespace segments (`mobile-`) then the `v` marker. Each namespace segment
  // must itself be letters/digits/dots — that keeps this from swallowing the
  // leading digits of a bare `0.6.83`, which has no prefix to strip at all.
  const namespaced = trimmed.match(
    /^(?:[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*-)+[vV]?(\d+(?:\.\d+)*)/,
  );
  // No namespace: allow the bare `v` marker in front of the digits.
  const bare = namespaced ? null : trimmed.match(/^[vV]?(\d+(?:\.\d+)*)/);
  const core = namespaced?.[1] ?? bare?.[1];
  if (!core) return null;

  const segments = core.split(".").map((part) => part.trim());
  if (segments.some((part) => !/^\d+$/.test(part))) return null;
  if (segments.some((part) => part.length > 1 && part.startsWith("0"))) {
    // "01.2" is not valid semver; treat as malformed rather than guessing.
    return null;
  }
  return segments.map(Number);
}

/**
 * Compare two version strings, distinguishing "unreadable" from "equal".
 * Returns -1 / 0 / 1 by numeric segment order (`0.1.0 < 0.10.0`, where a
 * lexicographic compare would disagree) and `null` when either side cannot be
 * read.
 *
 * A trailing namespace suffix that is not part of the version (`-12-gabc1234`
 * git-describe output) is ignored — the leading numeric core still orders it,
 * which is what the daemon actually wants to know.
 */
export function orderVersions(a: string, b: string): VersionOrdering {
  const pa = parseVersionSegments(a);
  const pb = parseVersionSegments(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? 0;
    const sb = pb[i] ?? 0;
    if (sa < sb) return -1;
    if (sa > sb) return 1;
  }
  return 0;
}

/**
 * Compare two version strings. Returns -1 / 0 / 1. Any malformed input makes
 * the whole comparison resolve to `0` — callers treat that as "no update", the
 * safe direction for *deciding whether to offer a download*.
 *
 * This is the ordering-only view; it cannot express "unreadable". UI that
 * shows the user a claim about their version should use `orderVersions` so an
 * unreadable tag renders as a failed check rather than as "up to date".
 */
export function compareVersions(a: string, b: string): VersionComparison {
  return orderVersions(a, b) ?? 0;
}
