/**
 * Iteration 218 (MYS-2045) — guards for the mobile style delivery pipeline.
 *
 * Both defects this round fixed were INVISIBLE in the source, and both are
 * cheap to reintroduce by a plausible-looking edit. So these tests compile the
 * real stylesheet with the real config and read the emitted rules, rather than
 * asserting on config text — a config that LOOKS right but emits nothing is
 * exactly the failure mode being guarded.
 *
 *   1. `lib/` sat outside Tailwind's `content` glob, so a class written only
 *      there never reached the stylesheet. The source read correctly and the
 *      device rendered the bare component.
 *   2. The role-named steps did not exist in the mobile config, and `cn()`
 *      filed `text-caption` under text-COLOUR — so it was silently dropped as
 *      a conflict with `text-muted-foreground`. Six sites rendered at the
 *      inherited 16px, LARGER than the body text they were captioning.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
function sizeOf(css: string, cls: string): [number, number] | null {
  const body = ruleFor(css, cls);
  if (!body) return null;
  const size = /font-size:\s*([\d.]+)px/.exec(body);
  const lead = /line-height:\s*([\d.]+)px/.exec(body);
  if (!size || !lead) return null;
  return [Number(size[1]), Number(lead[1])];
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
      ).toEqual(expected);
    }
  });

  it("gives text-caption the 12px the caption sites call for", () => {
    // The concrete defect: these six sites rendered at the inherited 16px.
    expect(sizeOf(REAL_CSS, "text-caption")).toEqual([12, 16]);
  });

  it("does not disturb Tailwind's own size utilities", () => {
    // `fontSize` sits under `extend`, so the defaults must survive — 988
    // text-xs and 587 text-sm sites depend on them.
    expect(ruleFor(REAL_CSS, "text-xs")).toBe(
      "font-size: 0.75rem; line-height: 1rem;",
    );
    expect(ruleFor(REAL_CSS, "text-sm")).toBe(
      "font-size: 0.875rem; line-height: 1.25rem;",
    );
    expect(ruleFor(REAL_CSS, "text-base")).toBe(
      "font-size: 1rem; line-height: 1.5rem;",
    );
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
    // A step passed later must WIN over ui/text's default `text-base`, or the
    // caption sites stay at 16px.
    expect(cn("text-foreground text-base", "text-caption text-muted-foreground")).toBe(
      "text-caption text-muted-foreground",
    );
    expect(cn("text-base", "text-caption")).toBe("text-caption");
    expect(cn("text-muted-foreground", "text-destructive")).toBe("text-destructive");
    // Control: Tailwind's own sizes must still conflict as sizes.
    expect(cn("text-base", "text-sm")).toBe("text-sm");
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
