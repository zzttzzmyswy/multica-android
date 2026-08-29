import { describe, expect, it } from "vitest";
import { buildHtmlPreviewDocument } from "./html-preview-doc";

describe("buildHtmlPreviewDocument — sandboxed HTML block preview", () => {
  it("injects the user HTML into the sandbox body, scroll isolated in a container", () => {
    const doc = buildHtmlPreviewDocument("<h1>Hello</h1><p>world</p>");
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain('<div id="stage">');
    expect(doc).toContain("<h1>Hello</h1><p>world</p>");
    expect(doc).toContain("overflow: auto");
  });

  it("resets margins/padding and the background so the WebView blends into the card", () => {
    const doc = buildHtmlPreviewDocument("<p>x</p>");
    expect(doc).toContain("margin: 0");
    expect(doc).toContain("padding: 0");
    expect(doc).toContain("background: transparent");
  });

  it("keeps the frame intact when the user HTML contains closing body/html tags", () => {
    const doc = buildHtmlPreviewDocument("a</body><script>b</script>");
    // The injected HTML is escaped so it cannot close the sandbox body/html.
    expect(doc).toContain("<\\/body>");
    expect(doc).toContain("<\\/script>");
    // Our own container + closing body/html frames still exist, once each.
    expect(doc).toContain('id="stage"');
    const closeBody = doc.match(/<\/body>/g);
    expect(closeBody).toHaveLength(1);
  });

  it("escapes nothing else: normal markup stays literal for preview rendering", () => {
    const doc = buildHtmlPreviewDocument("<table><tr><td>1</td></tr></table>");
    expect(doc).toContain("<table><tr><td>1</td></tr></table>");
  });

  it("handles empty / undefined input as a blank stage", () => {
    expect(buildHtmlPreviewDocument("")).toContain('<div id="stage"></div>');
    expect(buildHtmlPreviewDocument(undefined)).toContain('<div id="stage"></div>');
  });

  it("carries no JS of our own — the WebView disables JS instead (javaScriptEnabled=false)", () => {
    const doc = buildHtmlPreviewDocument("<p>x</p>");
    expect(doc).not.toContain("<script");
  });
});