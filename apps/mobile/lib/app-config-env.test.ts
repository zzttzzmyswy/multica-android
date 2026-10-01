/**
 * Guards the embedded-app-config splice (plugins/with-app-config-env.js).
 *
 * Why this test exists: `expo prebuild` and `./gradlew assembleRelease` are
 * different processes, and only the first is given `APP_ENV`. expo-constants'
 * `createExpoConfig` task re-evaluates app.config.ts in a fresh Node process at
 * Gradle time, so without this splice it falls back to "development" and the
 * APK ships an embedded config naming `ai.multica.mobile.dev` while its manifest
 * — and the app actually installed on the device — is `ai.multica.mobile`.
 *
 * That divergence is invisible to every existing check: the build succeeds, the
 * five native libs are present, the APK installs. It surfaced only through the
 * self-update flow's unknown-sources deep-link, which read the embedded config
 * and scoped users to a package they did not have.
 *
 * The splice sets APP_ENV on that one task from the applicationId Gradle is
 * already building, so the two ends cannot disagree whatever env the gradle
 * invocation carries.
 */
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../plugins/with-app-config-env.js") as {
  MARKER: string;
  PACKAGE_TO_ENV: [string, string][];
  appEnvForPackage: (pkg: string) => string;
  spliceProjectBuildGradle: (contents: string) => string;
  SPLICE: string;
};

/** Run the plugin's splice over a root build.gradle's contents. */
function splice(contents: string): string {
  return plugin.spliceProjectBuildGradle(contents);
}

describe("appEnvForPackage", () => {
  it("maps the production package to production", () => {
    expect(plugin.appEnvForPackage("ai.multica.mobile")).toBe("production");
  });

  it("maps the staging package to staging, not production", () => {
    // The two ids share a prefix; a naive `startsWith` or a first-match-wins
    // ordering on the shorter id would collapse staging onto production.
    expect(plugin.appEnvForPackage("ai.multica.mobile.staging")).toBe("staging");
  });

  it("falls back to development for an unrecognised package", () => {
    // A local fork that changed the package id must still build; it just gets
    // the dev identity, which is the same thing app.config.ts does with no
    // APP_ENV set.
    expect(plugin.appEnvForPackage("com.example.fork")).toBe("development");
    expect(plugin.appEnvForPackage("")).toBe("development");
  });
});

describe("with-app-config-env splice", () => {
  it("sets APP_ENV on the createExpoConfig task", () => {
    const out = splice("// root build.gradle\n");
    expect(out).toContain("'createExpoConfig'");
    expect(out).toContain("t.environment 'APP_ENV'");
  });

  it("derives the value from the app module's applicationId", () => {
    const out = splice("// root build.gradle\n");
    expect(out).toContain("applicationId");
    expect(out).toMatch(/rootProject\.findProject\(':app'\)/);
  });

  it("carries every package the app.config.ts table can produce", () => {
    const out = splice("// root build.gradle\n");
    for (const [pkg, env] of plugin.PACKAGE_TO_ENV) {
      expect(out).toContain(`if (appId == '${pkg}') return '${env}'`);
    }
  });

  it("is idempotent — a second prebuild does not stack the splice", () => {
    const once = splice("// root build.gradle\n");
    const twice = splice(once);
    expect(twice).toBe(once);
    expect(twice.split(plugin.MARKER)).toHaveLength(2);
  });

  it("preserves the pre-existing root build.gradle contents", () => {
    const original = "buildscript {\n  // existing\n}\n";
    expect(splice(original).startsWith(original)).toBe(true);
  });
});
