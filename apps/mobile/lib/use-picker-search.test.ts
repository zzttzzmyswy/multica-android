/**
 * The mode-aware search hook and the body shell must agree on one invariant:
 * if a picker cannot get a native search bar, the body must draw one.
 *
 * The mobile vitest lane is Node-only (see vitest.config.ts — no RN
 * renderer), so these read the sources and assert the shape of the
 * derivation instead of exercising a render.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const HOOK = code("lib/use-picker-search.ts");
const SHELL = code("components/pickers/picker-body-shell.tsx");

describe("usePickerSearch", () => {
  it("only takes the native path on iOS", () => {
    // Android never renders `headerSearchBarOptions`; a route that chose the
    // native path there would have no search box at all.
    expect(HOOK).toMatch(/Platform\.OS === "ios"/);
  });

  it("requires the route to actually have a native header", () => {
    expect(HOOK).toMatch(/nativeHeader/);
    expect(HOOK).toMatch(/Platform\.OS === "ios" && nativeHeader/);
  });

  it("defaults to the body path when the header is not declared", () => {
    expect(HOOK).toMatch(/nativeHeader\s*=\s*options\?\.nativeHeader \?\? false/);
  });

  it("registers the native search bar only in native mode", () => {
    expect(HOOK).toMatch(/if \(mode !== "native"\) return;/);
    expect(HOOK).toMatch(/headerSearchBarOptions/);
  });

  it("clears the query on cancel, which does not fire onChangeText", () => {
    expect(HOOK).toMatch(/onCancelButtonPress/);
  });

  it("exposes the query in the shape PickerBodyShell consumes", () => {
    for (const field of ["mode", "query", "onQueryChange", "placeholder"]) {
      expect(HOOK).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});

describe("PickerBodyShell", () => {
  it("draws the search field exactly when the search is body-hosted", () => {
    expect(SHELL).toMatch(/bodyChrome\s*=\s*search\.mode === "body"/);
    expect(SHELL).toMatch(/\{bodyChrome \? \(/);
    expect(SHELL).toMatch(/<SearchField/);
  });

  it("renders a real text input, not a disabled stand-in", () => {
    expect(SHELL).toMatch(/<TextInput/);
    expect(SHELL).toMatch(/onChangeText=\{onChange\}/);
    expect(SHELL).not.toMatch(/editable=\{false\}/);
  });

  it("offers a cross-platform clear control", () => {
    // `clearButtonMode` is iOS-only, so an Android user needs the explicit
    // button or the only way to clear the filter is deleting characters.
    expect(SHELL).not.toMatch(/clearButtonMode/);
    expect(SHELL).toMatch(/onChange\(""\)/);
  });

  it("hides the title where the native header already draws one", () => {
    expect(SHELL).toMatch(/\{bodyChrome && title \? \(/);
  });
});
