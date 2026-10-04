/**
 * Guards the unknown-app-sources deep-link (lib/unknown-app-sources.ts) and the
 * call site that used to get it wrong.
 *
 * Why this test exists: the self-update flow's "allow installs from this
 * source" button shipped broken in a way no green build could catch. It scoped
 * the screen with `IntentLauncher`'s `extra` form, but only the **data URI**
 * form scopes it at all — measured on Android 15 / API 35, `cmd package
 * resolve-activity` sends `-e android.provider.extra.APP_PACKAGE <pkg>` to
 * `Settings$ManageExternalSourcesActivity` (the all-apps list, no per-app
 * toggle) and `-d package:<pkg>` to `Settings$ManageAppExternalSourcesActivity`
 * (this app). The button therefore could never unblock an install.
 *
 * The key was also written as the Java *symbol* name rather than the constant's
 * value, which is a second, independent defect — it changes nothing about the
 * screen, because the extras form is unscoped either way, but it is the reason
 * a reader could believe the extras form was "almost right".
 *
 * A pure helper + source assertion is the right shape here: the mobile vitest
 * lane is Node-only (vitest.config.ts) and cannot import install-update.ts,
 * which pulls in react-native.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveAppPackageName,
  unknownAppSourcesDataUri,
  unknownAppSourcesIntentParams,
} from "./unknown-app-sources";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..");

/** Source of a file relative to the mobile app root, comments stripped. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("resolveAppPackageName", () => {
  it("reads the package id out of the embedded app config", () => {
    expect(
      resolveAppPackageName({ expoConfig: { android: { package: "ai.multica.mobile" } } }),
    ).toBe("ai.multica.mobile");
  });

  it("returns null when the config or package is missing or blank", () => {
    expect(resolveAppPackageName({})).toBeNull();
    expect(resolveAppPackageName({ expoConfig: null })).toBeNull();
    expect(resolveAppPackageName({ expoConfig: {} })).toBeNull();
    expect(resolveAppPackageName({ expoConfig: { android: null } })).toBeNull();
    expect(
      resolveAppPackageName({ expoConfig: { android: { package: "" } } }),
    ).toBeNull();
    expect(
      resolveAppPackageName({ expoConfig: { android: { package: null } } }),
    ).toBeNull();
  });
});

describe("unknownAppSourcesDataUri", () => {
  it("builds the package: URI Settings resolves to the per-app screen", () => {
    expect(unknownAppSourcesDataUri("ai.multica.mobile")).toBe(
      "package:ai.multica.mobile",
    );
  });
});

describe("unknownAppSourcesIntentParams", () => {
  it("scopes the screen with a data URI, not with extras", () => {
    const params = unknownAppSourcesIntentParams({
      expoConfig: { android: { package: "ai.multica.mobile" } },
    });
    expect(params).toEqual({ data: "package:ai.multica.mobile" });
  });

  it("never emits an `extra` — that form is what made the button a no-op", () => {
    const params = unknownAppSourcesIntentParams({
      expoConfig: { android: { package: "ai.multica.mobile" } },
    });
    expect(params).not.toHaveProperty("extra");
  });

  it("falls back to an unscoped launch when no package is known", () => {
    // Unscoped opens the all-apps list: a worse screen, but a real one. The
    // alternative — a data URI naming a package that is not installed — is a
    // blank activity (measured: zero text nodes on API 35).
    expect(unknownAppSourcesIntentParams({})).toEqual({});
  });
});

describe("install-update call site", () => {
  const source = code("lib/install-update.ts");

  it("passes the helper's params to the intent launcher", () => {
    expect(source).toMatch(
      /MANAGE_UNKNOWN_APP_SOURCES,\s*unknownAppSourcesIntentParams\(\s*Constants\s*\)/,
    );
  });

  it("no longer hand-rolls an extras payload", () => {
    // Would fail if the extras form (in either spelling) came back.
    expect(source).not.toContain("EXTRA_APP_PACKAGE");
    expect(source).not.toContain("extra:");
  });
});
