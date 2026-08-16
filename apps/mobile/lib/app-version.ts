/**
 * App version helpers for the GitHub-Release update flow.
 *
 * `compareVersions` is the only entry point the rest of the codebase needs;
 * parsing rules live here so the "is this tag newer than what's installed"
 * decision is unit-tested in the Node vitest lane. Matches the semantic
 * versioning shape used by the fork's release tags (`v0.1.0`, `v0.1.1`, …).
 */
export type VersionComparison = -1 | 0 | 1;

/**
 * Split a version string like `v0.1.0+build7` / `1.0.0-rc.1` into its numeric
 * segments. Leading `v` is stripped, prerelease/build suffixes are dropped,
 * and every segment must be a plain integer. Returns `null` when the input is
 * not a dotted numeric version at all (empty, `abc`, `1.2.x`).
 */
export function parseVersionSegments(version: string): number[] | null {
  const bare = version.trim().replace(/^[vV]/, "");
  if (!bare) return null;
  const [core] = bare.split(/[-+]/);
  const segments = core.split(".").map((part) => part.trim());
  if (segments.some((part) => !/^\d+$/.test(part))) return null;
  if (segments.some((part) => part.length > 1 && part.startsWith("0"))) {
    // "01.2" is not valid semver; treat as malformed rather than guessing.
    return null;
  }
  return segments.map(Number);
}

/**
 * Compare two version strings. Returns -1 / 0 / 1 mirroring
 * `String.prototype.localeCompare` semantics of the *number* value. Runs on
 * numeric segment ordering so `0.1.0 < 0.10.0` while a lexicographic compare
 * would disagree. Any malformed input makes the whole comparison resolve to
 * `0` — callers treat that as "no update", the safe direction.
 */
export function compareVersions(a: string, b: string): VersionComparison {
  const pa = parseVersionSegments(a);
  const pb = parseVersionSegments(b);
  if (!pa || !pb) return 0;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? 0;
    const sb = pb[i] ?? 0;
    if (sa < sb) return -1;
    if (sa > sb) return 1;
  }
  return 0;
}