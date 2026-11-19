/**
 * Guards for the reduce-motion / high-contrast decision rules (MYS-2950).
 *
 * Each `describe` here corresponds to one way the setting can lie to the
 * person using it, and the assertions are written as the on-screen symptom
 * rather than as an implementation detail, so a future refactor that keeps
 * the symptom away also keeps the test green:
 *
 *   1. Motion must be suppressed when the SYSTEM asks for it even though the
 *      app's own switch is off. Written as a union, not an override: the
 *      failure is a motion-sensitive reader seeing animation they explicitly
 *      told their phone to remove.
 *   2. The switch must not read "off" while the system is holding motion
 *      down. The failure is a person toggling a control that changes nothing.
 *   3. Durations collapse to zero, never to a negative number and never to
 *      NaN (Reanimated treats both as "no animation" on some platforms and
 *      as "throw" on others).
 *   4. The high-contrast palette changes COLOURS only. The failure is a
 *      double text scale stacked on top of iteration 296's font size.
 */
import { describe, expect, it } from "vitest";

import {
  HIGH_CONTRAST_TOKENS,
  applyHighContrast,
  highContrastTokens,
  motionReduced,
  reduceMotionRow,
  resolvedMotionDuration,
  shouldRepeatMotion,
  shouldSuppressMotion,
} from "./appearance-a11y";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("reduce motion is a UNION of the switch and the system setting", () => {
  it("suppresses motion when the system asks for it and the switch is OFF", () => {
    // The whole point of the rule. A phone-level "remove animations" is a
    // medical accommodation; an app toggle that is merely off must not
    // re-enable motion behind it.
    expect(motionReduced({ user: false, system: true })).toBe(true);
  });

  it("suppresses motion when the switch is ON and the system has no opinion", () => {
    // The reverse direction matters just as much: someone who turns the app
    // switch on expects it to work on a phone whose system setting is off.
    expect(motionReduced({ user: true, system: false })).toBe(true);
  });

  it("runs motion only when BOTH say no", () => {
    expect(motionReduced({ user: false, system: false })).toBe(false);
    expect(motionReduced({ user: true, system: true })).toBe(true);
  });

  it("treats an unresolved system read as no preference, not as permission", () => {
    // `AccessibilityInfo.isReduceMotionEnabled()` is async; on the frames
    // before it resolves the system answer is unknown. Unknown must behave
    // like "off" so a cold start does not animate for the first 3 frames and
    // then freeze — and so it can never *enable* motion the user forbade.
    expect(shouldSuppressMotion({ user: false, system: undefined })).toBe(false);
    expect(shouldSuppressMotion({ user: true, system: undefined })).toBe(true);
  });
});

describe("the switch cannot look off while the system holds motion down", () => {
  it("shows checked + locked when the system is on and the stored choice is off", () => {
    // Symptom this prevents: a switch that reads "off" while no animation
    // plays. The person then taps it twice and concludes the app is broken.
    expect(reduceMotionRow({ user: false, system: true })).toEqual({
      checked: true,
      locked: true,
      source: "system",
    });
  });

  it("shows checked + editable when the person turned it on themselves", () => {
    expect(reduceMotionRow({ user: true, system: false })).toEqual({
      checked: true,
      locked: false,
      source: "user",
    });
  });

  it("is editable and off when nothing asks for reduced motion", () => {
    expect(reduceMotionRow({ user: false, system: false })).toEqual({
      checked: false,
      locked: false,
      source: "none",
    });
  });

  it("stays locked when both are on — the system still owns the outcome", () => {
    // Not "user": turning the app switch off here would not restore motion,
    // so calling it a user choice would offer a control that does nothing.
    expect(reduceMotionRow({ user: true, system: true })).toEqual({
      checked: true,
      locked: true,
      source: "system",
    });
  });
});

describe("motion durations collapse to zero without ever going negative", () => {
  it("returns 0 when motion is reduced, whatever was asked for", () => {
    expect(resolvedMotionDuration(700, true)).toBe(0);
    expect(resolvedMotionDuration(0, true)).toBe(0);
  });

  it("passes the requested duration through when motion is allowed", () => {
    expect(resolvedMotionDuration(700, false)).toBe(700);
    expect(resolvedMotionDuration(0, false)).toBe(0);
  });

  it("clamps a negative or non-finite duration to 0 instead of forwarding it", () => {
    // Reanimated's `withTiming` treats a negative duration as an error on
    // Android and as "keep the current value" elsewhere; NaN silently
    // produces no animation with no warning. Neither is a duration.
    expect(resolvedMotionDuration(-1, false)).toBe(0);
    expect(resolvedMotionDuration(Number.NaN, false)).toBe(0);
    expect(resolvedMotionDuration(Number.POSITIVE_INFINITY, false)).toBe(0);
  });

  it("never returns NaN for a reduced animation", () => {
    const value = resolvedMotionDuration(Number.NaN, true);
    expect(Number.isNaN(value)).toBe(false);
    expect(value).toBe(0);
  });
});

describe("the high-contrast palette changes colours only", () => {
  it("overrides exactly the three tokens web's high contrast raises", () => {
    // Web's rule (`appearanceStylesheet`, `prefs.highContrast`) raises
    // `--muted-foreground`, `--faint-foreground`, `--border`,
    // `--surface-border` and `--input`. Mobile has no faint/surface-border
    // tokens, so the intersection is these three — and adding a fourth here
    // without a matching `global.css` variable is exactly the drift the
    // token-name test below exists to catch.
    expect(Object.keys(highContrastTokens("light")).sort()).toEqual(
      [...HIGH_CONTRAST_TOKENS].sort(),
    );
    expect(Object.keys(highContrastTokens("dark")).sort()).toEqual(
      [...HIGH_CONTRAST_TOKENS].sort(),
    );
  });

  it("names only tokens the stylesheet and theme mirror actually define", () => {
    // `lib/theme.ts` mirrors `global.css`; a high-contrast key with no base
    // key would resolve to `undefined` in an inline style and paint nothing.
    // Read the stylesheet rather than importing `theme.ts`: that module pulls
    // `@react-navigation/native`, which this Node-only lane cannot parse.
    const css = readFileSync(path.resolve(__dirname, "..", "global.css"), "utf8");
    const declared = new Set(
      [...css.matchAll(/^\s*--([a-z-]+):/gm)].map((match) => match[1]),
    );
    for (const token of HIGH_CONTRAST_TOKENS) {
      expect(declared, `global.css has no --${kebab(token)}`).toContain(
        kebab(token),
      );
    }
    // ...and every base token the palette raises must exist in BOTH :root
    // blocks, or one scheme would fall back to the other's colour.
    const [lightBlock, darkBlock] = splitSchemeBlocks(css);
    for (const token of HIGH_CONTRAST_TOKENS) {
      expect(rootValue(lightBlock, kebab(token)), `light --${kebab(token)}`).not.toBeNull();
      expect(rootValue(darkBlock, kebab(token)), `dark --${kebab(token)}`).not.toBeNull();
    }
  });

  it("is mirrored by .contrast-more blocks in global.css with the same values", () => {
    // The className path (`text-muted-foreground`, `border-border`,
    // `border-input`) resolves through `global.css`; the inline path resolves
    // through this module. If the stylesheet block named a different variable
    // — or carried a different value — one half of the app would honour the
    // setting and the other would not. That is exactly the "looks wired, does
    // nothing" state iteration 296's `--font-scale` guard was written for, and
    // here it would be worse: half the screen would gain contrast and half
    // would not, which reads as a rendering bug rather than a setting.
    const css = readFileSync(path.resolve(__dirname, "..", "global.css"), "utf8");
    for (const scheme of ["light", "dark"] as const) {
      const block = contrastBlock(css, scheme);
      expect(block, `global.css has no .contrast-more ${scheme} block`).toBeTruthy();
      const raised = highContrastTokens(scheme);
      for (const token of HIGH_CONTRAST_TOKENS) {
        const declared = rootValue(block!, kebab(token));
        expect(declared, `.contrast-more ${scheme} is missing --${kebab(token)}`).not.toBeNull();
        expect(
          normalizeHsl(declared!),
          `${scheme}.${token} drifts between appearance-a11y.ts and global.css`,
        ).toBe(normalizeHsl(raised[token]));
      }
    }
  });

  it("leaves every non-colour metric untouched", () => {
    // The iter-283 / MYS-2559 lesson: a contrast setting that also moved a
    // size would stack on iteration 296's `--font-scale` and re-create the
    // clipped-container defect. Nothing here may carry a size, radius or
    // spacing key.
    for (const scheme of ["light", "dark"] as const) {
      expect(Object.keys(highContrastTokens(scheme))).toEqual(
        expect.arrayContaining([...HIGH_CONTRAST_TOKENS]),
      );
      expect(Object.keys(highContrastTokens(scheme))).toHaveLength(
        HIGH_CONTRAST_TOKENS.length,
      );
      for (const [token, value] of Object.entries(highContrastTokens(scheme))) {
        expect(value, `${scheme}.${token} must be an hsl colour`).toMatch(
          /^hsl\(/,
        );
      }
    }
    expect(HIGH_CONTRAST_TOKENS as readonly string[]).not.toContain("radius");
  });

  it("moves muted text and rules CLOSER to the foreground, in both schemes", () => {
    // Direction, not just "different": high contrast means more separation
    // from the page. A palette that moved the wrong way would pass a
    // "values changed" assertion while making the app worse.
    for (const scheme of ["light", "dark"] as const) {
      const css = readFileSync(path.resolve(__dirname, "..", "global.css"), "utf8");
      const block = scheme === "light" ? splitSchemeBlocks(css)[0] : splitSchemeBlocks(css)[1];
      const foreground = rootValue(block, "foreground")!;
      const raised = highContrastTokens(scheme);
      for (const token of HIGH_CONTRAST_TOKENS) {
        const base = rootValue(block, kebab(token))!;
        expect(
          Math.abs(lightness(raised[token]) - lightness(foreground)),
          `${scheme}.${token} must sit closer to the foreground than ${base}`,
        ).toBeLessThan(Math.abs(lightness(base) - lightness(foreground)));
      }
    }
  });

  it("keeps every raised token at least as separated from the page as before", () => {
    // Proxy for a WCAG sweep without shipping a colour library: the raised
    // value must clear a higher contrast ratio against the page than the base
    // one did, in both schemes.
    for (const scheme of ["light", "dark"] as const) {
      const css = readFileSync(path.resolve(__dirname, "..", "global.css"), "utf8");
      const block = scheme === "light" ? splitSchemeBlocks(css)[0] : splitSchemeBlocks(css)[1];
      const background = rootValue(block, "background")!;
      const raised = highContrastTokens(scheme);
      for (const token of HIGH_CONTRAST_TOKENS) {
        const base = rootValue(block, kebab(token))!;
        expect(
          contrast(raised[token], background),
          `${scheme}.${token} contrast must improve on ${base}`,
        ).toBeGreaterThan(contrast(base, background));
      }
    }
  });
});

describe("applyHighContrast composes with a real palette", () => {
  const base = {
    background: "hsl(0 0% 100%)",
    foreground: "hsl(0 0% 3.9%)",
    mutedForeground: "hsl(0 0% 45.1%)",
    border: "hsl(0 0% 84%)",
    input: "hsl(0 0% 84%)",
    radius: "0.625rem",
  };

  it("returns the palette untouched when the setting is off", () => {
    // Identity, not a copy: the off path must not churn every caller's
    // dependency arrays on every render.
    expect(applyHighContrast(base, "light", false)).toBe(base);
  });

  it("overrides the three colours and nothing else", () => {
    const raised = applyHighContrast(base, "light", true);
    expect(raised.mutedForeground).toBe(highContrastTokens("light").mutedForeground);
    expect(raised.border).toBe(highContrastTokens("light").border);
    expect(raised.input).toBe(highContrastTokens("light").input);
    // Untouched: the page, the text, and the metric.
    expect(raised.background).toBe(base.background);
    expect(raised.foreground).toBe(base.foreground);
    expect(raised.radius).toBe(base.radius);
  });

  it("does not mutate the palette it was given", () => {
    applyHighContrast(base, "dark", true);
    expect(base.mutedForeground).toBe("hsl(0 0% 45.1%)");
  });
});

/** The body of the high-contrast block for one scheme, or null. */
function contrastBlock(css: string, scheme: "light" | "dark"): string | null {
  const selector =
    scheme === "light" ? ".contrast-more:root" : ".contrast-more.dark:root";
  const match = css.match(
    new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([\\s\\S]*?)\\n  \\}`),
  );
  return match ? match[1] : null;
}

/** `mutedForeground` → `muted-foreground`, the stylesheet's spelling. */
function kebab(token: string): string {
  return token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** The `:root { ... }` and `.dark:root { ... }` bodies, in that order. */
function splitSchemeBlocks(css: string): [string, string] {
  const light = css.match(/\n  :root \{([\s\S]*?)\n  \}/);
  const dark = css.match(/\n  \.dark:root \{([\s\S]*?)\n  \}/);
  expect(light, "global.css has no :root block").toBeTruthy();
  expect(dark, "global.css has no .dark:root block").toBeTruthy();
  return [light![1], dark![1]];
}

/** A declaration's value inside one block, or null when it is not declared. */
function rootValue(block: string, name: string): string | null {
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

/** `0 0% 19.5%` and `hsl(0 0% 19.5%)` compare equal. */
function normalizeHsl(value: string): string {
  return value
    .replace(/^hsl\(/, "")
    .replace(/\)$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** HSL lightness, 0–1, from either `H S% L%` or `hsl(H S% L%)`. */
function lightness(value: string): number {
  const match = normalizeHsl(value).match(/([\d.]+)%\s*$/);
  const percent = match ? Number(match[1]) : Number.NaN;
  expect(Number.isNaN(percent), `unparsable colour ${value}`).toBe(false);
  return percent / 100;
}

/**
 * WCAG 2.x contrast ratio between two achromatic `hsl()`/`H S% L%` colours.
 * Every token compared here has `S = 0%`, so the three sRGB channels are all
 * the lightness and the linearisation applies once.
 */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(value: string): number {
  const channel = lightness(value);
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

describe("repeating animation stops instead of spinning at zero duration", () => {
  it("runs a repeat only when motion is allowed", () => {
    // A `withRepeat(withTiming(0), -1)` would NOT stop — it schedules a
    // zero-length frame forever, and with `reverse: true` strobes at whatever
    // rate the frame callback fires. The honest reduction is not to start it.
    expect(shouldRepeatMotion(false)).toBe(true);
    expect(shouldRepeatMotion(true)).toBe(false);
  });
});
