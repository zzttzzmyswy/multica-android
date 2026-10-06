/**
 * Wiring guard: every search-enabled picker route must be able to receive a
 * query on Android.
 *
 * The defect this pins (MYS-1968): ten picker routes took their `query` from
 * an iOS `UISearchController` registered via `headerSearchBarOptions`. Expo
 * does not render that option on Android, so there the query stayed `""`
 * forever and every list was unfilterable. On the routes whose sheet hides
 * the nav header, `react-native-screens` returns early from its header-config
 * builder, so the controller never mounted on iOS either.
 *
 * The ratchet is on the *call sites*, not on the hook's existence: the
 * previous iteration shipped a correct pinyin predicate that stayed green for
 * a whole release because nothing asserted the routes were wired to anything
 * that could feed it. So this file asserts, per route:
 *
 *   1. it obtains its query from `usePickerSearch` (the mode-aware hook),
 *   2. it renders `PickerBodyShell` — which draws the body search field
 *      whenever the platform cannot supply a native one,
 *   3. it passes `search.query` into the body, so the filter predicate and
 *      the input cannot drift apart,
 *   4. it no longer imports the removed iOS-only hook,
 *   5. a route keeps the iOS native bar only if the layout actually gives it
 *      a nav header to mount in.
 *
 * (5) is read from the layout rather than from a hardcoded list, so the two
 * files cannot disagree: promising `nativeHeader` on a header-less route is
 * exactly how a picker ends up with no search box on either platform.
 *
 * Removing any one route's wiring turns this red.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const LAYOUT = "app/(app)/[workspace]/_layout.tsx";

/** Every route that offers a searchable picker list. */
const SEARCHABLE_PICKER_ROUTES = [
  "app/(app)/[workspace]/issue/[id]/picker/assignee.tsx",
  "app/(app)/[workspace]/issue/[id]/picker/label.tsx",
  "app/(app)/[workspace]/issue/[id]/picker/project.tsx",
  "app/(app)/[workspace]/mention-picker.tsx",
  "app/(app)/[workspace]/new-issue-picker/agent.tsx",
  "app/(app)/[workspace]/new-issue-picker/assignee.tsx",
  "app/(app)/[workspace]/new-issue-picker/labels.tsx",
  "app/(app)/[workspace]/new-issue-picker/project.tsx",
  "app/(app)/[workspace]/project/[id]/picker/lead.tsx",
  "app/(app)/[workspace]/chat-project-picker.tsx",
];

function read(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

/** Source with comments stripped, so a comment quoting a call cannot satisfy
 *  an assertion (the pattern the sibling guards use). */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Route name as the layout registers it — the file path minus the
 *  route-group parents and the extension. */
function routeName(rel: string): string {
  const m = rel.match(/\[workspace\]\/(.+)\.tsx$/);
  if (!m) throw new Error(`unexpected route path ${rel}`);
  return m[1];
}

/** True when the layout registers this route with `headerShown: true`, i.e.
 *  iOS gets a nav header for the native search bar to mount in. */
function layoutShowsHeader(name: string): boolean {
  const src = code(LAYOUT);
  const idx = src.indexOf(`name="${name}"`);
  if (idx === -1) throw new Error(`layout does not register ${name}`);
  // The options object follows the name; the next Stack.Screen ends it.
  const rest = src.slice(idx);
  const end = rest.indexOf("<Stack.Screen", 1);
  const block = end === -1 ? rest : rest.slice(0, end);
  return /headerShown:\s*true/.test(block);
}

describe("searchable picker routes", () => {
  it("lists exactly the routes that call the search hook", () => {
    expect(SEARCHABLE_PICKER_ROUTES).toHaveLength(10);
    expect(new Set(SEARCHABLE_PICKER_ROUTES).size).toBe(10);
  });

  for (const rel of SEARCHABLE_PICKER_ROUTES) {
    describe(rel, () => {
      const src = code(rel);

      it("gets its query from the mode-aware hook", () => {
        expect(src).toContain('from "@/lib/use-picker-search"');
        expect(src).toMatch(/usePickerSearch\(/);
      });

      it("renders the body shell that draws the search field", () => {
        expect(src).toContain('from "@/components/pickers/picker-body-shell"');
        expect(src).toMatch(/<PickerBodyShell\b/);
        expect(src).toMatch(/search=\{search\}/);
      });

      it("feeds search.query into the picker body", () => {
        // The body's own `query` prop must come from the hook — a route that
        // still passed a literal or a stale local would filter on the wrong
        // value while looking wired.
        expect(src).toMatch(/query=\{search\.query\}/);
      });

      it("does not keep the iOS-only search bar", () => {
        expect(src).not.toContain("use-native-search-bar");
        expect(src).not.toContain("useNativeSearchBar");
        expect(src).not.toContain("headerSearchBarOptions");
      });

      it("claims a native header only when the layout grants one", () => {
        const claims = /nativeHeader:\s*true/.test(src);
        const grants = layoutShowsHeader(routeName(rel));
        expect(claims).toBe(grants);
      });
    });
  }

  it("keeps the iOS native bar on at least one route", () => {
    // Otherwise the native path is dead code and nobody would notice it rot.
    const claiming = SEARCHABLE_PICKER_ROUTES.filter((r) =>
      /nativeHeader:\s*true/.test(code(r)),
    );
    expect(claiming.length).toBeGreaterThan(0);
  });
});
