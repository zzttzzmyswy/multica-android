/**
 * Guards for the mobile type scale — the delivery pipeline (218) and the
 * single-vocabulary migration (219).
 *
 * Every defect guarded here was INVISIBLE in the source, and each is cheap to
 * reintroduce by a plausible-looking edit. So these tests compile the real
 * stylesheet with the real config and read the emitted rules, rather than
 * asserting on config text — a config that LOOKS right but emits nothing is
 * exactly the failure mode being guarded.
 *
 *   1. (218) `lib/` sat outside Tailwind's `content` glob, so a class written
 *      only there never reached the stylesheet. The source read correctly and
 *      the device rendered the bare component.
 *   2. (218) The role-named steps did not exist in the mobile config, and
 *      `cn()` filed `text-caption` under text-COLOUR — so it was silently
 *      dropped as a conflict with `text-muted-foreground`. Six sites rendered
 *      at the inherited 16px, LARGER than the body text they were captioning.
 *   3. (219) Two vocabularies coexisted: Tailwind's t-shirt names (1775 sites)
 *      and the role ladder, plus 175 arbitrary sub-11px values the web ladder
 *      has no rung for. While both exist a reader cannot tell a deliberate
 *      role from an arbitrary tier, and the ladder only half-prevents drift.
 *      The guards below pin the retirement, not just the migration.
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Root } from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const require_ = createRequire(path.join(APP_ROOT, "package.json"));

const config = require_(path.join(APP_ROOT, "tailwind.config.js"));
const postcss = require_("postcss");
const tailwindcss = require_("tailwindcss");

const CSS_INPUT = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";

/**
 * Compile this app's stylesheet, optionally substituting the content scan.
 *
 * Async on purpose: postcss refuses `.css` on a lazy result whose plugin chain
 * is async, and top-level await in this module made the whole chain async.
 * Awaiting it here keeps the compile a plain `await` at every call site.
 */
async function compile(content?: unknown): Promise<string> {
  const cfg = content ? { ...config, content } : config;
  const result = postcss([tailwindcss(cfg)]).process(CSS_INPUT, {
    from: path.join(APP_ROOT, "global.css"),
  });
  return (await result).css;
}

function parse(css: string): Root {
  return postcss.parse(css);
}

/**
 * Tailwind escapes selector characters (`.text-\[11px\]`), so a lookup has to
 * escape the class name the same way. A naive `css.includes(".text-[11px]")`
 * reports a false MISS for every arbitrary value — which is how a probe run
 * during this round briefly "confirmed" a bug that did not exist.
 */
function cssEscape(cls: string): string {
  return cls.replace(/[.[\]/()%,#:!]/g, (m) => "\\" + m);
}

/** Declarations of `.cls`, or null when the class emitted no rule. */
function ruleFor(css: string, cls: string): string | null {
  const sel = "." + cssEscape(cls) + " {";
  const i = css.indexOf(sel);
  if (i < 0) return null;
  return css.slice(i + sel.length, css.indexOf("}", i)).replace(/\s+/g, " ").trim();
}

/** `font-size: 12px; line-height: 16px` -> [12, 16] */
/**
 * `font-size` / `line-height` of one step, as a BASE size plus whether it is
 * multiplied by the runtime `--font-scale` variable.
 *
 * Since MYS-2931 every step emits `calc(Npx * var(--font-scale, 1))`, so the
 * old "read a bare `Npx`" parser returns null for all ten steps. Ignoring the
 * calc wrapper would leaving the parity checks below passing vacuously — they
 * would report "no pair emitted" rather than the number they were written to
 * compare. So parse both shapes and record which one was found: the base is
 * what has to match web, the flag is what has to be true.
 */
function metricOf(
  body: string | null,
  property: "font-size" | "line-height",
): { base: number; scaled: boolean } | null {
  if (!body) return null;
  const scaled = new RegExp(
    `${property}:\\s*calc\\(\\s*([\\d.]+)px\\s*\\*\\s*var\\(--font-scale,\\s*1\\)\\s*\\)`,
  ).exec(body);
  if (scaled) return { base: Number(scaled[1]), scaled: true };
  const plain = new RegExp(`${property}:\\s*([\\d.]+)px`).exec(body);
  if (plain) return { base: Number(plain[1]), scaled: false };
  return null;
}

function sizeOf(
  css: string,
  cls: string,
): { size: number; lead: number; scaled: boolean } | null {
  const body = ruleFor(css, cls);
  const size = metricOf(body, "font-size");
  const lead = metricOf(body, "line-height");
  if (!size || !lead) return null;
  return {
    size: size.base,
    lead: lead.base,
    // Both must scale together. One scaling and the other not is the
    // MYS-2558 clip (glyphs grow inside a line box that stayed put).
    scaled: size.scaled && lead.scaled,
  };
}

/**
 * The web/desktop scale, parsed from its own source of truth rather than
 * retyped here. If someone adds or retunes a step there, this list moves with
 * it and the parity check below reports the drift instead of hiding it.
 */
function webScale(): Map<string, [number, number]> {
  const tokens = readFileSync(
    path.join(REPO_ROOT, "packages/ui/styles/tokens.css"),
    "utf8",
  );
  const scale = new Map<string, [number, number]>();
  const re = /--text-([a-z-]+):\s*(\d+)px;\s*\n\s*--text-\1--line-height:\s*(\d+)px;/g;
  for (const m of tokens.matchAll(re)) {
    scale.set(m[1], [Number(m[2]), Number(m[3])]);
  }
  return scale;
}

const WEB = webScale();

/**
 * Tailwind emits a class only when the content scan finds it, so checking all
 * ten steps needs a source that mentions all ten. Passing an extra `raw` entry
 * keeps that source out of the repo instead of adding a throwaway file the
 * real glob would then scan forever.
 */
const STEPS = [...WEB.keys()];
const PROBE_CONTENT = [
  ...config.content,
  {
    raw: `<div class="${STEPS.map((s) => `text-${s}`).join(" ")} leading-none leading-5"></div>`,
    extension: "html",
  },
];

// Compiled once. REAL_CSS is the stylesheet the device would actually receive,
// so it is what proves `lib/` is inside the content scan.
let REAL_CSS = "";
let PROBE_CSS = "";

beforeAll(async () => {
  REAL_CSS = await compile();
  PROBE_CSS = await compile(PROBE_CONTENT);
});

describe("lib/ is inside the Tailwind content scan", () => {
  it("globbed, so classes that live only under lib/ reach the stylesheet", () => {
    expect(config.content).toContain("./lib/**/*.{ts,tsx}");
  });

  it("emits the classes that lib/ owned alone", () => {
    // These four appear NOWHERE else in the tree, so they can only be emitted
    // because lib/ is scanned. Measured: adding the glob newly emits exactly
    // these and drops nothing. Asserted by declaration, not mere presence.
    expect(ruleFor(REAL_CSS, "w-11")).toBe("width: 2.75rem;");
    expect(ruleFor(REAL_CSS, "h-11")).toBe("height: 2.75rem;");
    expect(ruleFor(REAL_CSS, "bg-black/45")).toBe(
      "background-color: rgb(0 0 0 / 0.45);",
    );
    expect(ruleFor(REAL_CSS, "mr-2")).toBe("margin-right: 0.5rem;");
  });
});

describe("the role-named type scale exists and matches web", () => {
  it("covers every step the web ladder defines", () => {
    expect(WEB.size).toBeGreaterThanOrEqual(10);
    for (const step of WEB.keys()) {
      expect(
        config.theme.extend.fontSize[step],
        `tailwind.config.js is missing fontSize.${step}`,
      ).toBeDefined();
    }
  });

  it("emits each step at the web value, line-height included", () => {
    // Value-for-value parity. A step that exists in config but emits a
    // different size is the same class of bug as one that emits nothing.
    for (const [step, expected] of WEB) {
      expect(
        sizeOf(PROBE_CSS, `text-${step}`),
        `text-${step} did not emit a font-size + line-height pair`,
      ).toEqual({ size: expected[0], lead: expected[1], scaled: true });
    }
  });

  it("gives text-caption the 12px the caption sites call for", () => {
    // The concrete defect: these six sites rendered at the inherited 16px.
    expect(sizeOf(REAL_CSS, "text-caption")).toEqual({
      size: 12,
      lead: 16,
      scaled: true,
    });
  });

  it("emits the role step at the size the retired t-shirt name used to have", () => {
    // Iteration 219 moved every call site off Tailwind's t-shirt names and
    // onto the role ladder. The six steps below were chosen for the rename
    // *because* their (size, line-height) pair is identical to the default
    // they replace, so this pin doubles as the "nothing moved on screen"
    // record: these are the numbers the app rendered before the rename too.
    //
    // Since MYS-2931 the emitted value is `calc(Npx * var(--font-scale, 1))`
    // rather than a bare px, so the assertion is on the declaration SHAPE plus
    // the base numbers — asserting the old literal string would now fail for a
    // correct config, and asserting only the numbers would miss a step that
    // lost its variable and can no longer follow the font size.
    expect(ruleFor(REAL_CSS, "text-caption")).toBe(
      "font-size: calc(12px * var(--font-scale, 1)); line-height: calc(16px * var(--font-scale, 1));",
    );
    expect(ruleFor(REAL_CSS, "text-body")).toBe(
      "font-size: calc(14px * var(--font-scale, 1)); line-height: calc(20px * var(--font-scale, 1));",
    );
    expect(ruleFor(REAL_CSS, "text-title-sm")).toBe(
      "font-size: calc(16px * var(--font-scale, 1)); line-height: calc(24px * var(--font-scale, 1));",
    );
  });

  it("keeps the scale variable's fallback at 1, so defaults do not move", () => {
    // The `1` fallback is what makes an un-customised install render exactly
    // as it did before the setting existed — and what makes "follow system"
    // (which writes no variable) equal to "no scaling". A different fallback
    // would silently resize the whole app for everyone who never opens
    // Settings, which is most people.
    // PROBE_CSS, not REAL_CSS: TapTailwind only emits a class the content scan
    // finds, and no product call site uses every rung (body-lg has none), so
    // reading REAL_CSS would report "missing" for a step that is configured
    // correctly. The probe source mentions all ten on purpose.
    for (const step of WEB.keys()) {
      const body = ruleFor(PROBE_CSS, `text-${step}`);
      expect(body, `text-${step} missing`).toBeTruthy();
      expect(body, `text-${step} missing`).toContain("var(--font-scale, 1)");
      // Every occurrence must carry the `1` fallback. Written as an explicit
      // capture rather than a lookahead: a lookahead after `,\s*` is satisfied
      // by the space that follows a CORRECT `1)`, so it flags good output.
      for (const m of body!.matchAll(/var\(--font-scale,\s*([^)]*)\)/g)) {
        expect(m[1].trim(), `text-${step} fallback is not 1`).toBe("1");
      }
    }
  });

  it("retired Tailwind's own size names from the product sources", () => {
    // Iteration 219's point: one vocabulary, not two. While `text-sm` and
    // `text-body` both exist a reader cannot tell a deliberate role from an
    // arbitrary tier, which is how the scale drifted the first time. A single
    // reintroduced `text-sm` reopens that ambiguity, so it fails here rather
    // than waiting for someone to notice it in review.
    //
    // Scanned in the SOURCES, not in the stylesheet, on purpose: this file
    // itself names the retired classes, and Tailwind scans `lib/`, so an
    // assertion against REAL_CSS would be satisfied by the test's own text.
    // Test files are skipped for the same reason — a test that names a size in
    // order to assert on it is not a product call site.
    const RETIRED = [
      "text-xs",
      "text-sm",
      "text-base",
      "text-lg",
      "text-xl",
      "text-2xl",
      "text-3xl",
      "text-4xl",
    ];
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) scan(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          // `text-<size>/<line-height>` is a different token (an explicit
          // leading modifier) and prose may name a size while discussing it,
          // so the match must be a whole class token.
          for (const m of src.matchAll(/text-[A-Za-z0-9_[\]()./%$-]+/g)) {
            if (RETIRED.includes(m[0])) {
              offenders.push(`${path.relative(APP_ROOT, p)}: ${m[0]}`);
            }
          }
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) scan(path.join(APP_ROOT, dir));
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it("has no sub-11px size left, because the ladder's smallest rung is micro", () => {
    // Arbitrary values used to carry 8/9/10px tiers — sizes that exist nowhere
    // in the web ladder, whose smallest rung is micro (11/15). They also
    // arrived with no line-height at all, so leading fell back to whatever
    // `leading-*` happened to sit nearby. Both are gone; this is the pin.
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) scan(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
            if (Number(m[1]) < 11) {
              offenders.push(`${path.relative(APP_ROOT, p)}: ${m[0]}`);
            }
          }
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) scan(path.join(APP_ROOT, dir));
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it("still lets an explicit leading-* override a step's line-height", () => {
    // Every step now carries a line-height, so a block that pins its own must
    // win. That holds only because Tailwind emits `.leading-*` after the step:
    // both are plain single-class selectors, so emission order decides.
    const rules: string[] = [];
    parse(PROBE_CSS).walkRules((rule) => {
      rules.push(rule.selector);
    });
    const step = rules.indexOf(".text-micro");
    const lead = rules.indexOf(".leading-none");
    expect(step).toBeGreaterThan(-1);
    expect(lead).toBeGreaterThan(-1);
    expect(lead).toBeGreaterThan(step);
  });
});

describe("cn() keeps role steps instead of dropping them", () => {
  it("keeps a step alongside a colour", async () => {
    // Before the twMerge classGroup registration:
    //   cn("text-caption", "text-muted-foreground") -> "text-muted-foreground"
    // The size vanished at runtime while the source looked correct.
    const { cn } = await import("@/lib/utils");
    const out = cn("text-caption", "text-muted-foreground");
    expect(out).toContain("text-caption");
    expect(out).toContain("text-muted-foreground");
  });

  it("resolves size-vs-size and colour-vs-colour as real conflicts", async () => {
    const { cn } = await import("@/lib/utils");
    // A step passed later must WIN over ui/text's default `text-title-sm`, or the
    // caption sites stay at 16px.
    expect(cn("text-foreground text-title-sm", "text-caption text-muted-foreground")).toBe(
      "text-caption text-muted-foreground",
    );
    expect(cn("text-title-sm", "text-caption")).toBe("text-caption");
    expect(cn("text-muted-foreground", "text-destructive")).toBe("text-destructive");
    // Control: Tailwind's own sizes must still conflict as sizes.
    expect(cn("text-title-sm", "text-body")).toBe("text-body");
  });

  it("keeps the registration in step with the configured scale", async () => {
    // The two lists are written in different languages and drift silently:
    // a step in tailwind.config.js but not in the twMerge list compiles fine
    // and is then dropped by cn() at runtime.
    const src = readFileSync(path.join(APP_ROOT, "lib/utils.ts"), "utf8");
    for (const step of WEB.keys()) {
      expect(src, `lib/utils.ts twMerge list is missing "${step}"`).toContain(
        `"${step}"`,
      );
    }
  });
});
