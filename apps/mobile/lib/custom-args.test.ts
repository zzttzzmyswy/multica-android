import { describe, expect, it } from "vitest";
import {
  argsToEntries,
  customArgsDirty,
  entriesToArgs,
  formatArgForPreview,
  launchPreview,
} from "./custom-args";

describe("argsToEntries / entriesToArgs round-trip", () => {
  it("maps args to entries preserving order", () => {
    const entries = argsToEntries(["--profile", "--verbose"]);
    expect(entries).toHaveLength(2);
    expect(entries[0].value).toBe("--profile");
    expect(entries[1].value).toBe("--verbose");
    expect(entries[0].id).toBeTruthy();
    expect(entries[1].id).toBeTruthy();
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it("round-trips through entriesToArgs without modification", () => {
    const args = ["--model", "gpt-4", "--tokens", "256"];
    expect(entriesToArgs(argsToEntries(args))).toEqual(args);
  });

  it("trims whitespace from each entry", () => {
    const entries = [
      { id: "a", value: "  --profile  " },
      { id: "b", value: "\t--dry-run\n" },
    ];
    expect(entriesToArgs(entries)).toEqual(["--profile", "--dry-run"]);
  });

  it("drops blank-only entries (aligns entriesToArgs filter(Boolean))", () => {
    const entries = [
      { id: "a", value: "--profile" },
      { id: "b", value: "   " },
      { id: "c", value: "" },
      { id: "d", value: "--verbose" },
    ];
    expect(entriesToArgs(entries)).toEqual(["--profile", "--verbose"]);
  });

  it("empty list stays empty", () => {
    expect(entriesToArgs([])).toEqual([]);
  });
});

describe("customArgsDirty", () => {
  it("false when identical", () => {
    expect(customArgsDirty(["--a", "--b"], ["--a", "--b"])).toBe(false);
  });

  it("true when empty vs non-empty", () => {
    expect(customArgsDirty([], ["--a"])).toBe(true);
    expect(customArgsDirty(["--a"], [])).toBe(true);
  });

  it("true on add", () => {
    expect(customArgsDirty(["--a", "--b"], ["--a"])).toBe(true);
  });

  it("true on remove", () => {
    expect(customArgsDirty(["--a"], ["--a", "--b"])).toBe(true);
  });

  it("true on edit value", () => {
    expect(customArgsDirty(["--a", "--c"], ["--a", "--b"])).toBe(true);
  });

  it("true on reorder (order is argv-significant)", () => {
    expect(customArgsDirty(["--b", "--a"], ["--a", "--b"])).toBe(true);
  });

  it("normalised values participate (trimmed before compare by caller)", () => {
    expect(customArgsDirty(["--a"], ["--a"])).toBe(false);
  });
});

describe("formatArgForPreview", () => {
  it("keeps simple args verbatim", () => {
    expect(formatArgForPreview("--profile")).toBe("--profile");
  });

  it("JSON-quotes args containing whitespace", () => {
    expect(formatArgForPreview("two words")).toBe('"two words"');
    expect(formatArgForPreview("  leading")).toBe('"  leading"');
    expect(formatArgForPreview("tab\tinside")).toBe('"tab\\tinside"');
  });
});

describe("launchPreview", () => {
  it("builds header + args joined by single spaces", () => {
    expect(launchPreview("multica run", ["--profile", "--verbose"])).toBe(
      "multica run --profile --verbose",
    );
  });

  it("quotes args containing whitespace inside the preview", () => {
    expect(launchPreview("multica run", ["--note", "two words"])).toBe(
      'multica run --note "two words"',
    );
  });

  it("returns the header alone when no args", () => {
    expect(launchPreview("multica run", [])).toBe("multica run");
  });

  it("returns null when no launch header (web hides the preview)", () => {
    expect(launchPreview(null, ["--a"])).toBeNull();
    expect(launchPreview(undefined, ["--a"])).toBeNull();
    expect(launchPreview("", ["--a"])).toBeNull();
  });
});