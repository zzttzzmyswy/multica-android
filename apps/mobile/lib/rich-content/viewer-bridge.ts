/**
 * Fullscreen MermaidViewer-specific bridge pieces that live above the render
 * document contract (lib/rich-content/mermaid-doc.ts):
 *
 *   - An injected JS bridge (`injectedJavaScript`) defining `__exportSvg` /
 *     `__exportPng` on the viewer WebView. The render document itself only
 *     posts `size` / `svg` / `error`; exports are opt-in.
 *   - A message parser that passes the render-document messages through
 *     unchanged and additionally understands the export payloads.
 *
 * The PNG path stays inside the WebView (SVG → Blob → Image → canvas →
 * dataURL) so react-native doesn't need a rasterizer.
 */

import {
  parseMermaidMessage,
  type MermaidMessage,
} from "./mermaid-doc";

export type MermaidViewerMessage =
  | MermaidMessage
  | { type: "export-svg"; svg: string }
  | { type: "export-png"; dataUrl: string }
  | { type: "export-error"; message: string };

export function parseMermaidViewerMessage(
  raw: string,
): MermaidViewerMessage | null {
  const renderMsg = parseMermaidMessage(raw);
  if (renderMsg) return renderMsg;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const m = parsed as Record<string, unknown>;
    const nonEmptyString = (v: unknown): v is string =>
      typeof v === "string" && v.length > 0;
    switch (m.type) {
      case "export-svg":
        return nonEmptyString(m.svg)
          ? { type: "export-svg", svg: m.svg }
          : null;
      case "export-png":
        return nonEmptyString(m.dataUrl)
          ? { type: "export-png", dataUrl: m.dataUrl }
          : null;
      case "export-error":
        return nonEmptyString(m.message)
          ? { type: "export-error", message: m.message }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * JS injected into the viewer WebView (runs once the frame loads). It defines
 * two window-level hooks the RN side calls via `injectJavaScript`. `__exportPng`
 * re-renders the diagram SVG onto a canvas filled with `background` (the
 * exported PNG stands alone, so it needs its own backdrop).
 */
export function buildExportBridgeJs(background: string): string {
  const bg = JSON.stringify(background);
  return `(function () {
  if (window.__multicaExportLoaded) return;
  window.__multicaExportLoaded = true;
  function emit(m) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(m));
      }
    } catch (_) {}
  }
  window.__multicaExportSvg = function () {
    var svgEl = document.querySelector("svg");
    if (!svgEl) { emit({ type: "export-error", message: "no diagram" }); return; }
    try {
      emit({ type: "export-svg", svg: new XMLSerializer().serializeToString(svgEl) });
    } catch (err) { emit({ type: "export-error", message: String(err) }); }
  };
  window.__multicaExportPng = function () {
    var svgEl = document.querySelector("svg");
    if (!svgEl) { emit({ type: "export-error", message: "no diagram" }); return; }
    var rect = svgEl.getBoundingClientRect();
    var w = Math.max(1, Math.ceil(rect.width));
    var h = Math.max(1, Math.ceil(rect.height));
    try {
      var xml = new XMLSerializer().serializeToString(svgEl);
      var blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = ${bg};
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          emit({ type: "export-png", dataUrl: canvas.toDataURL("image/png") });
        } catch (err) {
          URL.revokeObjectURL(url);
          emit({ type: "export-error", message: String(err) });
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        emit({ type: "export-error", message: "PNG conversion failed" });
      };
      img.src = url;
    } catch (err) {
      emit({ type: "export-error", message: String(err) });
    }
  };
})();`;
}