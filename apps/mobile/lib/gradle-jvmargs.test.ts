/**
 * Guards the Gradle metaspace splice (plugins/with-gradle-jvmargs.js).
 *
 * Why this test exists: the ceiling the prebuild template writes (512m) is too
 * low for an all-ABI release build, and the failure it produces — a daemon
 * `OutOfMemoryError: Metaspace` during the closing packaging tasks — points at
 * merge/pack rather than at the ceiling that caused it. Four consecutive
 * iterations rediscovered this from scratch because the workaround lived in a
 * hand-typed `-D` flag. The splice is now the durable fix, so these tests pin
 * its behaviour: it must raise the low ceiling, must leave a hand-raised one
 * alone, and must not append duplicates when prebuild runs over a tree it has
 * already touched.
 */
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../plugins/with-gradle-jvmargs.js") as {
  JVM_ARGS: string;
  MIN_METASPACE_MB: number;
  MARKER: string;
  metaspaceMb: (value: string) => number | null;
  raiseGradleJvmargs: (
    mods: { type: string; key?: string; value?: string }[],
  ) => { type: string; key?: string; value?: string }[];
};

/** The `org.gradle.jvmargs` entry of a modResults array, or undefined. */
function jvmargsEntry(mods: ReturnType<typeof plugin.raiseGradleJvmargs>) {
  return mods.find(
    (p) => p.type === "property" && p.key === "org.gradle.jvmargs",
  );
}

// Exactly what `expo prebuild` writes into the generated gradle.properties.
const TEMPLATE = [
  { type: "comment", value: "# Project-wide Gradle settings." },
  { type: "property", key: "org.gradle.jvmargs", value: "-Xmx2048m -XX:MaxMetaspaceSize=512m" },
  { type: "property", key: "org.gradle.parallel", value: "true" },
];

describe("with-gradle-jvmargs", () => {
  it("raises the template's 512m metaspace ceiling", () => {
    const out = plugin.raiseGradleJvmargs([...TEMPLATE]);
    expect(jvmargsEntry(out)?.value).toBe(plugin.JVM_ARGS);
    expect(plugin.metaspaceMb(plugin.JVM_ARGS)).toBeGreaterThanOrEqual(
      plugin.MIN_METASPACE_MB,
    );
  });

  it("preserves the other gradle.properties entries", () => {
    const out = plugin.raiseGradleJvmargs([...TEMPLATE]);
    expect(out).toHaveLength(TEMPLATE.length);
    expect(out.some((p) => p.key === "org.gradle.parallel")).toBe(true);
  });

  it("is idempotent — a second pass over its own output changes nothing", () => {
    const once = plugin.raiseGradleJvmargs([...TEMPLATE]);
    const twice = plugin.raiseGradleJvmargs(once);
    expect(twice).toEqual(once);
    expect(twice.filter((p) => p.key === "org.gradle.jvmargs")).toHaveLength(1);
  });

  it("does not stack marker comments when it inserted the entry itself", () => {
    const bare = [{ type: "property", key: "org.gradle.parallel", value: "true" }];
    const once = plugin.raiseGradleJvmargs(bare);
    const twice = plugin.raiseGradleJvmargs(once);
    expect(twice).toEqual(once);
    expect(twice.filter((p) => p.value === plugin.MARKER)).toHaveLength(1);
  });

  it("leaves a hand-raised ceiling alone", () => {
    const raised = [
      { type: "property", key: "org.gradle.jvmargs", value: "-Xmx16g -XX:MaxMetaspaceSize=4g" },
    ];
    expect(jvmargsEntry(plugin.raiseGradleJvmargs(raised))?.value).toBe(
      "-Xmx16g -XX:MaxMetaspaceSize=4g",
    );
  });

  it("adds the entry when gradle.properties has none", () => {
    const out = plugin.raiseGradleJvmargs([{ type: "property", key: "org.gradle.parallel", value: "true" }]);
    expect(jvmargsEntry(out)?.value).toBe(plugin.JVM_ARGS);
    expect(out.some((p) => p.value === plugin.MARKER)).toBe(true);
  });

  it.each([
    ["-XX:MaxMetaspaceSize=512m", 512],
    ["-XX:MaxMetaspaceSize=2g", 2048],
    ["-XX:MaxMetaspaceSize=1024", 1024],
    ["-Xmx8g", null],
    ["", null],
  ])("reads the ceiling from %s", (value, expected) => {
    expect(plugin.metaspaceMb(value)).toBe(expected);
  });
});
