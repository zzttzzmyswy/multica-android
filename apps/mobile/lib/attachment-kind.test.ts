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

  it("classifies the newly covered kinds as their own renderer", () => {
    // Each of these used to fall through to the plain file card. They now have
    // a first-class branch, so the assertion names the new contract instead of
    // the old fallthrough.
    expect(attachmentKind("application/pdf", "doc.pdf")).toBe("pdf");
    expect(attachmentKind("", "movie.mp4")).toBe("video");
    expect(attachmentKind("application/octet-stream", "clip.MOV")).toBe("video");
    expect(attachmentKind("", "voice.m4a")).toBe("audio");
    expect(attachmentKind("audio/mpeg", "song.mp3")).toBe("audio");
  });

  it("classifies markdown ahead of plain text", () => {
    // The server sniffs a real .md upload as `text/plain; charset=utf-8`, so
    // the content type alone cannot separate markdown from text — the
    // extension has to win, and the markdown branch has to come first.
    expect(attachmentKind("text/plain; charset=utf-8", "README.md")).toBe("markdown");
    expect(attachmentKind("text/markdown", "notes.txt")).toBe("markdown");
  });

  it("classifies a previewable source file as text", () => {
    expect(attachmentKind("text/plain; charset=utf-8", "notes.txt")).toBe("text");
    expect(attachmentKind("text/plain; charset=utf-8", "script.py")).toBe("text");
    expect(attachmentKind("application/json", "data.json")).toBe("text");
    expect(attachmentKind("", "config.yaml")).toBe("text");
  });

  it("classifies a binary the text proxy would reject as a plain file", () => {
    expect(attachmentKind("", "archive.tar.gz")).toBe("file");
    expect(attachmentKind("", "no-extension")).toBe("file");
    expect(attachmentKind("application/zip", "bundle.zip")).toBe("file");
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

describe("the live smoke fixtures resolve to the intended renderer", () => {
  it("dispatches each real upload by content_type + extension", () => {
    // These four are the attachments the v0.6.31 device smoke test uses, with
    // the exact `content_type` the live server stored for each (captured from
    // mu.zztweb.top — see the iteration's seed script). `sample.md` coming back
    // as `text/plain; charset=utf-8` is the case that proves the extension
    // fallback is load-bearing: the content type alone cannot distinguish it
    // from `notes.txt`.
    const live: [string, string, string][] = [
      ["text/plain; charset=utf-8", "sample.md", "markdown"],
      ["text/plain; charset=utf-8", "notes.txt", "text"],
      ["application/pdf", "report.pdf", "pdf"],
      ["image/png", "shot.png", "image"],
    ];
    for (const [ct, filename, expected] of live) {
      expect(attachmentKind(ct, filename), `${filename} (${ct})`).toBe(expected);
    }
  });
});
