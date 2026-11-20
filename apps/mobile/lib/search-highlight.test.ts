import { describe, expect, it } from "vitest";
import { searchHighlightParts } from "./search-highlight";

describe("search result highlighting", () => {
  it("keeps the exact phrase together and highlights separated terms", () => {
    expect(searchHighlightParts("New project and new shared PROJECT", "new project")
      .filter((part) => part.hit).map((part) => part.text))
      .toEqual(["New project", "new", "PROJECT"]);
  });

  it("handles literal punctuation and Chinese without changing the source text", () => {
    const text = "先确认 API+，再确认设置。";
    const parts = searchHighlightParts(text, "API+ 设置");
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual(["API+", "设置"]);
    expect(parts.map((part) => part.text).join("")).toBe(text);
  });

  it("leaves empty queries, empty inputs and non-matches alone", () => {
    expect(searchHighlightParts("abc", "  ")).toEqual([{ text: "abc", hit: false }]);
    expect(searchHighlightParts("", "x")).toEqual([{ text: "", hit: false }]);
    expect(searchHighlightParts("abc", ".")).toEqual([{ text: "abc", hit: false }]);
  });
});
