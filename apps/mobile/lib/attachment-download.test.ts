/**
 * Pure-function tests for the mobile attachment-download helpers.
 *
 * The suite targets the parts of `attachment-download.ts` that must be
 * deterministic and easy to reason about without an RN/native runtime:
 *
 *   - `sanitizeBasename`  → the on-disk name we pass to File.downloadFileAsync
 *   - `mimeTypeForFilename`→ the Android share-intent MIME hint
 *
 * `downloadAttachmentAndOpen` itself is a thin orchestration over ApiClient +
 * expo-file-system + expo-sharing; it is deliberately NOT imported here so
 * this Node lane stays free of native-module loading. Its wiring is covered
 * by tsc (typecheck) and the real-device verification step.
 */
import { describe, expect, it } from "vitest";

import {
  sanitizeBasename,
  mimeTypeForFilename,
  isAttachmentDownloadUrl,
  filenameFromDownloadUrl,
  rebaseDownloadUrl,
} from "./attachment-download";

describe("sanitizeBasename", () => {
  it("keeps a plain filename as-is", () => {
    expect(sanitizeBasename("report.pdf")).toBe("report.pdf");
  });

  it("strips path separators so a server value can never write outside cache", () => {
    // The security invariant is structural: no `/` or `\` may survive, so a
    // hostile filename can never traverse out of the (cache) destination.
    for (const hostile of [
      "../../etc/passwd",
      "dir/file.txt",
      "C:\\temp\\a.md",
      "/etc/shadow",
    ]) {
      expect(sanitizeBasename(hostile)).not.toContain("/");
      expect(sanitizeBasename(hostile)).not.toContain("\\");
    }
  });

  it("removes null bytes and control characters", () => {
    expect(sanitizeBasename("a\u0000b.txt")).toBe("ab.txt");
    expect(sanitizeBasename("line\u000Abreak.txt")).toBe("linebreak.txt");
  });

  it("trims trailing dots and spaces that would confuse Android filenames", () => {
    expect(sanitizeBasename("notes..")).toBe("notes");
    expect(sanitizeBasename("notes  ")).toBe("notes");
  });

  it("collapses when the input is empty or only separators", () => {
    expect(sanitizeBasename("")).toBe("");
    expect(sanitizeBasename("/")).toBe("");
    expect(sanitizeBasename("...")).toBe("");
  });

  it("preserves a leading dot for dotfiles but never the bare '..'", () => {
    expect(sanitizeBasename(".env")).toBe(".env");
  });
});

describe("mimeTypeForFilename", () => {
  it("maps well-known text extensions", () => {
    expect(mimeTypeForFilename("notes.txt", "application/octet-stream")).toBe(
      "text/plain",
    );
  });

  it("maps PDF and archive extensions", () => {
    expect(mimeTypeForFilename("guide.pdf", "x")).toBe("application/pdf");
    expect(mimeTypeForFilename("bundle.zip", "x")).toBe("application/zip");
    expect(mimeTypeForFilename("tarball.tar.gz", "x")).toBe(
      "application/gzip",
    );
    expect(mimeTypeForFilename("archive.7z", "x")).toBe("application/x-7z-compressed");
  });

  it("maps office-format extensions", () => {
    expect(mimeTypeForFilename("doc.docx", "x")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeTypeForFilename("sheet.xlsx", "x")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(mimeTypeForFilename("slides.ppt", "x")).toBe(
      "application/vnd.ms-powerpoint",
    );
  });

  it("falls back for an unknown extension", () => {
    expect(mimeTypeForFilename("blob.zzz", "application/octet-stream")).toBe(
      "application/octet-stream",
    );
  });

  it("is case-insensitive on the extension", () => {
    expect(mimeTypeForFilename("photo.PNG", "x")).toBe("image/png");
  });

  it("falls back when no extension exists", () => {
    expect(mimeTypeForFilename("README", "text/plain")).toBe("text/plain");
  });
});
describe("isAttachmentDownloadUrl", () => {
  const API = "https://api.example.test";
  const WEB = "https://example.test";
  const UUID = "9c2d1f60-6a4e-4f8a-9b21-3d4e5f6a7b8c";

  it("recognizes the stable relative attachment-download path", () => {
    expect(isAttachmentDownloadUrl(`/api/attachments/${UUID}/download`, API)).toBe(true);
  });

  it("recognizes the relative path even with query/fragment", () => {
    expect(
      isAttachmentDownloadUrl(`/api/attachments/${UUID}/download?dl=1`, API),
    ).toBe(true);
    expect(
      isAttachmentDownloadUrl(`/api/attachments/${UUID}/download#frag`, API),
    ).toBe(true);
  });

  it("recognizes a relative uploads file URL", () => {
    expect(isAttachmentDownloadUrl("/uploads/reports/q3.pdf", API)).toBe(true);
    expect(isAttachmentDownloadUrl("/uploads/photo%20shot.png", API)).toBe(true);
  });

  it("does not treat a bare uploads directory or other relative paths as downloads", () => {
    expect(isAttachmentDownloadUrl("/uploads/", API)).toBe(false);
    expect(isAttachmentDownloadUrl("/issue/123", API)).toBe(false);
    expect(isAttachmentDownloadUrl("/project/abc", API)).toBe(false);
    expect(isAttachmentDownloadUrl("/", API)).toBe(false);
  });

  it("rejects a malformed attachment UUID", () => {
    expect(isAttachmentDownloadUrl("/api/attachments/not-a-uuid/download", API)).toBe(false);
  });

  it("recognizes an absolute URL on the API host", () => {
    expect(
      isAttachmentDownloadUrl(`https://api.example.test/api/attachments/${UUID}/download`, API),
    ).toBe(true);
  });

  it("recognizes an absolute URL on the public web host even when it differs from the API host", () => {
    // markdown_url embeds MULTICA_PUBLIC_URL (the web host), which may be a
    // different subdomain than the API base — the whole reason host checks
    // must consult both bases.
    expect(
      isAttachmentDownloadUrl(`https://example.test/api/attachments/${UUID}/download`, API, WEB),
    ).toBe(true);
  });

  it("never treats an absolute URL on a foreign host as an in-app download (token safety)", () => {
    // Intercepting a foreign attachment-shaped URL would send the Bearer
    // token to a third party — the host gate is load-bearing.
    expect(
      isAttachmentDownloadUrl(`https://evil.test/api/attachments/${UUID}/download`, API, WEB),
    ).toBe(false);
    expect(
      isAttachmentDownloadUrl("https://evil.test/uploads/x.pdf", API, WEB),
    ).toBe(false);
  });

  it("leaves presigned CDN URLs to the browser", () => {
    expect(
      isAttachmentDownloadUrl(
        "https://cdn.example.test/att-1.bin?Policy=p&Signature=s&Key-Pair-Id=k",
        API,
        WEB,
      ),
    ).toBe(false);
  });

  it("rejects non-http schemes and empty input", () => {
    expect(isAttachmentDownloadUrl("", API)).toBe(false);
    expect(isAttachmentDownloadUrl("mailto:a@b.c", API)).toBe(false);
    expect(isAttachmentDownloadUrl("tel:123", API)).toBe(false);
    expect(isAttachmentDownloadUrl("javascript:alert(1)", API)).toBe(false);
    expect(isAttachmentDownloadUrl("mention://issue/abc", API)).toBe(false);
  });
});

describe("filenameFromDownloadUrl", () => {
  const FALLBACK = "download";

  it("takes the last path segment as the filename", () => {
    expect(filenameFromDownloadUrl("/uploads/reports/q3.pdf", FALLBACK)).toBe("q3.pdf");
    expect(filenameFromDownloadUrl("/uploads/tar.gz?x=1", FALLBACK)).toBe("tar.gz");
  });

  it("percent-decodes the segment", () => {
    expect(filenameFromDownloadUrl("/uploads/a%20b.txt", FALLBACK)).toBe("a b.txt");
  });

  it("folds the generic attachment endpoint to the fallback (no name in path)", () => {
    expect(
      filenameFromDownloadUrl("/api/attachments/9c2d1f60-6a4e-4f8a-9b21-3d4e5f6a7b8c/download", FALLBACK),
    ).toBe(FALLBACK);
  });

  it("handles empty / whitespace / trailing-slash inputs", () => {
    expect(filenameFromDownloadUrl("", FALLBACK)).toBe(FALLBACK);
    expect(filenameFromDownloadUrl("/uploads/", FALLBACK)).toBe(FALLBACK);
    expect(filenameFromDownloadUrl("https://example.test/uploads/", FALLBACK)).toBe(FALLBACK);
  });
});


describe("isAttachmentDownloadUrl — same-zone subdomain hosts", () => {
  const UUID = "9c2d1f60-6a4e-4f8a-9b21-3d4e5f6a7b8c";

  it("admits an absolute URL on a subdomain of the API base", () => {
    // Self-hosted deployment: the app's base is example.test while the
    // persisted markdown_url points at the sibling api.example.test ingress.
    expect(
      isAttachmentDownloadUrl(
        `https://api.example.test/api/attachments/${UUID}/download`,
        "https://example.test",
      ),
    ).toBe(true);
  });

  it("admits an absolute URL on a sibling subdomain of the web base", () => {
    expect(
      isAttachmentDownloadUrl(
        `https://files.example.test/uploads/report.pdf`,
        "https://api.example.test",
        "https://example.test",
      ),
    ).toBe(true);
  });

  it("never admits a host that only shares a prefix with the base", () => {
    expect(
      isAttachmentDownloadUrl(
        `https://notexample.test/api/attachments/${UUID}/download`,
        "https://example.test",
      ),
    ).toBe(false);
  });
});

describe("rebaseDownloadUrl", () => {
  const BASE = "https://example.test";

  it("rewrites an absolute URL onto the configured base, keeping path + query", () => {
    expect(
      rebaseDownloadUrl(
        "https://api.example.test/api/attachments/9c2d1f60-6a4e-4f8a-9b21-3d4e5f6a7b8c/download?dl=1",
        BASE,
      ),
    ).toBe(
      "https://example.test/api/attachments/9c2d1f60-6a4e-4f8a-9b21-3d4e5f6a7b8c/download?dl=1",
    );
  });

  it("trims a trailing slash on the base", () => {
    expect(
      rebaseDownloadUrl("https://api.example.test/uploads/a.txt", "https://example.test/"),
    ).toBe("https://example.test/uploads/a.txt");
  });

  it("passes server-relative URLs through unchanged", () => {
    expect(rebaseDownloadUrl("/api/attachments/x/download", BASE)).toBe(
      "/api/attachments/x/download",
    );
  });

  it("rejects non-http(s) and empty input", () => {
    expect(rebaseDownloadUrl("", BASE)).toBeNull();
    expect(rebaseDownloadUrl("mailto:a@b.c", BASE)).toBeNull();
    expect(rebaseDownloadUrl("https://example.test/path", "")).toBeNull();
  });
});
