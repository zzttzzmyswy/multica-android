/**
 * Wiring guards for reduce motion / high contrast (MYS-2950).
 *
 * `lib/appearance-a11y.test.ts` pins the arithmetic and
 * `data/stores/appearance-a11y-store.test.ts` pins persistence. Neither can
 * prove the app USES them — and "a correct helper nothing calls" is this
 * repo's most-repeated defect class (see `lib/type-appearance-wiring.test.ts`,
 * written for the same reason last iteration). Everything here is checked at
 * the source level because mobile's vitest lane is Node-only: there is no
 * renderer to mount, so the honest guard is the invariant whose violation
 * produces one specific symptom on a phone.
 *
 * Each `it` names that symptom in its failure message, so the next person to
 * break one is told what a user would see rather than which regex failed.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

/** Strip comments — prose about a class or a duration is not the code. */
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
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every non-test source file, with its path relative to the app root. */
function sources(): { rel: string; body: string }[] {
  return walk(APP_ROOT)
    .map((full) => ({
      rel: path.relative(APP_ROOT, full),
      body: code(path.relative(APP_ROOT, full)),
    }))
    .filter((entry) => !entry.rel.startsWith("android/"));
}

describe("the device setting is watched exactly once, from the root", () => {
  it("starts the watch in the root layout", () => {
    // Without this the system half of the union is permanently `undefined`,
    // i.e. "no preference" — so a phone-level reduce-motion setting would do
    // nothing and the settings row would never show 「已由系统开启」.
    const src = code("app/_layout.tsx");
    expect(src, "app/_layout.tsx does not start the device watch").toMatch(
      /useSystemMotionWatch\(\)/,
    );
  });

  it("subscribes to the device from one module only", () => {
    // A second `AccessibilityInfo.addEventListener` registration would double
    // every native callback and let two stores drift apart. The watch is
    // process-wide on purpose (see the runtime module), so exactly one file
    // may register it.
    const registrars = sources().filter((entry) =>
      /AccessibilityInfo\s*\.\s*addEventListener/.test(entry.body),
    );
    expect(
      registrars.map((entry) => entry.rel),
      "more than one module registers AccessibilityInfo listeners",
    ).toEqual(["lib/appearance-a11y-runtime.ts"]);
  });

  it("reads the device preference through the guarded optional calls", () => {
    // `isHighTextContrastEnabled` is Android-only; an unguarded call throws on
    // iOS. The runtime must use the `?.()` form so a missing API degrades to
    // "unknown" instead of taking the launch down.
    const src = code("lib/appearance-a11y-runtime.ts");
    expect(src).toMatch(/isReduceMotionEnabled\?\.\(/);
    expect(src).toMatch(/isHighTextContrastEnabled\?\.\(/);
  });
});

describe("the root carries the className half of high contrast", () => {
  it("applies the contrast-more class to the tree that renders the app", () => {
    // Symptom if missing: every inline `THEME[...].mutedForeground` gains
    // contrast but `text-muted-foreground` stays as it was, so half the screen
    // changes and half does not — which reads as a rendering bug.
    const src = code("app/_layout.tsx");
    expect(src, "the root never sets contrast-more").toMatch(/contrast-more/);
    // ...and the class must reach a component that wraps the navigator, not
    // just be computed and dropped.
    const tag = src.match(/<View[^>]*className=\{[^}]*[Hh]ighContrast[^}]*\}/);
    expect(tag, "the contrast-more class is computed but never passed").toBeTruthy();
  });

  it("writes the raised values into global.css", () => {
    // The className half resolves through the stylesheet; without these
    // variables the class is an unknown class and changes nothing.
    const css = read("global.css");
    expect(css).toMatch(/\.contrast-more:root\s*\{/);
    expect(css).toMatch(/\.contrast-more\.dark:root\s*\{/);
    for (const name of ["--muted-foreground", "--border", "--input"]) {
      const light = css.match(/\.contrast-more:root\s*\{([\s\S]*?)\n  \}/);
      expect(light, `.contrast-more:root is missing ${name}`).toBeTruthy();
      expect(light![1]).toContain(`${name}:`);
    }
  });
});

describe("every animation call site goes through the reduced-motion decision", () => {
  /** Files that hand a duration to Reanimated, and how many times. */
  function animationSites(): { rel: string; body: string }[] {
    return sources().filter((entry) =>
      /withTiming\(|withRepeat\(|FadeIn(Up|Down)?\.duration|FadeOut\.duration/.test(
        entry.body,
      ),
    );
  }

  it("collapses durations through motionDuration at every withTiming site", () => {
    // Symptom if missed: the switch is on, the dots and the highlight still
    // animate — the setting looks wired and does nothing.
    const offenders: string[] = [];
    for (const entry of animationSites()) {
      // A raw numeric duration is the tell. `motionDuration(...)` and a bare
      // `duration: 0` literal (an intentional instant animation) are fine.
      const raw = [...entry.body.matchAll(/duration:\s*([^,}\n]+)/g)]
        .map((match) => match[1].trim())
        .filter((value) => /^\d+$/.test(value) && Number(value) > 0);
      const rawEntering = [...entry.body.matchAll(/\.duration\(([^)]*)\)/g)]
        .map((match) => match[1].trim())
        .filter((value) => /^\d+$/.test(value) && Number(value) > 0);
      if (raw.length > 0 || rawEntering.length > 0) offenders.push(entry.rel);
    }
    expect(
      offenders,
      `these files animate with a hard-coded duration, so reduce-motion cannot reach them: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("does not leave an infinite withRepeat running under reduced motion", () => {
    // Symptom if missed: `withRepeat(withTiming(0), -1)` NEVER stops — it
    // re-schedules a zero-length frame forever, and with `reverse: true` it
    // strobes. Every repeating animation must be gated on
    // `shouldRepeatMotion`, not merely shortened.
    const repeaters = sources().filter((entry) =>
      /withRepeat\(/.test(entry.body),
    );
    const offenders = repeaters
      .filter((entry) => !/shouldRepeatMotion\(/.test(entry.body))
      .map((entry) => entry.rel);
    expect(
      offenders,
      `these files repeat an animation without the reduced-motion gate: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the reduced-motion decision reachable from each animation file", () => {
    // A file that calls `motionDuration` but never derives `reduceMotion` from
    // the hook would pass the hard-coded-literal check while always passing
    // `false` — the same "looks wired" state one level deeper.
    for (const entry of animationSites()) {
      expect(
        /useReducedMotion\(\)|useAppearanceA11y\(\)/.test(entry.body),
        `${entry.rel} computes a motion duration without reading the decision`,
      ).toBe(true);
    }
  });
});

describe("the setting is reachable and persisted", () => {
  const SCREEN = "app/(app)/[workspace]/more/settings/appearance.tsx";

  it("renders both rows with a store-backed setter", () => {
    const src = code(SCREEN);
    expect(src, "no reduce-motion row").toMatch(/settings\.appearance\.motionTitle/);
    expect(src, "no high-contrast row").toMatch(
      /settings\.appearance\.contrastTitle/,
    );
    // The setters must come from the store, never from component state: a
    // `useState` would lose the choice on restart, which is the defect the
    // store exists to prevent.
    expect(src).toMatch(/useAppearanceA11yStore/);
    expect(src).toMatch(/setReduceMotion/);
    expect(src).toMatch(/setHighContrast/);
  });

  it("shows the third state rather than a switch that lies", () => {
    // Symptom if missed: the phone holds motion down, the row reads "off", the
    // person taps twice and nothing ever changes. The row state must come from
    // the pure rule (checked + locked + source), not from the raw store field.
    const src = code(SCREEN);
    expect(src, "the motion row does not use the three-state rule").toMatch(
      /useReducedMotionRow\(\)/,
    );
    expect(src, "the locked state is never rendered").toMatch(/motionRow\.locked/);
    expect(src, "no 「已由系统开启」 label").toMatch(
      /settings\.appearance\.motionSystemOn/,
    );
    // ...and a locked row must not accept the tap.
    expect(src, "a locked row still accepts presses").toMatch(
      /disabled=\{locked\}/,
    );
  });

  it("persists through the store rather than component state", () => {
    // Same contract the type-appearance guard pins, restated here because the
    // two stores are separate files and a future change could honour it for
    // one and not the other.
    const screen = code(SCREEN);
    expect(screen).not.toMatch(/useState[^\n]*[Hh]ighContrast/);
    expect(screen).not.toMatch(/useState[^\n]*[Rr]educeMotion/);
  });

  it("registers every i18n key it renders in both bundles", () => {
    // The completeness suite covers literal `t("...")` keys app-wide; this
    // narrows it to the four new rows so a missing leaf is attributed to this
    // iteration rather than to "somewhere in the app".
    const en = JSON.parse(read("lib/i18n/locales/en.json")) as Record<string, string>;
    const zh = JSON.parse(read("lib/i18n/locales/zh.json")) as Record<string, string>;
    const keys = [
      "settings.appearance.motionTitle",
      "settings.appearance.motionDescription",
      "settings.appearance.motionOn",
      "settings.appearance.motionOff",
      "settings.appearance.motionSystemOn",
      "settings.appearance.motionSystemHint",
      "settings.appearance.contrastTitle",
      "settings.appearance.contrastDescription",
      "settings.appearance.contrastOn",
      "settings.appearance.contrastOff",
      "settings.appearance.contrastSystemOn",
      "settings.appearance.contrastSystemHint",
      "settings.appearance.a11yReset",
    ];
    for (const key of keys) {
      expect(en[key], `en bundle is missing ${key}`).toBeTruthy();
      expect(zh[key], `zh bundle is missing ${key}`).toBeTruthy();
      // The zh bundle must not be the English string copied over — that is how
      // an untranslated row ships while every key-existence check passes.
      expect(zh[key], `${key} is not translated`).not.toBe(en[key]);
    }
  });
});

describe("no surface reads a base token inline past the palette", () => {
  it("routes every inline colour through useThemePalette", () => {
    // Symptom if missing: the high-contrast switch recolours `className` text
    // (via `.contrast-more`) and every inline colour that goes through
    // `useThemePalette`, but an inline `THEME[scheme].mutedForeground` keeps
    // its base value — so one icon in a darkened row stays dim. On a phone
    // that reads as a rendering bug, not as a preference.
    //
    // `THEME` may still be referenced for its TYPE (`typeof THEME["light"]`)
    // and inside `lib/theme.ts` itself; what is banned is reading a COLOUR
    // out of it.
    //
    // The match must catch BOTH shapes the defect took: a direct
    // `THEME[scheme].token` read, and the aliased `const theme = THEME[...]`
    // followed by `theme.token`. Anchoring on the bracket expression rather
    // than on a `.token` suffix covers the second — which is how one of the
    // two real bypasses was written, and a `.`-suffixed pattern missed it.
    // The two lookbehinds drop the type-only form and `NAV_THEME[`.
    const readsBaseToken = /(?<!typeof\s)(?<![A-Za-z0-9_$])THEME\s*\[/;
    const offenders = sources()
      .filter((entry) => entry.rel !== "lib/theme.ts")
      .filter((entry) => !entry.rel.startsWith("lib/appearance-a11y"))
      .filter((entry) => readsBaseToken.test(entry.body))
      .map((entry) => entry.rel);
    expect(
      offenders,
      "these files read a colour out of THEME[] inline, bypassing high contrast",
    ).toEqual([]);
  });
});

describe("native modal transitions respect reduced motion", () => {
  it.each([
    ["lib/action-sheet.tsx", "fade"],
    ["lib/rich-content/fullscreen-preview.tsx", "slide"],
    ["components/chat/agent-picker-sheet.tsx", "fade"],
    ["components/rich-content/mermaid-viewer.tsx", "slide"],
  ])("keeps %s transitions off under reduced motion", (filename, normal) => {
    const src = code(filename);
    expect(src).toContain("const reduceMotion = useReducedMotion();");
    expect(src).toContain(`animationType={reduceMotion ? "none" : "${normal}"}`);
  });
});
