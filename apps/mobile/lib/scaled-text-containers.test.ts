/**
 * Guards that containers sized for text use a MINIMUM height, never a fixed
 * one (MYS-2559).
 *
 * React Native scales `fontSize` with the system font scale (and, as
 * `TextAttributeProps.kt:43` shows, `lineHeight` with it too — via
 * `toPixelFromSP`). Layout dimensions such as `h-9` do NOT scale: they are
 * plain dp. So a fixed-height box that fits its text at 1.0x stops fitting it
 * at 1.3x, and the glyphs get sheared at both edges.
 *
 * Measured on device: at font_scale 1.3 the agents search field (`h-9` inside
 * `TextField`, whose own default was `h-10`) clipped "Search agents" through
 * the middle of every glyph while the text around it rendered fine.
 *
 * `min-h-*` keeps the 1.0x rhythm and lets the box grow when the text does —
 * which is the actual requirement. The same distinction is why `flex-grow-0`
 * alone is not enough to pin a horizontal ScrollView: RN's `baseHorizontal`
 * style is `{ flexGrow: 1, flexShrink: 1 }`, so a row inside a `flex-1`
 * column still gets compressed until `shrink-0` is also set. That one clipped
 * the descenders off `Workspace` / `Specific people` / `Owner only` at EVERY
 * font scale, including 1.0.
 *
 * Why source-level: mobile's vitest lane is Node-only (see vitest.config.ts),
 * so there is no way to lay out a real Text at two font scales here.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** This file lives at `apps/mobile/lib/`, so the app root is one level up. */
const APP_ROOT = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function sourceFiles(): { path: string; text: string }[] {
  return walk(APP_ROOT).map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
}

/** Strip block and line comments — prose about a class is not the class. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("containers that hold text grow with it", () => {
  it("TextField never pins its height", () => {
    const src = stripComments(
      readFileSync(path.join(APP_ROOT, "components/ui/text-field.tsx"), "utf8"),
    );
    // `h-10` / `h-9` … as a standalone utility, not `min-h-10` / `max-h-10`.
    expect(src).not.toMatch(/(?<![\w-])h-\d/);
  });

  it("no TextField call site overrides the height to a fixed one", () => {
    const offenders: string[] = [];
    for (const { path: p, text } of sourceFiles()) {
      const src = stripComments(text);
      // Each `<TextField …>` opening tag, up to its closing `>`.
      for (const m of src.matchAll(/<TextField\b[\s\S]*?>/g)) {
        const tag = m[0];
        if (/(?<![\w-])(?:max-)?h-\d/.test(tag.replace(/\bmin-h-\d/g, ""))) {
          offenders.push(`${path.relative(APP_ROOT, p)}: ${tag.replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(
      offenders,
      "A TextField with a fixed height cannot hold its own text once the " +
        "system font scale grows. Use `min-h-*`:\n" +
        offenders.map((o) => `  ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("horizontal rows that must not compress set shrink-0", () => {
    // RN's own ScrollView base style is `{ flexGrow: 1, flexShrink: 1 }`, so
    // overriding only the grow leaves the row free to be squashed vertically
    // by a `flex-1` parent — which shears descenders off every label in it.
    const offenders: string[] = [];
    for (const { path: p, text } of sourceFiles()) {
      const src = stripComments(text);
      for (const m of src.matchAll(/<ScrollView\b[\s\S]*?>/g)) {
        const tag = m[0];
        if (!/\bhorizontal\b/.test(tag)) continue;
        if (!/className=/.test(tag)) continue;
        const cls = tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
        const value = cls?.[1] ?? cls?.[2] ?? "";
        // Only rows that deliberately opted out of growing are at risk: they
        // asked to be their natural size, and grow alone does not do that.
        if (/flex-grow-0/.test(value) && !/shrink-0/.test(value)) {
          offenders.push(`${path.relative(APP_ROOT, p)}: ${value}`);
        }
      }
    }
    expect(
      offenders,
      "`flex-grow-0` without `shrink-0` does not stop RN's horizontal " +
        "ScrollView from being compressed. Add `shrink-0`:\n" +
        offenders.map((o) => `  ${o}`).join("\n"),
    ).toEqual([]);
  });
});
