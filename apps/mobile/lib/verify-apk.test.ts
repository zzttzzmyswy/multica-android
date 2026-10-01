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
import { checkPackageIdentity } from "../scripts/verify-apk.mjs";

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
