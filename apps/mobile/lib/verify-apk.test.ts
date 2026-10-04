/**
 * Guards the artifact package-identity check in scripts/verify-apk.mjs.
 *
 * Why this test exists: the iteration-186 release APKs shipped with a manifest
 * naming `ai.multica.mobile` and an embedded app config naming
 * `ai.multica.mobile.dev`. The old verify-apk.mjs only looked at native `.so`
 * entries, so it reported OK on all four — the script whose whole job is to
 * catch a bad artifact was the reason nobody noticed.
 *
 * The decision is exercised here as a pure function; `readEmbeddedConfigPackage`
 * / `readManifestPackage` are covered by the script's own run against real APKs.
 */
import { describe, expect, it } from "vitest";
import {
  checkPackageIdentity,
  checkReleasePackage,
  readDeclaredReleasePackage,
} from "../scripts/verify-apk.mjs";

describe("checkPackageIdentity", () => {
  it("accepts an artifact whose manifest and embedded config agree", () => {
    const verdict = checkPackageIdentity("ai.multica.mobile", "ai.multica.mobile");
    expect(verdict.ok).toBe(true);
    expect(verdict.note).toContain("ai.multica.mobile");
  });

  it("rejects the iteration-186 shape — production manifest, dev config", () => {
    // The exact defect: the app installs as one package while every
    // `Constants.expoConfig` consumer sees another.
    const verdict = checkPackageIdentity(
      "ai.multica.mobile",
      "ai.multica.mobile.dev",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain("ai.multica.mobile");
    expect(verdict.error).toContain("ai.multica.mobile.dev");
  });

  it("rejects a mismatch in the other direction too", () => {
    const verdict = checkPackageIdentity(
      "ai.multica.mobile.dev",
      "ai.multica.mobile",
    );
    expect(verdict.ok).toBe(false);
  });

  it("rejects an embedded config that is present but unusable", () => {
    // `null` means "the entry is there and unreadable / names no package",
    // which is a broken artifact, not an artifact without one.
    expect(checkPackageIdentity("ai.multica.mobile", null).ok).toBe(false);
  });

  it("accepts an artifact with no embedded config at all", () => {
    // `undefined` means the entry is absent — a plain native build. Nothing can
    // disagree, so this is not a failure.
    const verdict = checkPackageIdentity("ai.multica.mobile", undefined);
    expect(verdict.ok).toBe(true);
    expect(verdict.note).toContain("no embedded app.config");
  });
});

describe("checkReleasePackage", () => {
  /** Declaration shape for a successful read. */
  const declared = (androidPackage: string) => ({ ok: true as const, androidPackage });

  it("accepts an artifact matching the declared release package", () => {
    const verdict = checkReleasePackage("ai.multica.mobile.dev", declared("ai.multica.mobile.dev"));
    expect(verdict.ok).toBe(true);
  });

  it("rejects the v0.6.17 drift — a self-consistent artifact on a moved channel", () => {
    // The exact defect. This artifact agrees with itself, so
    // `checkPackageIdentity` reports OK; only a comparison against a value that
    // outlives the artifact can see that the whole channel moved.
    const verdict = checkReleasePackage("ai.multica.mobile", declared("ai.multica.mobile.dev"));
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain("package drift");
    expect(verdict.error).toContain("ai.multica.mobile.dev");
  });

  it("fails, rather than passing, when the declaration cannot be read", () => {
    // A check that cannot read what it compares against has not verified
    // anything. Reporting OK in that state is the same failure mode as the
    // defect itself — a check that says OK because it never looked — so this
    // is a build failure, not a soft skip.
    const verdict = checkReleasePackage("ai.multica.mobile", {
      ok: false,
      error: "no release-identity.json",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain("cannot assert");
  });

  it("reads the declaration from tracked source", () => {
    // The declaration has to be a file in the repo, not a constant inside the
    // script, or the runtime check in lib/release-identity.ts cannot share it.
    const result = readDeclaredReleasePackage();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.androidPackage).toBe("ai.multica.mobile.dev");
  });

  it("resolves the declaration from the script's own location, not the cwd", () => {
    // The script is invoked from apps/mobile, but a caller running it from the
    // repo root (`node apps/mobile/scripts/verify-apk.mjs <apk>`) must still
    // find the declaration. Resolving against process.cwd() silently degraded
    // to "channel id not asserted" — a passing build whose channel was never
    // checked.
    const cwd = process.cwd();
    try {
      process.chdir("/");
      const result = readDeclaredReleasePackage();
      expect(result.ok).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it("fails when a directory carries no declaration", () => {
    const result = readDeclaredReleasePackage("/nonexistent-dir-for-test");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("release-identity.json");
  });
});
