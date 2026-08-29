/**
 * Sandboxed HTML block preview document (```html fences).
 *
 * The WebView mounts this document with `javaScriptEnabled={false}` — the
 * "script sandbox" is enforced by the WebView itself, so the document carries
 * no JS of its own (deliberately more restrictive than web's
 * `sandbox="allow-scripts"` frame, and impossible to defeat from the content).
 *
 * Structure: reset styles → the user's HTML is injected into `<body>` inside
 * a scroll-isolated container (`#stage`). The container owns its own scroll so
 * the preview never scrolls the feed.
 *
 * Frame-integrity escaping: a hostile or careless `</body>` / `</html>` /
 * `</script>` in the stored HTML would close the sandbox frame early. Those
 * closing tokens are escaped with a backslash so they render as literal text;
 * `<script>` openers are entity-escaped so a script body can never swallow
 * the rest of the document invisibly. Every other tag is left literal for
 * faithful preview.
 */

/** Escape only the minimal closing tokens that could break the frame. */
function escapeFrameTokens(html: string): string {
  return html
    .replace(/<\/(body|html|script)/gi, "<\\/$1")
    .replace(/<script\b/gi, "&lt;script");
}

export function buildHtmlPreviewDocument(
  htmlSrc: string | undefined,
): string {
  const body = escapeFrameTokens(htmlSrc ?? "");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    width: 100%;
    height: 100%;
  }
  #stage {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: auto;
    -webkit-text-size-adjust: 100%;
  }
</style>
</head>
<body>
  <div id="stage">${body}</div>
</body>
</html>
`;
}