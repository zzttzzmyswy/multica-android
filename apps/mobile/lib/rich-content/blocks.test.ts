import { describe, expect, it } from "vitest";
import { richFenceKind } from "./blocks";

describe("richFenceKind — fenced-code rich-block dispatch", () => {
  it("returns mermaid for the exact token `mermaid`", () => {
    expect(richFenceKind("mermaid")).toBe("mermaid");
  });

  it("returns html for the exact token `html`", () => {
    expect(richFenceKind("html")).toBe("html");
  });

  it("is whole-token exact: substrings never upgrade (aligned with web isRichFenceLanguage)", () => {
    for (const lang of ["mermaidx", "htmlbars", "xhtml", "mermai", "htm"]) {
      expect(richFenceKind(lang)).toBeNull();
    }
  });

  it("returns null for unknown / absent languages and common code langs", () => {
    for (const lang of [undefined, "", "ts", "typescript", "javascript", "json", "bash"]) {
      expect(richFenceKind(lang)).toBeNull();
    }
  });

  it("is case-sensitive like the web dispatcher", () => {
    expect(richFenceKind("Mermaid")).toBeNull();
    expect(richFenceKind("HTML")).toBeNull();
  });
});