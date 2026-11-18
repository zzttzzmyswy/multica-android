/**
 * RNR template config (verbatim) + Multica custom token mappings appended.
 *
 * Colors map to CSS variables in apps/mobile/global.css. When changing a
 * variable name there, mirror the change here AND in apps/mobile/lib/theme.ts.
 *
 * See apps/mobile/docs/rnr-migration.md §5 for the sync rule.
 */
const { hairlineWidth } = require("nativewind/theme");

/**
 * One rung of the type scale, expressed as a multiple of the runtime
 * `--font-scale` variable (MYS-2931).
 *
 * The variable is set on the app root from the Appearance font-size choice
 * (`data/stores/type-appearance-store.ts`) and read by NativeWind's runtime,
 * so every `text-*` class that uses one of these steps resizes together.
 * The `1` fallback is what makes the un-customised app render exactly as it
 * did before the setting existed.
 *
 * Kept as a function rather than inlined so the two values of a step cannot
 * drift apart — a step whose font-size scales but whose line-height does not
 * is the MYS-2558 clipping defect.
 */
const scaleStep = (px) => `calc(${px}px * var(--font-scale, 1))`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    // `lib/` carries className strings too — the markdown lightbox's two
    // overlay buttons and the code-block language label among them. Without
    // this glob a class written ONLY there never reaches the stylesheet: the
    // source reads correctly and the device renders the bare component, with
    // nothing to point at. Measured: adding this one glob newly emits exactly
    // `w-11`, `bg-black/45` and `mr-2` (the three classes lib/ owned alone) and
    // drops nothing. Guarded by `lib/type-scale.test.ts`.
    "./lib/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Multica custom tokens
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        priority: "hsl(var(--priority))",
        "code-surface": "hsl(var(--code-surface))",
        // Surface elevation scale — 5-tier ladder above page bg, sandwiching
        // shadcn's secondary/muted/accent slot. surface-1 sits subtly above
        // page (L 98%, comment bubble use case); surface-2 sits clearly
        // above page (L 90%, nested-inside-surface-1 use case like a code
        // block inside a comment). See global.css for the full scale.
        "surface-1": "hsl(var(--surface-1))",
        "surface-2": "hsl(var(--surface-2))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      fontSize: {
        // Role-named type scale, ported value-for-value from the web/desktop
        // scale at `packages/ui/styles/tokens.css` (`--text-*`). Same names,
        // same sizes, same line-heights — a reader who knows the web scale can
        // read a mobile className without consulting a table.
        //
        // Why the web scale and not a mobile-specific one: the two apps render
        // the same information, and the previous split was invisible rather
        // than deliberate. Mobile had zero role steps and 392 arbitrary
        // `text-[Npx]` values instead, including 10px/9px/8px tiers that exist
        // nowhere in the web scale. Arbitrary values also carry no line-height,
        // so leading fell back to whatever `leading-*` happened to be nearby.
        //
        // Steps are read off tokens.css, not chosen here. Keep the two in sync;
        // `lib/type-scale.test.ts` fails if a step drifts from its web source.
        //
        // SIZES AND LINE-HEIGHTS ARE MULTIPLIED BY `--font-scale` (MYS-2931),
        // exactly as the deployed web build does it: there, every step is
        // `calc(Npx * var(--font-scale, 1))` and the variable is set once on
        // <html> from the Appearance font-size choice. NativeWind compiles a
        // calc-with-var into a runtime descriptor, so the SAME class honours a
        // variable set at runtime — which is what makes one setting move all
        // ~7000 text call sites without touching any of them.
        //
        // The `1` fallback is load-bearing: with no variable set (the
        // follow-system state) every step emits its base size and the app
        // renders byte-identically to before this existed.
        //
        // Do NOT "simplify" a step back to a bare `"11px"`. A plain px step
        // keeps working but silently stops following the font size, and the
        // only visible trace is one block that will not grow — the defect
        // class of MYS-2558.
        micro: [scaleStep(11), scaleStep(15)],
        caption: [scaleStep(12), scaleStep(16)],
        label: [scaleStep(13), scaleStep(18)],
        body: [scaleStep(14), scaleStep(20)],
        "body-lg": [scaleStep(15), scaleStep(22)],
        "title-sm": [scaleStep(16), scaleStep(24)],
        title: [scaleStep(18), scaleStep(28)],
        "title-lg": [scaleStep(20), scaleStep(28)],
        "display-sm": [scaleStep(24), scaleStep(32)],
        display: [scaleStep(36), scaleStep(40)],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      // Native Stack toolbar buttons. `size="icon"` on RNR's Button is 40dp —
      // airy for a 20pt glyph, and wide enough that the issue detail header's
      // seven of them squeezed the title to 27dp (MYS-2534). The visual box is
      // 32dp; `IconButton toolbar` restores the 44dp tappable area with
      // hitSlop, so reach is unchanged. Kept in sync with
      // lib/header-title-budget.ts (`HEADER_ACTION_SIZE`).
      width: {
        "header-icon": "2rem",
      },
      height: {
        "header-icon": "2rem",
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require("tailwindcss-animate")],
};
