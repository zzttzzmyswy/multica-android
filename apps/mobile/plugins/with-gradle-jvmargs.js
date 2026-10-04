// Android build config-plugin: raise the Gradle daemon's metaspace ceiling,
// which the prebuild template leaves at 512m.
//
// The generated apps/mobile/android/ tree is gitignored (Expo prebuild output),
// so the template's value
//
//     org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m
//
// cannot be corrected in tracked source. Iteration 183 saw an all-ABI
// `assembleRelease` fail on its closing tasks with the daemon reporting it had
// run out of JVM metaspace, and worked around it by passing
// `-Dorg.gradle.jvmargs="-Xmx8g -XX:MaxMetaspaceSize=2g"` by hand.
//
// Iteration 184 could not reproduce that failure: four all-ABI release builds
// at 512m all succeeded, with no metaspace message in the log. So this splice is
// defence against a failure mode, not a documented repro — see
// docs/android-build.md, which says so plainly.
//
// It is safe to keep unconditionally: it only raises a ceiling below 1 GiB, it
// leaves a deliberately raised value alone, and -Xmx is a ceiling rather than a
// reservation, so the headroom costs nothing on a smaller machine.
//
// Override with a CLI `-Dorg.gradle.jvmargs=...` (a -D beats gradle.properties).
// Do not edit the generated gradle.properties — the next prebuild overwrites it.
//
// CommonJS on purpose: Expo's config-plugin resolver requires plugin modules
// through Node `require`, so a plain .js module works where a raw .ts would
// fail to resolve.
const { withGradleProperties } = require("@expo/config-plugins");

const JVM_ARGS = "-Xmx8g -XX:MaxMetaspaceSize=2g";

// The template's ceiling is 512m; anything below this gets replaced.
const MIN_METASPACE_MB = 1024;

const MARKER =
  "Multica: metaspace headroom for all-ABI release builds (plugins/with-gradle-jvmargs.js)";

/** Metaspace ceiling (MiB) in a jvmargs string, or null when it sets none. */
function metaspaceMb(value) {
  const match = /-XX:MaxMetaspaceSize=(\d+)([kKmMgG]?)/.exec(value ?? "");
  if (!match) return null;
  const n = Number(match[1]);
  switch ((match[2] || "m").toLowerCase()) {
    case "g":
      return n * 1024;
    case "k":
      return n / 1024;
    default:
      return n; // bare or explicit m
  }
}

/**
 * Raise `org.gradle.jvmargs` in a `withGradleProperties` modResults array.
 * In-place, idempotent, and a no-op when the existing ceiling is already high
 * enough — a hand-raised ceiling is a deliberate choice, not a stale default.
 */
function raiseGradleJvmargs(mods) {
  const entry = mods.find(
    (p) => p.type === "property" && p.key === "org.gradle.jvmargs",
  );

  if (!entry) {
    mods.push({ type: "comment", value: MARKER });
    mods.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    return mods;
  }

  const current = metaspaceMb(entry.value);
  if (current !== null && current < MIN_METASPACE_MB) {
    entry.value = JVM_ARGS;
  }
  return mods;
}

module.exports = function withGradleJvmargs(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = raiseGradleJvmargs(cfg.modResults);
    return cfg;
  });
};

module.exports.JVM_ARGS = JVM_ARGS;
module.exports.MIN_METASPACE_MB = MIN_METASPACE_MB;
module.exports.MARKER = MARKER;
module.exports.metaspaceMb = metaspaceMb;
module.exports.raiseGradleJvmargs = raiseGradleJvmargs;
