/**
 * Wiring guards for the type-appearance setting (MYS-2931).
 *
 * `lib/type-appearance.test.ts` pins the arithmetic; this file pins that the
 * arithmetic is actually REACHED. The failure mode it exists for is the one
 * this repo has hit before: a correct helper that nothing calls, so the app
 * looks unchanged and every unit test is green.
 *
 * Everything here is checked at the source level because mobile's vitest lane
 * is Node-only (see vitest.config.ts) — there is no RN renderer to mount a
 * screen and read a computed style. What can be pinned is the set of
 * invariants whose violation produces a specific on-screen symptom:
 *
 *   1. The root must SET the variable. A scale nobody writes is a scale
 *      nothing reads, and the settings slider would move with no effect.
 *   2. The setting must be reachable from Settings. A store with no UI is a
 *      feature no one can use.
 *   3. The markdown renderer must consume it. It cannot use className, so if
 *      it does not read the store explicitly, issue bodies and comments are
 *      the one part of the app that ignores the reader's choice.
 *   4. Container heights that hold text must not be fixed (the iter-283 /
 *      MYS-2559 class): a fixed dp box cannot grow when the glyphs do.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

/** Strip comments — prose about a class is not the class. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("the root writes the scale the type ladder reads", () => {
  it("sets --font-scale from the store on the tree that renders the app", () => {
    // The variable has to sit ABOVE every screen. On the root layout it wraps
    // the whole navigator, so one component covers every route; anywhere
    // deeper and screens outside it would keep the base size.
    const src = code("app/_layout.tsx");
    expect(src).toMatch(/useFontScale/);
    expect(src).toMatch(/--font-scale/);
    // NativeWind's `vars()` is what converts a plain object into the
    // VariableContext value descendants resolve `var()` against. Writing an
    // inline style object instead would set a CSS-looking property that no
    // class reads.
    expect(src).toMatch(/\bvars\(/);

    // ...and the value must be USED on a component that wraps the navigator.
    // Defining `appearanceVars` and never passing it (or dropping it from the
    // style) leaves every guard above satisfied while nothing is ever set —
    // this test's whole reason for existing.
    // And it must be on a component css-interop actually knows about. `vars()`
    // stores the value in a WeakMap keyed by the returned marker and lets the
    // interop resolver look it up; a component that was never passed to
    // `cssInterop` receives the marker as a plain style, forwards `{}` to the
    // native view and silently drops every variable. `GestureHandlerRootView`
    // is exactly such a component — on the device this cost a setting that
    // changed nothing with no error anywhere. Only plain RN primitives
    // (View/Text/Pressable/...) and safe-area-context are registered, so the
    // marker must go on a `View`.
    const varTag = src.match(/<(\w+)[^>]*style=\{\[[^\]]*appearanceVars[^\]]*\]\}/);
    expect(varTag, "no component receives the vars() style").toBeTruthy();
    expect(
      varTag![1],
      `${varTag![1]} is not registered with react-native-css-interop, so vars() would be ignored — use a plain View`,
    ).toBe("View");
  });

  it("does not set the variable to a hard-coded number", () => {
    // A literal would pin the scale for every user and make the setting a
    // no-op — the exact "looks wired, does nothing" state.
    const src = code("app/_layout.tsx");
    const m = src.match(/--font-scale["']?\s*:\s*([^,\n}]+)/);
    expect(m, "--font-scale assignment not found").toBeTruthy();
    expect(m![1]).not.toMatch(/^\s*1\s*$/);
    expect(m![1]).not.toMatch(/^\s*[\d.]+\s*$/);
  });

  it("leaves the variable ABSENT when following the system", () => {
    // Writing the number 1 instead of omitting the key is arithmetically the
    // same but makes "following" indistinguishable from "chose the default",
    // which is why `fontScaleFor` returns null. The root must honour that by
    // omitting the key — so the guard is on the ASSIGNMENT expression, not on
    // the mere presence of a null check somewhere in the file (a `?? 1` in
    // the same expression passed the earlier version of this test).
    const src = code("app/_layout.tsx");
    const m = src.match(/"--font-scale"\s*:\s*([^}]+)\}/);
    expect(m, "--font-scale assignment not found").toBeTruthy();
    const value = m![1].trim();
    // A coerced fallback (`?? 1`, `|| 1`, `Number(x)`) defeats the null.
    expect(value, `writes a fallback instead of omitting the key: ${value}`).not.toMatch(
      /\?\?|\|\|/,
    );
    // The object must only be built when there IS a scale — otherwise the
    // key is written unconditionally and follow-system stops following.
    const around = src.slice(Math.max(0, m!.index! - 260), m!.index!);
    expect(
      around,
      "the vars() object must be conditional on a non-null scale",
    ).toMatch(/===\s*null\s*\?|!==\s*null\s*(\?|&&)|\b\w*[Ss]cale\s*&&/);
  });
});

describe("the setting is reachable and persisted", () => {
  const SUB_SCREEN = "app/(app)/[workspace]/more/settings/appearance.tsx";

  it("is reachable from the Appearance section of Settings", () => {
    // Mobile's settings is a list of push screens (iteration 294's shape), so
    // the parent carries an entry row and the controls live on the sub-screen.
    // What matters is that a user starting at Settings can get there: an
    // unregistered route or a row with no onPress is a feature no one reaches.
    const parent = code("app/(app)/[workspace]/more/settings.tsx");
    expect(parent).toMatch(/more\/settings\/appearance/);
    expect(parent).toMatch(/settings\.appearance\.typeTitle/);
    // ...and the route has to be registered with the navigator, or expo-router
    // renders it with a default title and no back affordance.
    const layout = code("app/(app)/[workspace]/_layout.tsx");
    expect(layout).toMatch(/name="more\/settings\/appearance"/);
  });

  it("persists through the store rather than component state", () => {
    // `useState` would lose the choice on restart, which is the defect the
    // whole store exists to prevent.
    const src = code(SUB_SCREEN);
    expect(src).toMatch(/useTypeAppearanceStore/);
    expect(src).toMatch(/setFontSize/);
    expect(src).toMatch(/setContentLeading/);
    expect(src).not.toMatch(/useState<[^>]*FontSizeChoice/);
  });

  it("drives the control from the ladder, not a retyped list", () => {
    // Rendering only three rungs would let the UI store a value it cannot
    // show as selected; a hand-typed list would drift from the ladder.
    const src = code(SUB_SCREEN);
    expect(src).toMatch(/FONT_SIZES/);
    expect(src).toMatch(/FOLLOW_SYSTEM/);
    expect(src).toMatch(/CONTENT_LEADINGS/);
  });
});

describe("the markdown renderer honours the reader's choice", () => {
  it("reads the scale from the store", () => {
    // enriched-markdown takes an imperative style object and never sees
    // className, so the `--font-scale` variable cannot reach it. Without an
    // explicit read, issue bodies and comments are the one surface in the app
    // that ignores the setting — and they are where people read.
    const src = code("lib/markdown/markdown-style.ts");
    expect(src).toMatch(/useFontScale/);
    expect(src).toMatch(/scaleTextMetrics/);
  });

  it("reads the leading choice too", () => {
    const src = code("lib/markdown/markdown-style.ts");
    expect(src).toMatch(/contentLeading/);
    expect(src).toMatch(/leadingMultiplier/);
  });

  it("rebuilds when either choice changes", () => {
    // The style object is memoised. Leaving a choice out of the dependency
    // list means the setting applies only after a remount — the change looks
    // ignored until the screen is revisited.
    const src = code("lib/markdown/markdown-style.ts");
    const deps = src.match(/\[([^\]]*)\]\s*,?\s*\)/g)?.join(" ") ?? "";
    expect(deps, "no dependency array found").not.toBe("");
    expect(deps).toMatch(/scale/);
    expect(deps).toMatch(/contentLeading/);
  });
});

describe("text containers can grow with the scaled glyphs", () => {
  /**
   * Every `h-N` / `size-N` on an element whose direct children include real
   * text is a box that will not follow the font scale. This is the iter-283
   * defect in its general form, and the reason it keeps coming back is that a
   * fixed height looks harmless at 1.0x.
   *
   * Known and accepted exceptions are listed with a reason. Anything else
   * fails, so a new fixed-height text box has to be a deliberate decision
   * rather than an oversight.
   */
  const ALLOWED: Record<string, string> = {
    // The lightbox's close button: a fixed 44dp circular tap target whose
    // glyph is a ✕, not text a reader parses. Growing it with the font size
    // would either shrink or inflate the tap target, both of which are worse
    // than a glyph that sits inside its circle.
    "lib/markdown/lightbox-provider.tsx": "fixed circular icon button",
    // The @-everyone avatar dot in the mention bar: a FIXED-SIZE circular
    // avatar analogue whose "@" must stay centred in the circle. Scaling the
    // glyph without the circle would push it off-centre; scaling both would
    // make one row's avatar taller than every member avatar beside it.
    "components/issue/mention-suggestion-bar.tsx": "fixed avatar dot",
  };

  function offenders(): string[] {
    const found: string[] = [];
    const roots = ["app", "components", "lib"].map((d) => path.join(APP_ROOT, d));
    for (const file of roots.flatMap((r) => walk(r))) {
      if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) continue;
      const rel = path.relative(APP_ROOT, file).split(path.sep).join("/");
      if (ALLOWED[rel]) continue;
      const src = code(rel);
      // `(\/>|>)` splits self-closing tags out: a `<View className="size-2" />`
      // is a decorative dot with no children, and treating it as an open tag
      // makes the scanner read its SIBLINGS' text as its content — which is
      // how the first version of this guard reported six colour swatches as
      // clipped text boxes.
      const tagRe =
        /<(View|Pressable|ScrollView|TouchableOpacity)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})[^>]*?(\/>|>)/g;
      for (const m of src.matchAll(tagRe)) {
        if (m[4] === "/>") continue;
        const cls = m[2] ?? m[3] ?? "";
        const withoutMinMax = cls.replace(/(?:^|\s)(?:min|max)-(?:h|w|size)-\S+/g, " ");
        if (!/(?:^|\s)(?:h|size)-\d/.test(withoutMinMax)) continue;
        const start = (m.index ?? 0) + m[0].length;
        const window = src.slice(start, start + 800);
        const closeIdx = window.indexOf(`</${m[1]}>`);
        const body = closeIdx >= 0 ? window.slice(0, closeIdx) : window;
        // Real text content (a literal child), or an input — not an icon.
        const hasText =
          /<TextField\b/.test(body) ||
          /<TextInput\b/.test(body) ||
          /<Text\b[^>]*>\s*[^<\s{]/.test(body);
        if (!hasText) continue;
        const line = src.slice(0, m.index).split("\n").length;
        found.push(`${rel}:${line}  ${cls.trim()}`);
      }
    }
    return found;
  }

  it("no NEW fixed-height box holds text", () => {
    // At the scale this setting allows (16/14 = 1.143 on top of the device's
    // own multiplier, which can itself be 1.3), a `h-9` box that fits at
    // 1.0x clips through the middle of its glyphs. `min-h-*` keeps the 1.0x
    // rhythm and lets the box grow — see MYS-2559's fix.
    expect(offenders(), "Use `min-h-*` so the box grows with its text").toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An allow-list entry for a file that no longer needs it silently widens
    // the exemption for every future fixed height in that file.
    for (const rel of Object.keys(ALLOWED)) {
      expect(() => read(rel), `${rel} no longer exists`).not.toThrow();
    }
  });
});

describe("inputs scale with the setting too", () => {
  /**
   * A `TextInput` cannot use the Tailwind `text-*` steps (NativeWind maps them
   * to fontSize + lineHeight, and a lineHeight on Android's TextInput clips
   * descenders), so every input sets `fontSize` inline — which also means it
   * does NOT resolve `--font-scale`. Left hard-coded, the fields a user types
   * into would be the only text that ignores their size choice, and they sit
   * directly beside labels that do scale.
   */
  function hardCodedInputSizes(): string[] {
    const found: string[] = [];
    const roots = ["app", "components", "lib"].map((d) => path.join(APP_ROOT, d));
    for (const file of roots.flatMap((r) => walk(r))) {
      if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) continue;
      const rel = path.relative(APP_ROOT, file).split(path.sep).join("/");
      // The crash/error boundary renders before any provider exists and must
      // not depend on a store read; its styles are a fixed emergency palette.
      if (rel === "components/fatal-error-boundary.tsx") continue;
      // The OTP slot glyph is sized to a fixed grid cell, not to prose; see
      // the note at that call site.
      if (rel === "components/ui/otp-input.tsx") continue;
      const src = code(rel);
      for (const m of src.matchAll(/fontSize:\s*(\d+)\s*,/g)) {
        const line = src.slice(0, m.index).split("\n").length;
        found.push(`${rel}:${line}  fontSize: ${m[1]}`);
      }
    }
    return found;
  }

  it("no product input keeps a literal font size", () => {
    expect(
      hardCodedInputSizes(),
      "Use `scaledByChoice(N, useFontScale())` so the field follows the text size",
    ).toEqual([]);
  });

  it("the shared TextField reads the scale", () => {
    // Most inputs go through this component, so it is the single most
    // important place for the scale to be applied.
    const src = code("components/ui/text-field.tsx");
    expect(src).toMatch(/useFontScale/);
    expect(src).toMatch(/scaledByChoice/);
  });
});
