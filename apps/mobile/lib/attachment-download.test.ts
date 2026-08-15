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