import { describe, expect, it } from "vitest";
import type { Attachment } from "@multica/core/types";
import {
  collectDeliverableFiles,
  type DeliverableSourceComment,
} from "@multica/core/attachments/deliverables";
import {
  DELIVERABLE_CATEGORIES,
  deliverableCategory,
  deliverableCategoryCounts,
  deliverableIconName,
  deliverableTypeLabel,
  groupDeliverablesByComment,
  selectRecentDeliverables,
} from "./deliverables";

function attachment(over: Partial<Attachment> & { id: string }): Attachment {
  return {
    workspace_id: "ws",
    issue_id: "issue",
    comment_id: "c1",
    chat_session_id: null,
    chat_message_id: null,
    uploader_type: "agent",
    uploader_id: "agent-1",
    filename: "report.md",
    url: `https://cdn.example.com/${over.id}`,
    download_url: `/api/attachments/${over.id}/download`,
    markdown_url: `https://api.example.com/api/attachments/${over.id}/download`,
    content_type: "text/markdown",
    size_bytes: 6 * 1024,
    created_at: "2026-09-20T10:00:00Z",
    ...over,
  } as Attachment;
}

/** One posting comment: its id, its upload time, and what it uploaded. */
interface Comment {
  id: string;
  created_at: string;
  attachments: Attachment[];
}

function comment(
  id: string,
  createdAt: string,
  attachments: Attachment[],
): Comment {
  // The server binds each upload to the comment that posted it, and the
  // overview groups on `latest.comment_id` — so the fixture stamps it here
  // rather than leaving every attachment pointing at the `c1` default above.
  return {
    id,
    created_at: createdAt,
    attachments: attachments.map((a) => ({ ...a, comment_id: id })),
  };
}

/** The timeline shape `collectDeliverableFiles` consumes (no `created_at`). */
function source(comments: Comment[]): DeliverableSourceComment[] {
  return comments.map(({ id, attachments }) => ({
    id,
    type: "comment",
    attachments,
  }));
}

function filesFrom(comments: Comment[]) {
  return collectDeliverableFiles(source(comments));
}

/** The poster-of lookup the overview uses — a comment id to its timestamp. */
function posterTimes(comments: Comment[]) {
  const times = new Map(comments.map((c) => [c.id, c.created_at]));
  return (commentId: string) => times.get(commentId);
}

describe("deliverableCategory", () => {
  it("puts images, video and documents in their own buckets", () => {
    expect(deliverableCategory("image/png", "settings.png")).toBe("image");
    expect(deliverableCategory("video/mp4", "clip.mp4")).toBe("video");
    expect(deliverableCategory("application/pdf", "report.pdf")).toBe("document");
    expect(deliverableCategory("text/plain; charset=utf-8", "notes.md")).toBe(
      "document",
    );
  });

  it("keeps data and code out of the document bucket", () => {
    // Web's own reason (deliverable-kind.ts:15-17): nobody filters for
    // "documents" to find a migration script. A CSV is "other" even though the
    // viewer renders it as text — so this cannot be re-derived from "is it
    // text-like", which would sweep in csv/ts/json and inflate the chip.
    expect(deliverableCategory("text/csv", "latency.csv")).toBe("other");
    expect(deliverableCategory("application/json", "dump.json")).toBe("other");
    expect(deliverableCategory("text/plain; charset=utf-8", "policy.ts")).toBe(
      "other",
    );
    expect(deliverableCategory("application/zip", "bundle.zip")).toBe("other");
  });

  it("places every file in exactly one of the four declared buckets", () => {
    // The chips partition the list: a file that landed in no bucket would be
    // reachable only under "All", and one in two would be double-counted.
    const samples: [string, string][] = [
      ["image/svg+xml", "diagram.svg"],
      ["audio/mpeg", "voice.mp3"],
      ["text/html; charset=utf-8", "page.html"],
      ["application/octet-stream", "artifact"],
      ["", "no-extension"],
      ["application/vnd.ms-excel", "sheet.xlsx"],
    ];
    for (const [ct, name] of samples) {
      expect(DELIVERABLE_CATEGORIES).toContain(deliverableCategory(ct, name));
    }
  });
});

describe("deliverableCategoryCounts", () => {
  const poster = comment("c1", "2026-09-20T10:00:00Z", []);
  const files = filesFrom([
    comment("c1", "2026-09-20T10:00:00Z", [
      attachment({ id: "png", filename: "a.png", content_type: "image/png" }),
      attachment({ id: "pdf", filename: "r.pdf", content_type: "application/pdf" }),
    ]),
    comment("c2", "2026-09-21T10:00:00Z", [
      attachment({ id: "mp4", filename: "v.mp4", content_type: "video/mp4" }),
      attachment({ id: "csv", filename: "l.csv", content_type: "text/csv" }),
    ]),
  ]);
  void poster;

  it("counts each bucket and sums to the file count", () => {
    const counts = deliverableCategoryCounts(files);
    expect(counts).toEqual({ image: 1, document: 1, video: 1, other: 1 });
    const sum = DELIVERABLE_CATEGORIES.reduce((n, c) => n + counts[c], 0);
    expect(sum).toBe(files.length);
  });

  it("returns zeroes, not missing buckets, for an empty list", () => {
    expect(deliverableCategoryCounts([])).toEqual({
      image: 0,
      document: 0,
      video: 0,
      other: 0,
    });
  });
});

describe("selectRecentDeliverables", () => {
  const shot = (n: number) =>
    attachment({
      id: `shot-${n}`,
      filename: `shot-${n}.png`,
      content_type: "image/png",
      created_at: `2026-09-2${n}T10:00:00Z`,
    });
  const doc = (n: number) =>
    attachment({
      id: `doc-${n}`,
      filename: `report-${n}.md`,
      created_at: `2026-09-2${n}T11:00:00Z`,
    });

  it("caps images at three and files at four, newest first", () => {
    // The sidebar is a summary, not the list: web's RECENT_IMAGES (=3) /
    // RECENT_FILES (=4) in deliverables-section.tsx:16-17. The count badge
    // still reports the total, so these caps must not be read as the count.
    const files = filesFrom([
      comment("c1", "2026-09-20T10:00:00Z", [
        shot(1),
        shot(2),
        shot(3),
        shot(4),
        shot(5),
      ]),
      comment("c2", "2026-09-21T10:00:00Z", [
        doc(1),
        doc(2),
        doc(3),
        doc(4),
        doc(5),
        doc(6),
      ]),
    ]);
    const { images, others } = selectRecentDeliverables(files);
    expect(images.map((f) => f.latest.id)).toEqual(["shot-5", "shot-4", "shot-3"]);
    expect(others.map((f) => f.latest.id)).toEqual([
      "doc-6",
      "doc-5",
      "doc-4",
      "doc-3",
    ]);
  });

  it("does not spill an image past the image cap into the file rows", () => {
    // Web's loop is `if (isImage && …) else if (!isImage && …)`, so a fourth
    // image is dropped rather than rendered as a file row. Reading the two caps
    // as two independent filters would put it in `others`, and the sidebar
    // would show an image in the file list, which web never does.
    const files = filesFrom([
      comment("c1", "2026-09-20T10:00:00Z", [shot(1), shot(2), shot(3), shot(4)]),
    ]);
    const { images, others } = selectRecentDeliverables(files);
    expect(images).toHaveLength(3);
    expect(others).toEqual([]);
  });

  it("handles a list shorter than the caps, and an empty one", () => {
    const files = filesFrom([
      comment("c1", "2026-09-20T10:00:00Z", [shot(1), doc(1)]),
    ]);
    expect(selectRecentDeliverables(files).images.map((f) => f.latest.id)).toEqual([
      "shot-1",
    ]);
    expect(selectRecentDeliverables(files).others.map((f) => f.latest.id)).toEqual([
      "doc-1",
    ]);
    expect(selectRecentDeliverables([])).toEqual({ images: [], others: [] });
  });
});

describe("groupDeliverablesByComment", () => {
  const shot = attachment({
    id: "shot",
    filename: "settings.png",
    content_type: "image/png",
    created_at: "2026-09-20T10:00:00Z",
  });
  const reportV1 = attachment({ id: "r1", created_at: "2026-09-20T10:00:01Z" });
  const reportV2 = attachment({ id: "r2", created_at: "2026-09-21T09:00:00Z" });
  const csv = attachment({
    id: "csv",
    filename: "latency.csv",
    content_type: "text/csv",
    created_at: "2026-09-21T09:00:01Z",
  });

  // The same fixture web's deliverables.test.tsx uses: four uploads, three
  // deliverables, two posting comments.
  const comments = [
    comment("c-1", "2026-09-20T10:00:00Z", [shot, reportV1]),
    comment("c-2", "2026-09-21T09:00:00Z", [reportV2, csv]),
  ];
  const files = filesFrom(comments);
  const posterOf = posterTimes(comments);

  it("groups by the posting comment, in page order", () => {
    const groups = groupDeliverablesByComment(files, "all", posterOf);
    expect(groups.map((g) => g.commentId)).toEqual(["c-1", "c-2"]);
    // The report became a deliverable of c-2 (its v2 was posted there), so the
    // two groups hold [shot] and [report, csv] — the run that re-uploaded it
    // owns it, and no group repeats it.
    expect(groups[0]!.files.map((f) => f.latest.id)).toEqual(["shot"]);
    expect(groups[1]!.files.map((f) => f.latest.id)).toEqual(["r2", "csv"]);
  });

  it("drops the files a category filter excludes, and empty groups with them", () => {
    const groups = groupDeliverablesByComment(files, "image", posterOf);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.commentId).toBe("c-1");
    expect(groups[0]!.files.map((f) => f.latest.id)).toEqual(["shot"]);
  });

  it("returns no groups for a filter nothing matches", () => {
    expect(groupDeliverablesByComment(files, "video", posterOf)).toEqual([]);
  });

  it("falls back to the group's OLDEST upload when the comment is unknown", () => {
    // Web's `startedAt` fallback (deliverables-overview.tsx:189-190): the group
    // is dated by when its FIRST file was uploaded, not its last. A timeline
    // entry the client has not loaded therefore still has the right date, and
    // the group stays where it belongs instead of jumping to the end.
    //
    // The fixture has to be built so the two readings disagree: GROUP A's first
    // upload is older than GROUP B's, but its LAST upload is newer than B's
    // first. Reading `files[0]` (newest-first) instead of `files[length-1]`
    // would order B before A and fail here.
    const earlyDoc = attachment({
      id: "early",
      filename: "early.md",
      created_at: "2026-09-20T08:00:00Z",
    });
    const lateDoc = attachment({
      id: "late",
      filename: "late.md",
      created_at: "2026-09-20T23:00:00Z",
    });
    const otherDoc = attachment({
      id: "other",
      filename: "other.md",
      created_at: "2026-09-20T12:00:00Z",
    });
    const spaced = filesFrom([
      comment("c-a", "2026-09-20T08:00:00Z", [earlyDoc, lateDoc]),
      comment("c-b", "2026-09-20T12:00:00Z", [otherDoc]),
    ]);

    // Sanity-check the fixture against the helper: `files` is newest first, so
    // group c-a's array must END with its oldest upload.
    const groups = groupDeliverablesByComment(spaced, "all", () => undefined);
    expect(groups.map((g) => g.commentId)).toEqual(["c-a", "c-b"]);
  });
});

describe("deliverableTypeLabel", () => {
  it("uppercases the extension, and is empty when there is none", () => {
    expect(deliverableTypeLabel("report.md")).toBe("MD");
    expect(deliverableTypeLabel("dir/sub/archive.tar.gz")).toBe("GZ");
    expect(deliverableTypeLabel("notes")).toBe("");
    expect(deliverableTypeLabel(".gitignore")).toBe("");
  });
});

describe("deliverableIconName", () => {
  it("gives every kind a glyph through the shared attachment dispatcher", () => {
    // Reuses `attachmentKind` rather than re-deriving the kind from the content
    // type here, so "what is this file" has one answer across the app. Audio and
    // video must not collapse onto the generic document glyph: a row shows no
    // thumbnail for them, so the glyph is the only thing naming the kind.
    expect(deliverableIconName("image/png", "a.png")).toBe("image-outline");
    expect(deliverableIconName("video/mp4", "v.mp4")).toBe("videocam-outline");
    expect(deliverableIconName("audio/mpeg", "a.mp3")).toBe(
      "musical-notes-outline",
    );
    expect(deliverableIconName("application/pdf", "r.pdf")).toBe(
      "document-text-outline",
    );
    expect(deliverableIconName("application/zip", "b.zip")).toBe(
      "document-outline",
    );
  });
});
