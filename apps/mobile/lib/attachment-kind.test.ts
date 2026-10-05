import { describe, expect, it } from "vitest";
import { ATTACHMENT_KINDS, attachmentKind } from "./attachment-kind";

/**
 * Standalone-list attachment kind resolution.
 *
 * The regression this pins was measured against the live server, not guessed:
 * every `.html` upload is typed by Go's `http.DetectContentType`, which appends
 * a charset parameter. Five real uploads came back `text/html; charset=utf-8`
 * and one `.md`/`.txt` came back `text/plain; charset=utf-8`, while a `.png`
 * came back a bare `image/png`. The old dispatcher compared
 * `content_type === "text/html"` verbatim, so it never matched a real HTML
 * attachment and the inline HTML renderer — plus every action on it — was
 * unreachable.
 *
 * So the charset case is the load-bearing one, and it must not be "fixed" by
 * special-casing one string: web normalizes parameters off and also falls back
 * to the extension (`getPreviewKind`, packages/views/editor/utils/preview.ts:172),
 * and these cases pin that same behaviour.
 */
describe("attachmentKind", () => {
  it("classifies a charset-suffixed HTML type as html", () => {
    // The exact value the live server returns for a .html upload.
    expect(attachmentKind("text/html; charset=utf-8", "page.html")).toBe("html");
  });

  it("classifies a bare HTML type as html", () => {
    expect(attachmentKind("text/html", "page.html")).toBe("html");
  });

  it("ignores case and surrounding whitespace in the content type", () => {
    expect(attachmentKind("  TEXT/HTML ; charset=UTF-8 ", "page.html")).toBe("html");
  });

  it("falls back to the extension when the server types the file generically", () => {
    // A .htm/.html file whose bytes the sniffer did not recognize as HTML.
    expect(attachmentKind("application/octet-stream", "page.htm")).toBe("html");
    expect(attachmentKind("text/plain; charset=utf-8", "fragment.html")).toBe("html");
  });

  it("reads the extension through a path and a query string", () => {
    expect(attachmentKind("", "dir/sub/page.html")).toBe("html");
    expect(attachmentKind("", "page.html?v=2")).toBe("html");
  });

  it("keeps images on the image branch, including charset-suffixed ones", () => {
    expect(attachmentKind("image/png", "shot.png")).toBe("image");
    expect(attachmentKind("image/png; charset=binary", "shot.png")).toBe("image");
    // An extension-only image (server said octet-stream) is still an image —
    // the lightbox sequence builder decides this the same way.
    expect(attachmentKind("application/octet-stream", "shot.WEBP")).toBe("image");
  });

  it("classifies svg as an image, never as html", () => {
    // svg is XML and text-like; the image branch must win, or the lightbox
    // sequence and the card would disagree about the same file.
    expect(attachmentKind("image/svg+xml; charset=utf-8", "diagram.svg")).toBe("image");
  });

  it("classifies every other type as a plain file", () => {
    expect(attachmentKind("application/pdf", "doc.pdf")).toBe("file");
    expect(attachmentKind("text/plain; charset=utf-8", "notes.txt")).toBe("file");
    expect(attachmentKind("", "archive.tar.gz")).toBe("file");
    expect(attachmentKind("", "no-extension")).toBe("file");
  });

  it("never returns a kind outside the declared set", () => {
    const probes: [string, string][] = [
      ["text/html; charset=utf-8", "a.html"],
      ["image/png", "a.png"],
      ["application/pdf", "a.pdf"],
      ["", ""],
    ];
    for (const [ct, filename] of probes) {
      expect(ATTACHMENT_KINDS).toContain(attachmentKind(ct, filename));
    }
  });
});
