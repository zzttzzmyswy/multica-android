/**
 * Guards `lib/release-identity.ts` — the check that stops an in-app update from
 * installing a second app instead of upgrading this one.
 *
 * Why this test exists: every release from v0.4.0 to v0.6.15 installed as
 * `ai.multica.mobile.dev`. v0.6.17 shipped as `ai.multica.mobile`, so an
 * existing user's "check for updates" downloaded an APK that Android considers
 * a *different application* — the installer created a second icon, left the old
 * app and its data untouched, and returned `Success`. Nothing in the update flow
 * noticed, because the package was never compared to anything.
 *
 * Two independent facts are pinned here, and they fail for different reasons:
 *
 *   - the declared channel id matches `app.config.ts`'s release branch, so the
 *     single source of truth cannot drift from the thing it governs;
 *   - the verdict refuses without opening the downloaded APK — the app already
 *     knows its own install package, so the comparison is between two strings.
 */
import { describe, expect, it } from "vitest";
import {
  RELEASE_ANDROID_PACKAGE,
  checkUpdateInstallTarget,
  resolveInstalledPackage,
} from "./release-identity";

/** Shape of the subset of app.config.ts this suite reads. */
type ExpoConfigExport = (ctx: { config: Record<string, unknown> }) => {
  name?: string;
  android?: { package?: string };
};

describe("RELEASE_ANDROID_PACKAGE", () => {
  it("is the id the v0.4.0–v0.6.15 releases shipped under", () => {
    // The whole point of the value: it names the install base that already
    // exists on users' devices. Changing this line is a channel migration, not
    // a refactor.
    expect(RELEASE_ANDROID_PACKAGE).toBe("ai.multica.mobile.dev");
  });

  it("is the package app.config.ts resolves in its release branch", async () => {
    // The declaration is only meaningful if the build actually honours it. A
    // mismatch here is the original defect one indirection later.
    const mod = (await import("../app.config.ts")) as unknown as {
      default: ExpoConfigExport;
    };
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      const config = mod.default({ config: {} });
      expect(config.android?.package).toBe(RELEASE_ANDROID_PACKAGE);
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
  });

  it("is what a production build names the app", async () => {
    // v0.6.17 shipped the launcher label "Multica" beside the previous
    // "Multica (Dev)", so the two installs were distinguishable on sight. The
    // label is presentation and stays as it was; only the package id is pinned.
    const mod = (await import("../app.config.ts")) as unknown as {
      default: ExpoConfigExport;
    };
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      expect(mod.default({ config: {} }).name).toBe("Multica");
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
  });
});

describe("resolveInstalledPackage", () => {
  it("reads the package out of the embedded config", () => {
    expect(
      resolveInstalledPackage({
        expoConfig: { android: { package: "ai.multica.mobile.dev" } },
      }),
    ).toBe("ai.multica.mobile.dev");
  });

  it("returns null when the config carries no package", () => {
    expect(resolveInstalledPackage({})).toBeNull();
    expect(resolveInstalledPackage({ expoConfig: null })).toBeNull();
    expect(resolveInstalledPackage({ expoConfig: { android: {} } })).toBeNull();
    expect(resolveInstalledPackage({ expoConfig: { android: { package: "" } } })).toBeNull();
  });
});

describe("checkUpdateInstallTarget", () => {
  it("allows the update when the installed package is the channel's", () => {
    const verdict = checkUpdateInstallTarget({
      expoConfig: { android: { package: RELEASE_ANDROID_PACKAGE } },
    });
    expect(verdict.ok).toBe(true);
  });

  it("refuses when the installed app is the odd prod-package build", () => {
    // The stranded cohort: an app installed from v0.6.17. It must not download
    // and hand over a channel APK, because that lands beside it, not over it.
    const verdict = checkUpdateInstallTarget({
      expoConfig: { android: { package: "ai.multica.mobile" } },
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("foreign-package");
    expect(verdict.installedPackage).toBe("ai.multica.mobile");
  });

  it("refuses staging too — it is a different app, not a newer one", () => {
    const verdict = checkUpdateInstallTarget({
      expoConfig: { android: { package: "ai.multica.mobile.staging" } },
    });
    expect(verdict.ok).toBe(false);
  });

  it("refuses when the installed package is unknown", () => {
    // Refusing is the safe direction: this is precisely the state in which we
    // cannot tell whether the download would upgrade or duplicate.
    const verdict = checkUpdateInstallTarget({});
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("unknown-package");
  });
});
