import { describe, expect, it } from "vitest";
import {
  buildMermaidDocument,
  getDarkThemeVariables,
  getFallbackThemeVariables,
  parseMermaidMessage,
} from "./mermaid-doc";

describe("parseMermaidMessage — WebView postMessage payloads", () => {
  it("parses a size message", () => {
    expect(parseMermaidMessage('{"type":"size","width":612,"height":340}')).toEqual({
      type: "size",
      width: 612,
      height: 340,
    });
  });

  it("parses a size message carrying the intrinsic (viewBox) size", () => {
    expect(
      parseMermaidMessage(
        '{"type":"size","width":350,"height":240,"naturalWidth":1200,"naturalHeight":800}',
      ),
    ).toEqual({
      type: "size",
      width: 350,
      height: 240,
      naturalWidth: 1200,
      naturalHeight: 800,
    });
  });

  it("rounds fractional sizes up (CSS px never 0.4px in RN layout)", () => {
    expect(parseMermaidMessage('{"type":"size","width":611.4,"height":339.6}')).toEqual({
      type: "size",
      width: 612,
      height: 340,
    });
  });

  it("parses an svg payload", () => {
    expect(
      parseMermaidMessage('{"type":"svg","svg":"<svg xmlns=...></svg>"}'),
    ).toEqual({ type: "svg", svg: "<svg xmlns=...></svg>" });
  });

  it("parses an error payload", () => {
    expect(parseMermaidMessage('{"type":"error","message":"Parse error on line 3"}')).toEqual({
      type: "error",
      message: "Parse error on line 3",
    });
  });

  it("rejects garbage, partial and non-object payloads", () => {
    for (const raw of [
      "",
      "not json",
      '{"type":"weird"}',
      '{"type":"size"}',
      '{"type":"size","width":0,"height":0}',
      '{"type":"error"}',
      "12",
      "null",
    ]) {
      expect(parseMermaidMessage(raw)).toBeNull();
    }
  });
});

describe("getFallbackThemeVariables — web fallback palette", () => {
  it("matches the web mermaid-diagram fallback theme", () => {
    expect(getFallbackThemeVariables()).toEqual({
      primaryColor: "rgb(245, 245, 245)",
      primaryBorderColor: "rgb(59, 130, 246)",
      primaryTextColor: "rgb(17, 24, 39)",
      lineColor: "rgb(107, 114, 128)",
      fontFamily: "inherit",
    });
  });

  it("dark palette keeps the same shape with dark-appropriate colors", () => {
    expect(getDarkThemeVariables()).toEqual({
      primaryColor: "rgb(38, 38, 40)",
      primaryBorderColor: "rgb(96, 165, 250)",
      primaryTextColor: "rgb(243, 244, 246)",
      lineColor: "rgb(148, 163, 184)",
      fontFamily: "inherit",
    });
  });

  it("serializes the dark palette into initialize() when asked", () => {
    const doc = buildMermaidDocument("graph LR\n  A-->B", {
      themeVariables: getDarkThemeVariables(),
    });
    expect(doc).toContain('"primaryColor":"rgb(38, 38, 40)"');
    expect(doc).toContain('"lineColor":"rgb(148, 163, 184)"');
  });
});

describe("buildMermaidDocument — sandboxed render document", () => {
  it("embeds the source so it renders as a diagram, not text", () => {
    const doc = buildMermaidDocument("graph LR\n  A-->B");
    expect(doc).toContain("mermaid.initialize");
    expect(doc).toContain('securityLevel: "strict"');
    expect(doc).toContain("htmlLabels: false");
    expect(doc).toContain("suppressErrorRendering: true");
    expect(doc).toContain('theme: "base"');
  });

  it("references mermaid.min.js relative to the asset baseUrl", () => {
    const doc = buildMermaidDocument("graph LR\n  A-->B");
    // No CDN / no absolute URL — loads from file:///android_asset/.
    expect(doc).toContain('<script src="mermaid.min.js"></script>');
    expect(doc).not.toMatch(/https?:\/\//);
  });

  it("carries the raw source through an escaped <pre id=\"raw\"> read back by textContent", () => {
    // `</script>` inside a diagram would break the frame if unescaped.
    const nasty = "graph TD\n  x[\"</script><script>alert(1)</script>\"]";
    const doc = buildMermaidDocument(nasty);
    const rawOpen = doc.indexOf('<pre id="raw">');
    const rawClose = doc.indexOf("</pre>", rawOpen);
    const rawBlock = doc.slice(rawOpen, rawClose);

    expect(rawOpen).toBeGreaterThan(-1);
    // The literal `</script` must not appear inside the raw block.
    expect(rawBlock).not.toContain("</script");
    // The doc still reads the ESCAPED source back via textContent.
    expect(rawBlock).toContain("&lt;/script&gt;");
    expect(doc).toContain("document.getElementById(\"raw\").textContent");
  });

  it("escapes &, <, > and U+2028/2029 line separators in the raw block", () => {
    const doc = buildMermaidDocument("graph LR\n  a{&} --> b[<b>]");
    // Raw block must NOT contain raw '<' from the source.
    const rawBlock = doc.slice(doc.indexOf('<pre id="raw">'), doc.indexOf("</pre>"));
    expect(rawBlock).not.toContain("<b>");
    expect(rawBlock).toContain("&lt;b&gt;");
    expect(rawBlock).toContain("&amp;");

    const withSep = buildMermaidDocument("graph LR\n  a --> b" + " " + " ");
    expect(withSep).not.toContain(" ");
    expect(withSep).not.toContain(" ");
  });

  it("posts size, svg and error messages through ReactNativeWebView", () => {
    const doc = buildMermaidDocument("graph LR\n  A-->B");
    expect(doc).toContain("window.ReactNativeWebView");
    expect(doc).toContain("ReactNativeWebView.postMessage");
    expect(doc).toContain('type: "size"');
    expect(doc).toContain('{ type: "svg"');
    expect(doc).toContain('{ type: "error"');
    expect(doc).toContain("msg.naturalWidth = natural.width");
  });

  it("serializes themeVariables from opts into initialize()", () => {
    const vars = {
      primaryColor: "rgb(1, 2, 3)",
      primaryBorderColor: "rgb(4, 5, 6)",
      primaryTextColor: "rgb(7, 8, 9)",
      lineColor: "rgb(10, 11, 12)",
      fontFamily: "inherit",
    };
    const doc = buildMermaidDocument("graph LR\n  A-->B", { themeVariables: vars });
    expect(doc).toContain('"primaryColor":"rgb(1, 2, 3)"');
    expect(doc).toContain('"lineColor":"rgb(10, 11, 12)"');
  });

  it("defaults themeVariables to the web fallback when opts omit them", () => {
    const doc = buildMermaidDocument("graph LR\n  A-->B");
    expect(doc).toContain('"primaryColor":"rgb(245, 245, 245)"');
    expect(doc).toContain('"fontFamily":"inherit"');
  });
});

describe("buildMermaidDocument — viewer variant", () => {
  it("draws at natural size inside a scrollable stage, no width clamp", () => {
    const doc = buildMermaidDocument("graph LR\n  A-->B", { viewer: true });
    expect(doc).toContain("wantNatural = true");
    expect(doc).toContain("overflow: auto");
    expect(doc).toContain("naturalSize(svgEl)");
    expect(doc).toContain("svgEl.style.width = natural.width + \"px\"");
  });

  it("carries the mount containers the render script touches (#diagram, #stage for viewer)", () => {
    const inline = buildMermaidDocument("graph LR\n  A-->B");
    expect(inline).toContain('<div id="diagram"></div>');
    const viewer = buildMermaidDocument("graph LR\n  A-->B", { viewer: true });
    expect(viewer).toContain('<div id="stage">');
    expect(viewer).toContain('<div id="diagram"></div>');
    // The script mounts into #diagram — no null deref on firstChild.
    expect(viewer).toContain('document.getElementById("diagram")');
  });

  it("inline variant clamps to the container width instead", () => {
    const doc = buildMermaidDocument("graph LR\n  A-->B");
    expect(doc).toContain("wantNatural = false");
    expect(doc).toContain('svgEl.style.maxWidth = "100%"');
    expect(doc).toContain('svgEl.style.height = "auto"');
  });

  it("posts size (with intrinsic), svg and error for the viewer too", () => {
    const doc = buildMermaidDocument("graph LR\n  A-->B", { viewer: true });
    expect(doc).toContain("ReactNativeWebView.postMessage");
    expect(doc).toContain("mermaid.initialize");
    expect(doc).toContain("msg.naturalWidth = natural.width");
  });
});