/**
 * Pure-function tests for the lightbox image mapping.
 *
 * The defect this suite exists for: `image` was the one attachment kind a user
 * could see full-screen and never save. The old sequence held bare URI strings,
 * so the viewer's header had no filename and no URL to fetch — and the parity
 * ratchet accepted `useLightbox` as the image kind's "exit", which asserts the
 * viewer opens, not that the file can leave the app.
 *
 * The resolver is injected so this stays in the Node lane; `@/data/server-config`
 * pulls in expo-secure-store, which the RN-less runner cannot load.
 */
import { describe, expect, it } from "vitest";
import type { ImageSequenceItem } from "@multica/core/attachments/image-sequence";
import type { Attachment } from "@multica/core/types";
import {
  downloadSourceForAttachment,
  imageHeaderTitle,
  indexOfImageByUri,
  toLightboxImages,
} from "./lightbox-image";

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att-1",
    workspace_id: "ws-1",
    issue_id: null,
    comment_id: null,
    chat_session_id: null,
    chat_message_id: null,
    uploader_type: "member",
    uploader_id: "u-1",
    filename: "shot.png",
    url: "https://cdn.example.test/shot.png",
    download_url: "/api/attachments/att-1/download",
    ...overrides,
  } as Attachment;
}

/** Mirrors the resolver the provider injects: server-relative → absolute. */
const resolve = (url: string) =>
  url.startsWith("/") ? `https://api.example.test${url}` : url;

describe("toLightboxImages", () => {
  it("carries the filename the viewer header needs", () => {
    const items: ImageSequenceItem[] = [
      { key: "att-1", url: "/api/attachments/att-1/download", filename: "shot.png", attachment: attachment() },
    ];
    expect(toLightboxImages(items, resolve)[0]!.filename).toBe("shot.png");
  });

  it("resolves the URI the same way the sequence used to, so taps still match", () => {
    // The URI is the viewer's identity key. If this pass changed, a tap would
    // stop finding its position and silently fall back to a single image.
    const items: ImageSequenceItem[] = [
      { key: "att-1", url: "/api/attachments/att-1/download", filename: "shot.png", attachment: attachment() },
    ];
    expect(toLightboxImages(items, resolve)[0]!.uri).toBe(
      "https://api.example.test/api/attachments/att-1/download",
    );
  });

  it("marks an image backed by an attachment record as downloadable", () => {
    const items: ImageSequenceItem[] = [
      { key: "att-1", url: "https://cdn.example.test/shot.png", filename: "shot.png", attachment: attachment() },
    ];
    expect(toLightboxImages(items, resolve)[0]!.canDownload).toBe(true);
  });

  it("refuses to offer a download for an image with no attachment record", () => {
    // An inline `![](https://third-party.test/x.png)` resolves to no record.
    // Downloading it would attach the session Bearer token to a foreign
    // origin — the leak `isAttachmentDownloadUrl`'s host gate exists to stop.
    const items: ImageSequenceItem[] = [
      { key: "https://third-party.test/x.png", url: "https://third-party.test/x.png", filename: "" },
    ];
    const image = toLightboxImages(items, resolve)[0]!;
    expect(image.canDownload).toBe(false);
  });

  it("carries the record's MIME hint for the share sheet", () => {
    const items: ImageSequenceItem[] = [
      {
        key: "att-1",
        url: "/api/attachments/att-1/download",
        filename: "shot.png",
        attachment: attachment({ content_type: "image/png" }),
      },
    ];
    expect(toLightboxImages(items, resolve)[0]!.mimeType).toBe("image/png");
  });

  it("attributes the entry to its own surface, not the mounting screen", () => {
    // The provider is app-level and never learns which screen mounted it, so
    // the source has to come off the record's parent pointers.
    const items: ImageSequenceItem[] = [
      {
        key: "att-1",
        url: "/api/attachments/att-1/download",
        filename: "shot.png",
        attachment: attachment({ issue_id: "i-1" }),
      },
    ];
    expect(toLightboxImages(items, resolve)[0]!.source).toEqual({ kind: "issue" });
  });

  it("leaves a reference with no filename as an empty title input", () => {
    const items: ImageSequenceItem[] = [
      { key: "u", url: "https://third-party.test/x.png", filename: "" },
    ];
    expect(toLightboxImages(items, resolve)[0]!.filename).toBe("");
  });

  it("attributes each image to the surface its record belongs to", () => {
    // The provider is app-level; the screen that mounted it is not in scope.
    // The record's parent pointers are, and they are what the downloads list's
    // source column reports.
    const items: ImageSequenceItem[] = [
      { key: "i", url: "/i.png", filename: "i.png", attachment: attachment({ issue_id: "i-1" }) },
      { key: "c", url: "/c.png", filename: "c.png", attachment: attachment({ chat_session_id: "s-1" }) },
      { key: "x", url: "https://third-party.test/x.png", filename: "" },
    ];
    const images = toLightboxImages(items, resolve);
    expect(images[0]!.source).toEqual({ kind: "issue" });
    expect(images[1]!.source).toEqual({ kind: "chat" });
    expect(images[2]!.source).toEqual({ kind: "other" });
  });
});

describe("indexOfImageByUri", () => {
  const images = toLightboxImages(
    [
      { key: "a", url: "/a.png", filename: "a.png", attachment: attachment({ id: "a" }) },
      { key: "b", url: "/b.png", filename: "b.png", attachment: attachment({ id: "b" }) },
    ],
    resolve,
  );

  it("finds the tapped image at its real position", () => {
    expect(indexOfImageByUri(images, "https://api.example.test/b.png")).toBe(1);
  });

  it("reports -1 for a URI outside the sequence, so the caller can go single", () => {
    // Web's `openAt` returns false in this case (image-sequence-context.tsx:64);
    // -1 is the mobile spelling of the same contract.
    expect(indexOfImageByUri(images, "https://third-party.test/x.png")).toBe(-1);
  });

  it("reports -1 for an empty URI rather than matching position 0", () => {
    expect(indexOfImageByUri(images, "")).toBe(-1);
  });
});

describe("imageHeaderTitle", () => {
  it("prefers the filename", () => {
    expect(imageHeaderTitle({ uri: "u", filename: "shot.png", canDownload: true, source: { kind: "other" } }, "Image")).toBe(
      "shot.png",
    );
  });

  it("falls back for a reference with no name", () => {
    // An inline external image carries no filename; the header still needs a
    // title rather than an empty row.
    expect(imageHeaderTitle({ uri: "u", filename: "", canDownload: false, source: { kind: "other" } }, "Image")).toBe("Image");
  });

  it("falls back when there is no image at all", () => {
    expect(imageHeaderTitle(undefined, "Image")).toBe("Image");
  });
});

describe("downloadSourceForAttachment", () => {
  it("attributes an issue attachment to the issue source", () => {
    expect(downloadSourceForAttachment(attachment({ issue_id: "i-1" }))).toEqual({ kind: "issue" });
  });

  it("attributes a chat attachment to the chat source", () => {
    expect(
      downloadSourceForAttachment(attachment({ chat_session_id: "s-1" })),
    ).toEqual({ kind: "chat" });
    expect(
      downloadSourceForAttachment(attachment({ chat_message_id: "m-1" })),
    ).toEqual({ kind: "chat" });
  });

  it("falls back to other for a parentless record", () => {
    expect(downloadSourceForAttachment(attachment())).toEqual({ kind: "other" });
  });

  it("falls back to other when there is no record", () => {
    expect(downloadSourceForAttachment(undefined)).toEqual({ kind: "other" });
  });
});
