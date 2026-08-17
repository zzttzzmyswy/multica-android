import { describe, expect, it } from "vitest";
import { insertMarkdown, type TextSelection } from "./markdown-insert";

const sel = (start: number, end = start): TextSelection => ({ start, end });

describe("insertMarkdown — list", () => {
  it("inserts `- ` at line start when the caret sits at the start of an empty text", () => {
    expect(insertMarkdown("", sel(0), "list")).toEqual({
      text: "- ",
      selection: sel(2),
    });
  });

  it("inserts `- ` at the start of the first line when the caret is mid-line", () => {
    expect(insertMarkdown("hello world", sel(6), "list")).toEqual({
      text: "- hello world",
      selection: sel(8),
    });
  });

  it("inserts `- ` at the start of the caret's own line (not the buffer start)", () => {
    expect(insertMarkdown("abc\ndef", sel(5), "list")).toEqual({
      text: "abc\n- def",
      selection: sel(7),
    });
  });

  it("caret right after a newline anchors to the new line", () => {
    expect(insertMarkdown("abc\n", sel(4), "list")).toEqual({
      text: "abc\n- ",
      selection: sel(6),
    });
  });

  it("shifts a range selection right by the prefix length, preserving it", () => {
    expect(insertMarkdown("foo bar", sel(2, 6), "list")).toEqual({
      text: "- foo bar",
      selection: sel(4, 8),
    });
  });

  it("shifts a multi-line range selection right without touching its content", () => {
    expect(insertMarkdown("a\nb", sel(0, 3), "list")).toEqual({
      text: "- a\nb",
      selection: sel(2, 5),
    });
  });

  it("is idempotent when the line already starts with `- `", () => {
    const text = "- foo";
    const s = sel(5);
    expect(insertMarkdown(text, s, "list")).toEqual({ text, selection: s });
  });

  it("is idempotent when the line already starts with `- [ ] `", () => {
    const text = "- [ ] foo";
    const s = sel(text.length);
    expect(insertMarkdown(text, s, "list")).toEqual({ text, selection: s });
  });

  it("is idempotent when the line already starts with `> `", () => {
    const text = "> foo";
    const s = sel(2);
    expect(insertMarkdown(text, s, "list")).toEqual({ text, selection: s });
  });

  it("returns the original object references on no-op", () => {
    const text = "- foo";
    const s = sel(3);
    const out = insertMarkdown(text, s, "list");
    expect(out.text).toBe(text);
    expect(out.selection).toBe(s);
  });
});

describe("insertMarkdown — checkbox", () => {
  it("inserts `- [ ] ` at line start, caret shifted by the prefix", () => {
    expect(insertMarkdown("abc", sel(2), "checkbox")).toEqual({
      text: "- [ ] abc",
      selection: sel(8),
    });
  });

  it("anchors to the caret's line and shifts a selection", () => {
    expect(insertMarkdown("x\ny", sel(2, 3), "checkbox")).toEqual({
      text: "x\n- [ ] y",
      selection: sel(8, 9),
    });
  });

  it("is idempotent when the line is already a checklist item", () => {
    const text = "- [ ] foo";
    const s = sel(4);
    expect(insertMarkdown(text, s, "checkbox")).toEqual({ text, selection: s });
  });

  it("is idempotent on a plain bullet or quote prefix instead of stacking", () => {
    const text = "- foo";
    const s = sel(4);
    expect(insertMarkdown(text, s, "checkbox")).toEqual({ text, selection: s });
  });
});

describe("insertMarkdown — quote", () => {
  it("inserts `> ` at line start, caret shifted by the prefix", () => {
    expect(insertMarkdown("abc", sel(3), "quote")).toEqual({
      text: "> abc",
      selection: sel(5),
    });
  });

  it("is idempotent when the line already starts with `> `", () => {
    const text = "> foo";
    const s = sel(6);
    expect(insertMarkdown(text, s, "quote")).toEqual({ text, selection: s });
  });

  it("is idempotent on a bullet prefix instead of stacking", () => {
    const text = "- foo";
    const s = sel(2);
    expect(insertMarkdown(text, s, "quote")).toEqual({ text, selection: s });
  });
});

describe("insertMarkdown — code", () => {
  const FENCE = "```\n\n```";

  it("inserts a fenced block at the caret and parks the caret in the empty middle line", () => {
    expect(insertMarkdown("abc", sel(2), "code")).toEqual({
      text: `ab${FENCE}c`,
      selection: sel(6),
    });
  });

  it("inserts cleanly on its own new line when the caret is alone on a line", () => {
    expect(insertMarkdown("a\n\nb", sel(2), "code")).toEqual({
      text: `a\n${FENCE}\nb`,
      selection: sel(6),
    });
  });

  it("replaces a range selection with the fence and parks the caret inside", () => {
    expect(insertMarkdown("abXYcd", sel(2, 4), "code")).toEqual({
      text: `ab${FENCE}cd`,
      selection: sel(6),
    });
  });

  it("replaces a whole-text selection", () => {
    expect(insertMarkdown("hello", sel(0, 5), "code")).toEqual({
      text: FENCE,
      selection: sel(4),
    });
  });

  it("works on empty text", () => {
    expect(insertMarkdown("", sel(0), "code")).toEqual({
      text: FENCE,
      selection: sel(4),
    });
  });
});