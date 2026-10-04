import { describe, expect, it } from "vitest";
import {
  argsToEntries,
  canSaveCustomArgs,
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

describe("canSaveCustomArgs", () => {
  // The write path this guards (MYS-1910): `PUT /api/agents/{id}` carries
  // `custom_args` as a WHOLE-COLUMN replace (`server/pkg/db/queries/agent.sql:140`
  // is `custom_args = COALESCE(sqlarg, custom_args)`), so saving a list that was
  // seeded from a failed read does not "add an argument" — it deletes every
  // argument the server still had. The page showed 「还没有参数」 for an
  // unreachable read, so the user's natural next move (re-add one) was what
  // triggered the loss. Saving is allowed only once the read settled.

  it("refuses to save while the record read has not settled", () => {
    // The exact data-loss shape: entries look dirty because they were seeded
    // from nothing, but the truth is still in flight.
    expect(canSaveCustomArgs({ dirty: true, readSettled: false })).toBe(false);
  });

  it("refuses to save on a failed read even when the rows look dirty", () => {
    // A failed read is the dangerous one — it is what painted the empty state.
    expect(canSaveCustomArgs({ dirty: true, readSettled: false })).toBe(false);
  });

  it("allows saving once the read settled and there is something to save", () => {
    expect(canSaveCustomArgs({ dirty: true, readSettled: true })).toBe(true);
  });

  it("stays disabled with nothing to save, settled or not", () => {
    expect(canSaveCustomArgs({ dirty: false, readSettled: true })).toBe(false);
    expect(canSaveCustomArgs({ dirty: false, readSettled: false })).toBe(false);
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