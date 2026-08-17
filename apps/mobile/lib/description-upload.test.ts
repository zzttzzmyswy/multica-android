/**
 * Insertion helpers for the issue-description image / file upload buttons
 * (web content-editor parity). Pure string production — no state, no RN.
 *
 * Alignment targets from web:
 *   - The editor writes a single markdown link per uploaded file
 *     (`packages/views/editor/...`), resolved through
 *     `pickAttachmentMarkdownUrl` which prefers the server-provided durable
 *     `markdown_url` and falls back to `url` (core `pickMarkdownLink`).
 *   - Images insert `![](<url>)`, files insert `[<name>](<url>)`
 *     (the `use-file-attach` docstring's stated contract).
 */
import { describe, expect, it } from "vitest";
import {
  fileInsertMarkdown,
  imageInsertMarkdown,
  pickAttachmentMarkdownUrl,
  type UploadLinkInput,
} from "./description-upload";

describe("pickAttachmentMarkdownUrl", () => {
  it("prefers the server durable markdown_url when present", () => {
    const att: UploadLinkInput = {
      url: "/uploads/w/att-1.png",
      markdown_url: "https://mu.zztweb.top/api/attachments/att-1/download",
      filename: "a.png",
    };
    expect(pickAttachmentMarkdownUrl(att)).toBe(
      "https://mu.zztweb.top/api/attachments/att-1/download",
    );
  });

  it("falls back to url when markdown_url is absent", () => {
    const att: UploadLinkInput = {
      url: "/uploads/w/att-1.png",
      markdown_url: undefined,
      filename: "a.png",
    };
    expect(pickAttachmentMarkdownUrl(att)).toBe("/uploads/w/att-1.png");
  });

  it("falls back to url when markdown_url is an empty string", () => {
    const att: UploadLinkInput = {
      url: "/uploads/w/att-1.png",
      markdown_url: "",
      filename: "a.png",
    };
    expect(pickAttachmentMarkdownUrl(att)).toBe("/uploads/w/att-1.png");
  });

  it("uses markdown_url even when url is missing", () => {
    const att: UploadLinkInput = {
      url: "",
      markdown_url: "https://api.mu.zztweb.top/api/attachments/x/download",
      filename: "a.png",
    };
    expect(pickAttachmentMarkdownUrl(att)).toBe(
      "https://api.mu.zztweb.top/api/attachments/x/download",
    );
  });
});

describe("imageInsertMarkdown", () => {
  it("wraps the url in an empty-title image link", () => {
    expect(imageInsertMarkdown("https://x.test/a.png")).toBe(
      "![](https://x.test/a.png)",
    );
  });
});

describe("fileInsertMarkdown", () => {
  it("wraps name + url in an inline link", () => {
    expect(fileInsertMarkdown("report.pdf", "https://x.test/r.pdf")).toBe(
      "[report.pdf](https://x.test/r.pdf)",
    );
  });

  it("handles server-relative urls without mangling", () => {
    expect(fileInsertMarkdown("a.txt", "/uploads/w/a.txt")).toBe(
      "[a.txt](/uploads/w/a.txt)",
    );
  });
});