// Android build config-plugin: give the Gradle daemon enough metaspace that a
// plain all-ABI `assembleRelease` survives.
//
// The generated apps/mobile/android/ tree is gitignored (Expo prebuild output),
// and the template prebuild emits hardcodes
//
//     org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m
//
// Past ~512m of metaspace the daemon dies on the closing packaging tasks with
// `OutOfMemoryError: Metaspace` — the stack points at merge/pack, not at the
// ceiling that killed it. The workaround was to pass
// `-Dorg.gradle.jvmargs="-Xmx8g -XX:MaxMetaspaceSize=2g"` on every invocation,
// which is easy to forget and invisible from a fresh checkout. Splice the safe
// values in at prebuild time instead, so the default is correct. See
// docs/android-build.md.
//
// -Xmx is a ceiling, not a reservation, so the headroom costs nothing on a
// smaller machine; the metaspace ceiling is the one that has to clear 512m.
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
