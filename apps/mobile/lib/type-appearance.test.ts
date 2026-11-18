/**
 * Guards for the type-appearance model (MYS-2931).
 *
 * Each test below corresponds to one way this feature can be wrong while
 * looking right on screen. They are written to fail on the SYMPTOM the user
 * would experience, not on the shape of the code, because every defect here
 * is one a plausible edit reintroduces:
 *
 *   - a stored size the ladder cannot express (something renders at 14.7pt
 *     and no rung claims it);
 *   - "follow system" collapsed into a number, after which changing the OS
 *     font size no longer moves the app and there is no way back;
 *   - text that grows while its line box does not (the MYS-2558 /
 *     iter-283 clipping class of defect);
 *   - scaling that leaks into spacing, so raising the font size also
 *     reflows margins and the layout shifts as the slider moves.
 */
import { describe, expect, it } from "vitest";
import {
  CONTENT_LEADINGS,
  DEFAULT_CONTENT_LEADING,
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_SIZE_CHOICE,
  FOLLOW_SYSTEM,
  FONT_SIZES,
  MOBILE_BODY_LINE_RATIO,
  fontScaleFor,
  isContentLeading,
  isFontSize,
  leadingMultiplier,
  roundMetric,
  sanitizeContentLeading,
  sanitizeFontSize,
  scaleTextMetrics,
  scaledByChoice,
} from "./type-appearance";

describe("the size ladder is web's, not a mobile invention", () => {
  it("offers the exact rungs web's slider offers", () => {
    // Web: `FONT_SIZES = [12, 13, 14, 15, 16]`. A phone that offers a
    // different set cannot express a size picked on the web, so the two
    // surfaces disagree about what "15" means.
    expect([...FONT_SIZES]).toEqual([12, 13, 14, 15, 16]);
  });

  it("calibrates around web's default", () => {
    // `--font-scale` on web is `fontSize / 14`; 14 must therefore be the
    // identity rung or every step is off by a constant.
    expect(DEFAULT_FONT_SIZE).toBe(14);
    expect(fontScaleFor(14)).toBe(1);
  });

  it("starts on follow-system, which is what the app did before this existed", () => {
    // A fresh install previously followed the device with no setting at all.
    // Defaulting to a number would change behaviour for every existing user
    // the moment they update.
    expect(DEFAULT_FONT_SIZE_CHOICE).toBe(FOLLOW_SYSTEM);
  });
});

describe("a size the ladder cannot express is never stored", () => {
  it("keeps every real rung", () => {
    for (const size of FONT_SIZES) {
      expect(sanitizeFontSize(size)).toBe(size);
    }
  });

  it("falls back to follow-system for values between rungs", () => {
    // The concrete failure: a float (14.7) or a value from a future/older
    // ladder would render at a size no rung names, and — worse — survive a
    // restart, so the Settings screen would show no selection at all while
    // the app rendered at an off-ladder size.
    for (const bad of [14.7, 12.5, 11, 17, 0, -14, Number.NaN, Infinity]) {
      expect(sanitizeFontSize(bad)).toBe(DEFAULT_FONT_SIZE_CHOICE);
    }
  });

  it("falls back for strings, including a numeric one", () => {
    // JSON round-trips and older payloads can hand back "15". Accepting it
    // would store a value whose type does not match the ladder, so a later
    // `includes()` check would fail and the slider would silently reset.
    for (const bad of ["15", "system ", "", "default", "14px"]) {
      expect(sanitizeFontSize(bad)).toBe(DEFAULT_FONT_SIZE_CHOICE);
    }
  });

  it("falls back for null / undefined / objects / booleans", () => {
    for (const bad of [null, undefined, {}, [], true, false]) {
      expect(sanitizeFontSize(bad)).toBe(DEFAULT_FONT_SIZE_CHOICE);
    }
  });

  it("does not round an off-ladder value onto its nearest rung", () => {
    // Rounding would invent a choice the user never made: 14.4 becomes 14 and
    // then reads back as "the user chose 14". Falling back keeps the ladder
    // honest — the only stored values are the ones the UI can show.
    expect(sanitizeFontSize(14.4)).not.toBe(14);
    expect(sanitizeFontSize(13.6)).not.toBe(14);
  });

  it("is idempotent, so sanitising a sanitised value changes nothing", () => {
    // A store that re-reads its own output must reach a fixed point, or the
    // first read would rewrite persisted state on every launch.
    for (const input of [...FONT_SIZES, FOLLOW_SYSTEM, 14.7, "15", null]) {
      const once = sanitizeFontSize(input);
      expect(sanitizeFontSize(once)).toBe(once);
    }
  });

  it("narrows the type guard to the ladder only", () => {
    expect(isFontSize(14)).toBe(true);
    expect(isFontSize("14")).toBe(false);
    expect(isFontSize(FOLLOW_SYSTEM)).toBe(false);
  });
});

describe("follow-system is a state, not a size", () => {
  it("writes no scale at all, rather than the identity scale", () => {
    // `null` = leave `--font-scale` unset so the CSS fallback applies. The
    // number 1 would be arithmetically identical today, but it makes the
    // persisted state unable to distinguish "following" from "chose the
    // default", which is exactly the distinction the settings UI renders.
    expect(fontScaleFor(FOLLOW_SYSTEM)).toBeNull();
  });

  it("can be left, and returned to, without passing through a number", () => {
    // The round trip a user actually performs. The value after returning
    // must be the literal, not a number that happens to equal the default.
    const left = sanitizeFontSize(16);
    expect(left).toBe(16);
    expect(fontScaleFor(left)).toBe(16 / 14);

    const back = sanitizeFontSize(FOLLOW_SYSTEM);
    expect(back).toBe(FOLLOW_SYSTEM);
    expect(typeof back).toBe("string");
    expect(fontScaleFor(back)).toBeNull();
  });

  it("is not reachable by storing the default size", () => {
    // If these were the same value, a user who set 14 could never get back
    // to following the device, and changing the OS setting would look like a
    // no-op bug.
    expect(sanitizeFontSize(14)).not.toBe(sanitizeFontSize(FOLLOW_SYSTEM));
  });

  it("maps every rung to a distinct factor", () => {
    // Two rungs sharing a factor would make a slider step do nothing.
    const factors = FONT_SIZES.map((s) => fontScaleFor(s));
    expect(new Set(factors).size).toBe(FONT_SIZES.length);
    expect(factors).toEqual([12 / 14, 13 / 14, 1, 15 / 14, 16 / 14]);
  });
});

describe("line-height moves with the font size", () => {
  it("offers the three steps web offers, in the same order", () => {
    expect([...CONTENT_LEADINGS]).toEqual(["compact", "default", "relaxed"]);
    expect(DEFAULT_CONTENT_LEADING).toBe("default");
  });

  it("leaves every block exactly where it is on 'default'", () => {
    // The load-bearing one. Mobile's markdown blocks are already tuned
    // (body 14/24, h1 20/28, h2 18/24 ...). A multiplier of exactly 1 means
    // shipping this setting cannot move any existing screen.
    expect(leadingMultiplier("default")).toBe(1);
  });

  it("moves tighter and looser in the direction each name claims", () => {
    expect(leadingMultiplier("compact")).toBeLessThan(1);
    expect(leadingMultiplier("relaxed")).toBeGreaterThan(1);
  });

  it("lands the body ratio on the target the step names", () => {
    // Written as ratios rather than multipliers so the values are checkable
    // against the names: 1.5 is tight, ~1.95 is loose.
    expect(MOBILE_BODY_LINE_RATIO * leadingMultiplier("compact")).toBeCloseTo(1.5, 5);
    expect(MOBILE_BODY_LINE_RATIO * leadingMultiplier("default")).toBeCloseTo(
      MOBILE_BODY_LINE_RATIO,
      5,
    );
    expect(MOBILE_BODY_LINE_RATIO * leadingMultiplier("relaxed")).toBeCloseTo(1.95, 5);
  });

  it("keeps the multiplier monotonic across the ladder", () => {
    // A non-monotonic ladder makes the segmented control feel broken: the
    // middle option could be looser than the last.
    const [compact, def, relaxed] = [
      leadingMultiplier("compact"),
      leadingMultiplier("default"),
      leadingMultiplier("relaxed"),
    ];
    expect(compact).toBeLessThan(def);
    expect(def).toBeLessThan(relaxed);
  });

  it("survives a corrupt stored leading", () => {
    for (const bad of ["loose", "", 1, null, undefined, {}, ["compact"]]) {
      expect(sanitizeContentLeading(bad)).toBe(DEFAULT_CONTENT_LEADING);
    }
    for (const good of CONTENT_LEADINGS) {
      expect(sanitizeContentLeading(good)).toBe(good);
      expect(isContentLeading(good)).toBe(true);
    }
  });
});

describe("scaling touches glyph metrics and nothing else", () => {
  it("leaves a value alone when following the system", () => {
    // Applying a factor of 1 here would be invisible, but then nothing
    // downstream could tell "no override" from "override to the default" —
    // which is the distinction the whole feature rests on.
    expect(scaledByChoice(24, null)).toBe(24);
  });

  it("scales font size and line height by the same factor", () => {
    // The MYS-2558 defect in one assertion: if only one of these moved, the
    // glyphs would grow inside a fixed line box and the last line of a block
    // would be sheared off. Any consumer that scales a font size but not the
    // line height beside it is this bug.
    const scale = fontScaleFor(16);
    const [fontSize, lineHeight] = [scaledByChoice(14, scale), scaledByChoice(20, scale)];
    expect(fontSize / lineHeight).toBeCloseTo(14 / 20, 10);
    expect(fontSize).toBeCloseTo(16, 10);
    expect(lineHeight).toBeCloseTo(20 * (16 / 14), 10);
  });

  it("never scales spacing, so the layout does not shift under the slider", () => {
    // Margins, paddings and gaps are passed through the same helper with
    // `null` in every consumer. This pins the INTENT: the scale argument is
    // the font scale, and a consumer that feeds it spacing is wrong.
    // (Checked at the call sites by `type-appearance-wiring.test.ts`.)
    expect(scaledByChoice(8, null)).toBe(8);
  });

  it("keeps a scaled metric finite and positive across the whole ladder", () => {
    for (const size of FONT_SIZES) {
      for (const base of [11, 12, 13, 14, 15, 16, 18, 20, 24, 36]) {
        const value = roundMetric(scaledByChoice(base, fontScaleFor(size)));
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it("rounds to two decimals without drift when scaled back", () => {
    // Fractional line heights are legal in RN but two adjacent blocks that
    // round differently disagree about where a line ends. Two decimals keeps
    // error under a hundredth of a point while staying stable.
    expect(roundMetric(13 * (15 / 14))).toBe(13.93);
    expect(roundMetric(20)).toBe(20);
    expect(roundMetric(20.005)).toBe(20.01);
    expect(roundMetric(24 * (16 / 14))).toBe(27.43);
  });
});

describe("scaleTextMetrics scales glyph metrics and nothing else", () => {
  const BLOCK = {
    fontSize: 14,
    lineHeight: 24,
    marginTop: 12,
    marginBottom: 12,
    padding: 8,
    borderWidth: 3,
    borderRadius: 8,
    cellPaddingVertical: 6,
    color: "#fff",
    fontWeight: "600",
  };

  it("returns the object untouched when following the system", () => {
    // Identity must be by reference: this runs for every markdown block on
    // every render, and rebuilding 30 style objects per frame to change
    // nothing is how a settings feature becomes a scrolling regression.
    expect(scaleTextMetrics(BLOCK, null)).toBe(BLOCK);
  });

  it("scales fontSize and lineHeight together, keeping their ratio", () => {
    // The MYS-2558 rule: both or neither. A block whose glyphs grow inside a
    // stale line box shears its last line.
    const out = scaleTextMetrics(BLOCK, 16 / 14);
    expect(out.fontSize).toBeCloseTo(16, 2);
    expect(out.lineHeight).toBeCloseTo(24 * (16 / 14), 2);
    // The ratio is preserved to the precision rounding permits, not exactly:
    // each metric is rounded to 2dp independently, which perturbs the ratio by
    // ~3e-5 (here 16/27.43 vs 14/24). That is far below a hundredth of a
    // pixel at any real size, and demanding exactness would force unrounded
    // fractional metrics whose own error is larger.
    expect(out.fontSize / out.lineHeight).toBeCloseTo(14 / 24, 4);
  });

  it("leaves every spacing and chrome value exactly as it was", () => {
    // Web's own rule for this variable: sizes and line-heights only, "so a
    // larger size never changes spacing or layout". Scaling a margin would
    // make the reading column reflow as the slider moves.
    const out = scaleTextMetrics(BLOCK, 16 / 14);
    for (const key of [
      "marginTop",
      "marginBottom",
      "padding",
      "borderWidth",
      "borderRadius",
      "cellPaddingVertical",
    ] as const) {
      expect(out[key], key).toBe(BLOCK[key]);
    }
  });

  it("does not touch colours, weights or non-metric numbers", () => {
    const out = scaleTextMetrics(BLOCK, 16 / 14);
    expect(out.color).toBe("#fff");
    expect(out.fontWeight).toBe("600");
  });

  it("applies leading to the line box only, never to the glyph size", () => {
    // Tightening the leading must not shrink the type — that would be a
    // second, invisible font-size control.
    const out = scaleTextMetrics(BLOCK, null, leadingMultiplier("compact"));
    expect(out.fontSize).toBe(14);
    expect(out.lineHeight).toBeCloseTo(24 * leadingMultiplier("compact"), 2);
  });

  it("reaches nested blocks (lists, tables, inline code)", () => {
    // The style object is nested; a shallow pass would leave list and table
    // text at the old size while paragraphs changed — a visibly mixed page.
    const nested = {
      paragraph: { fontSize: 14, lineHeight: 24, marginBottom: 12 },
      list: { fontSize: 14, lineHeight: 24, gapWidth: 8 },
      table: { fontSize: 14, lineHeight: 24, cellPaddingHorizontal: 10 },
    };
    const out = scaleTextMetrics(nested, 16 / 14);
    for (const key of ["paragraph", "list", "table"] as const) {
      expect(out[key].fontSize, key).toBeCloseTo(16, 2);
      expect(out[key].lineHeight, key).toBeCloseTo(24 * (16 / 14), 2);
    }
    expect(out.list.gapWidth).toBe(8);
    expect(out.table.cellPaddingHorizontal).toBe(10);
  });

  it("handles arrays without treating them as styles", () => {
    // Inline-run styles arrive as arrays; scaling must recurse, not crash.
    const out = scaleTextMetrics(
      { runs: [{ fontSize: 13, lineHeight: 20 }, { color: "#000" }] },
      15 / 14,
    );
    expect(out.runs[0].fontSize).toBeCloseTo(13 * (15 / 14), 2);
    expect(out.runs[1]).toEqual({ color: "#000" });
  });
});
