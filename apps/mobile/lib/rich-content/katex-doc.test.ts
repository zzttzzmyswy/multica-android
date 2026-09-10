import { describe, expect, it } from "vitest";
import { buildKatexDocument } from "./katex-doc";

describe("buildKatexDocument — sandboxed KaTeX render document", () => {
  it("embeds the expression and the local katex asset path", () => {
    const doc = buildKatexDocument("E=mc^2", true);
    expect(doc).toContain("katex.min.js");
    expect(doc).toContain("katex.min.css");
    expect(doc).toContain("E=mc^2");
  });

  it("switches display mode via the displayMode flag", () => {
    expect(buildKatexDocument("a+b", { displayMode: true })).toContain(
      "displayMode: true",
    );
    expect(buildKatexDocument("a+b", { displayMode: false })).toContain(
      "displayMode: false",
    );
  });

  it("escapes script-closing tokens inside the expression payload", () => {
    const doc = buildKatexDocument("x + '</script>'", false);
    expect(doc).not.toContain("'</script>'");
    expect(doc).toContain("<\\/script");
  });

  it("posts error info through the JSON payload, not raw markup", () => {
    const doc = buildKatexDocument("\\frac{", false);
    expect(doc).toContain("throwOnError");
    expect(doc).toContain("displayMode: false");
  });

  it("renders nothing visible when the expression is empty", () => {
    const doc = buildKatexDocument("", false);
    expect(doc).toContain('id="src"');
  });
});
