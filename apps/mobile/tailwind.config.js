/**
 * RNR template config (verbatim) + Multica custom token mappings appended.
 *
 * Colors map to CSS variables in apps/mobile/global.css. When changing a
 * variable name there, mirror the change here AND in apps/mobile/lib/theme.ts.
 *
 * See apps/mobile/docs/rnr-migration.md §5 for the sync rule.
 */
const { hairlineWidth } = require("nativewind/theme");

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
        micro: ["11px", "15px"],
        caption: ["12px", "16px"],
        label: ["13px", "18px"],
        body: ["14px", "20px"],
        "body-lg": ["15px", "22px"],
        "title-sm": ["16px", "24px"],
        title: ["18px", "28px"],
        "title-lg": ["20px", "28px"],
        "display-sm": ["24px", "32px"],
        display: ["36px", "40px"],
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
