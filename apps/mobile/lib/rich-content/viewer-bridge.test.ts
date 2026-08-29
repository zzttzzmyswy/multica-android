import { describe, expect, it } from "vitest";
import {
  buildExportBridgeJs,
  parseMermaidViewerMessage,
} from "./viewer-bridge";

describe("parseMermaidViewerMessage", () => {
  it("passes render-document messages through", () => {
    expect(parseMermaidViewerMessage('{"type":"size","width":612,"height":340}')).toEqual({
      type: "size",
      width: 612,
      height: 340,
    });
    expect(parseMermaidViewerMessage('{"type":"svg","svg":"<svg/>"}')).toEqual({
      type: "svg",
      svg: "<svg/>",
    });
    expect(parseMermaidViewerMessage('{"type":"error","message":"boom"}')).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("parses export payloads", () => {
    expect(
      parseMermaidViewerMessage('{"type":"export-svg","svg":"<svg/>"}'),
    ).toEqual({ type: "export-svg", svg: "<svg/>" });
    expect(
      parseMermaidViewerMessage('{"type":"export-png","dataUrl":"data:image/png;base64,QQ=="}'),
    ).toEqual({ type: "export-png", dataUrl: "data:image/png;base64,QQ==" });
    expect(parseMermaidViewerMessage('{"type":"export-error","message":"no diagram"}')).toEqual(
      { type: "export-error", message: "no diagram" },
    );
  });

  it("rejects garbage and malformed export payloads", () => {
    for (const raw of ["", "nope", "12", "null", '{"type":"export-svg"}', '{"type":"export-png","dataUrl":123}']) {
      expect(parseMermaidViewerMessage(raw)).toBeNull();
    }
  });
});

describe("buildExportBridgeJs", () => {
  const js = buildExportBridgeJs("#ffffff");

  it("defines both export hooks once (idempotent guard)", () => {
    expect(js).toContain("window.__multicaExportSvg");
    expect(js).toContain("window.__multicaExportPng");
    expect(js).toContain("window.__multicaExportLoaded");
  });

  it("bakes the requested PNG background into the canvas fill", () => {
    expect(js).toContain('"#ffffff"');
  });

  it("never runs scripts from content — the WebView owns execution", () => {
    expect(js).not.toContain("eval(");
    expect(js).toContain("document.querySelector(\"svg\")");
  });
});