/**
 * Sandboxed KaTeX math document — the rendering engine behind MathBlock
 * (```math fences and standalone $$…$$ blocks).
 *
 * Architecture mirrors mermaid-doc.ts: a pure HTML string is loaded into a
 * WebView (baseUrl=file:///android_asset/, no network), local katex.min.js
 * renders the expression to static HTML, then posts the measured content
 * height back via postMessage so the WebView can size itself to the
 * equation (no fixed height, no clipping).
 *
 * Theme: the document reads `prefers-color-scheme` and passes `colorIsTextColor`
 * -equivalent theming through KaTeX's `colorIsTextColor: false` default; the
 * equation inherits the WebView's foreground color so light/dark both work
 * without a rebuild.
 *
 * Frame-integrity escaping: `</script` inside the expression would close the
 * katex script tag early — the expression travels through a `<pre>` text node
 * (textContent semantics, no HTML parsing) exactly like mermaid-doc's raw
 * source handling.
 */

/** Escape closing script tokens that could break the document frame. */
function escapeScriptClose(src: string): string {
  return src.replace(/<\/script/gi, "<\\/script");
}

export interface KatexRenderOptions {
  /** true = displayMode (block equation, centered), false = inline */
  displayMode?: boolean;
}

export function buildKatexDocument(
  expression: string,
  displayMode: boolean | KatexRenderOptions = true,
): string {
  const opts: KatexRenderOptions =
    typeof displayMode === "boolean" ? { displayMode } : (displayMode ?? {});
  const mode = opts.displayMode ?? true;
  const src = escapeScriptClose(expression ?? "");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="katex.min.css">
<script src="katex.min.js"></script>
<style>
  :root { color-scheme: light dark; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
  }
  body {
    display: flex;
    justify-content: ${mode ? "center" : "flex-start"};
    overflow: hidden;
  }
  #stage {
    color: #24292f;
    padding: 6px 10px;
    overflow-x: auto;
    overflow-y: hidden;
    max-width: 100%;
    box-sizing: border-box;
  }
  @media (prefers-color-scheme: dark) {
    #stage { color: #c9d1d9; }
  }
</style>
</head>
<body>
<pre id="src" style="display:none">${src}</pre>
<div id="stage"></div>
<script>
  (function () {
    var raw = document.getElementById("src").textContent;
    var stage = document.getElementById("stage");
    function post(payload) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }
    try {
      katex.render(raw, stage, {
        displayMode: ${mode ? "true" : "false"},
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml"
      });
      requestAnimationFrame(function () {
        post({ type: "size", height: Math.ceil(stage.scrollHeight) });
      });
    } catch (err) {
      post({ type: "error", message: String(err && err.message || err) });
    }
  })();
</script>
</body>
</html>
`;
}

export interface KatexMessage {
  type: "size" | "error";
  height?: number;
  message?: string;
}

export function parseKatexMessage(data: string | undefined): KatexMessage | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed.type === "size" && typeof parsed.height === "number" && parsed.height > 0) {
      return { type: "size", height: parsed.height };
    }
    if (parsed.type === "error" && typeof parsed.message === "string") {
      return { type: "error", message: parsed.message };
    }
    return null;
  } catch {
    return null;
  }
}
