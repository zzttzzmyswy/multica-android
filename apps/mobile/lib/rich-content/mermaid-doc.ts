/**
 * Mermaid document builder + WebView message parsing — pure functions that
 * produce the sandboxed HTML document a WebView renders for a ```mermaid
 * fence, and interpret the messages that document posts back.
 *
 * Render model (aligned with web mermaid-diagram.tsx):
 *
 *   - mermaid.min.js is bundled into the APK (android assets) and loaded via
 *     `<script src="mermaid.min.js">` relative to `baseUrl=file:///android_asset/`
 *     — no CDN, no network dependency.
 *   - The diagram source is carried in an escaped `<pre id="raw">` and read
 *     back with `textContent`, so `</script>`, `<` / `>` and U+2028/2029 line
 *     separators in user content can never break out of the frame.
 *   - `mermaid.initialize({startOnLoad:false, securityLevel:"strict",
 *     theme:"base", htmlLabels:false, suppressErrorRendering:true,
 *     themeVariables})` — same flags as web. `htmlLabels:false` keeps labels
 *     as SVG `<text>` (rasterizable for PNG export).
 *   - After render the script posts:
 *     {type:"size", width, height, naturalWidth, naturalHeight} — the
 *       DISPLAYED box (drives the inline container height, right-to-left)
 *       plus the INTRINSIC size parsed from the svg viewBox (the fullscreen
 *       viewer renders at natural size);
 *     {type:"svg", svg} — serialized markup for export;
 *     {type:"error", message} — render failure. suppressErrorRendering makes
 *       Mermaid throw instead of drawing its own error graphic into the DOM.
 */

export interface MermaidThemeVariables {
  primaryColor: string;
  primaryBorderColor: string;
  primaryTextColor: string;
  lineColor: string;
  fontFamily: string;
}

/**
 * The same fallback palette web uses when it cannot resolve CSS variables
 * (mermaid-diagram.tsx getMermaidThemeVariables(null)).
 */
export function getFallbackThemeVariables(): MermaidThemeVariables {
  return {
    primaryColor: "rgb(245, 245, 245)",
    primaryBorderColor: "rgb(59, 130, 246)",
    primaryTextColor: "rgb(17, 24, 39)",
    lineColor: "rgb(107, 114, 128)",
    fontFamily: "inherit",
  };
}

/**
 * Dark-mode palette — the same values the fullscreen viewer resolves for a
 * dark color scheme, so inline diagrams and the viewer agree.
 */
export function getDarkThemeVariables(): MermaidThemeVariables {
  return {
    primaryColor: "rgb(38, 38, 40)",
    primaryBorderColor: "rgb(96, 165, 250)",
    primaryTextColor: "rgb(243, 244, 246)",
    lineColor: "rgb(148, 163, 184)",
    fontFamily: "inherit",
  };
}

export type MermaidMessage =
  | {
      type: "size";
      width: number;
      height: number;
      naturalWidth?: number;
      naturalHeight?: number;
    }
  | { type: "svg"; svg: string }
  | { type: "error"; message: string };

/** Base URL the mermaid documents load mermaid.min.js from (Android assets). */
export const MERMAID_ASSET_BASE_URL = "file:///android_asset/";

export const MERMAID_SKELETON_HEIGHT_PX = 240;

/** Parse a postMessage payload from a mermaid document. Garbage → null. */
export function parseMermaidMessage(raw: string): MermaidMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  if (
    obj.type === "size" &&
    typeof obj.width === "number" &&
    typeof obj.height === "number" &&
    obj.width > 0 &&
    obj.height > 0
  ) {
    const naturalWidth =
      typeof obj.naturalWidth === "number" && obj.naturalWidth > 0
        ? Math.ceil(obj.naturalWidth)
        : undefined;
    const naturalHeight =
      typeof obj.naturalHeight === "number" && obj.naturalHeight > 0
        ? Math.ceil(obj.naturalHeight)
        : undefined;
    return {
      type: "size",
      width: Math.ceil(obj.width),
      height: Math.ceil(obj.height),
      ...(naturalWidth !== undefined ? { naturalWidth } : {}),
      ...(naturalHeight !== undefined ? { naturalHeight } : {}),
    };
  }
  if (obj.type === "svg" && typeof obj.svg === "string") {
    return { type: "svg", svg: obj.svg };
  }
  if (obj.type === "error" && typeof obj.message === "string") {
    return { type: "error", message: obj.message };
  }
  return null;
}

/**
 * Escape diagram source for direct inclusion inside an HTML `<pre>`: entity
 * escaping so `</script>` and `<` / `>` can never terminate the frame, plus
 * U+2028 / U+2029 (line terminator characters — written as \u escapes
 * because a literal character would end a regex literal). `textContent`
 * decodes everything back to the original source.
 */
function escapeHtmlText(src: string): string {
  return src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u2028/g, "&#x2028;")
    .replace(/\u2029/g, "&#x2029;");
}

export interface MermaidDocumentOptions {
  /** Fullscreen-viewer variant: natural size, no width clamp, own scroll. */
  viewer?: boolean;
  themeVariables?: MermaidThemeVariables;
}

const RENDER_SCRIPT = (
  viewer: boolean,
  themeVariables: MermaidThemeVariables,
): string => `(function () {
  "use strict";
  var source = document.getElementById("raw").textContent;
  var wantNatural = ${viewer ? "true" : "false"};
  function post(msg) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }
  function fail(err) {
    post({ type: "error", message: String(err && err.message ? err.message : err) });
  }
  function naturalSize(svgEl) {
    var vb = svgEl.getAttribute("viewBox");
    if (vb) {
      var p = vb.split(/[\\s,]+/).map(Number);
      if (p.length === 4 && p[2] > 0 && p[3] > 0) {
        return { width: Math.ceil(p[2]), height: Math.ceil(p[3]) };
      }
    }
    var w = parseFloat(svgEl.getAttribute("width"));
    var h = parseFloat(svgEl.getAttribute("height"));
    if (w > 0 && h > 0) return { width: Math.ceil(w), height: Math.ceil(h) };
    return null;
  }
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      htmlLabels: false,
      suppressErrorRendering: true,
      themeVariables: ${JSON.stringify(themeVariables)}
    });
    var id = "mc-mm-" + Math.floor(Math.random() * 1e9).toString(36);
    mermaid.render(id, source).then(function (res) {
      var svgEl;
      try {
        var tmp = document.createElement("div");
        tmp.innerHTML = res.svg;
        svgEl = tmp.firstElementChild;
      } catch (e) { fail(e); return; }
      if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") {
        fail(new Error("Mermaid diagram did not render"));
        return;
      }
      var stage = document.getElementById("diagram");
      while (stage.firstChild) stage.removeChild(stage.firstChild);
      stage.appendChild(svgEl);
      var natural = naturalSize(svgEl);
      if (wantNatural && natural) {
        // Viewer: draw at intrinsic size inside a scrollable stage.
        svgEl.style.maxWidth = "none";
        svgEl.style.width = natural.width + "px";
        svgEl.style.height = natural.height + "px";
      } else {
        // Inline: clamp to the container, height follows the aspect ratio.
        svgEl.style.maxWidth = "100%";
        svgEl.style.height = "auto";
      }
      var rect = svgEl.getBoundingClientRect();
      var msg = {
        type: "size",
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height)),
      };
      if (natural) {
        msg.naturalWidth = natural.width;
        msg.naturalHeight = natural.height;
      }
      post(msg);
      post({ type: "svg", svg: new XMLSerializer().serializeToString(svgEl) });
    }).catch(fail);
  } catch (e) { fail(e); }
})();
`;

function buildMermaidDocumentImpl(
  source: string,
  viewer: boolean,
  opts: MermaidDocumentOptions,
): string {
  const themeVariables = { ...getFallbackThemeVariables(), ...(opts.themeVariables ?? {}) };

  const css = viewer
    ? [
        "#raw { display: none; }",
        "html, body { margin: 0; padding: 0; background: transparent; width: 100%; height: 100%; overflow: hidden; }",
        "#stage { box-sizing: border-box; width: 100%; height: 100%; overflow: auto; }",
        "#diagram svg { display: block; }",
      ].join("\n  ")
    : [
        "#raw { display: none; }",
        "#diagram { display: flex; justify-content: center; }",
        "#diagram svg { display: block; }",
      ].join("\n  ");

  const stage = viewer ? '<div id="stage"><div id="diagram"></div></div>' : '<div id="diagram"></div>';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  ${css}
</style>
<script src="mermaid.min.js"></script>
</head>
<body>
<pre id="raw">${escapeHtmlText(source)}</pre>
${stage}
<script>
${RENDER_SCRIPT(viewer, themeVariables)}
</script>
</body>
</html>
`;
}

export function buildMermaidDocument(
  source: string,
  opts: MermaidDocumentOptions = {},
): string {
  return buildMermaidDocumentImpl(source, opts.viewer ?? false, opts);
}