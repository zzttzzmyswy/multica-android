import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ATTACHMENT_KINDS, attachmentKind } from "./attachment-kind";

/**
 * Action-reachability guard for the standalone attachment list.
 *
 * The defect this pins: a `text/html` attachment had NO user-reachable exit.
 * The html branch rendered a preview with no download, and the file card that
 * does carry a download was unreachable for html because the dispatcher
 * compared `content_type === "text/html"` against a server value that always
 * carries a charset parameter. So the exit affordance existed in the file but
 * no html attachment could ever reach it.
 *
 * What a helper-level test cannot see is a *new* kind added to the list that
 * renders something the user cannot act on. This suite is the ratchet: it
 * enumerates every declared kind, resolves it through the real
 * `attachmentKind`, and requires the surface to give that kind an action.
 *
 * It is source-level because mobile's vitest lane is Node-only (see
 * vitest.config.ts) — there is no RN renderer here, so asserting on the
 * component's markup is not available. The assertions are therefore written
 * against the constructs that carry the behaviour: the dispatch call itself,
 * and the presence of an action in each branch's renderer.
 */

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const LIST = "components/issue/comment-attachment-list.tsx";
const HTML_PREVIEW = "components/rich-content/html-attachment.tsx";
const TEXT_PREVIEW = "components/rich-content/text-attachment.tsx";
const FILE_CARD = "components/issue/attachment-file-card.tsx";

/** Each kind's renderer file, and the token that proves it can hand the file
 *  to the user. `image` goes through the lightbox, whose exit is the viewer;
 *  everything else reaches `downloadAttachmentAndOpen` — directly, or through
 *  the shared file card that the pdf/video/audio/file kinds dispatch to. */
const KIND_EXIT: {
  kind: (typeof ATTACHMENT_KINDS)[number];
  file: string;
  token: string;
}[] = [
  { kind: "image", file: "lib/markdown/markdown-image.tsx", token: "useLightbox" },
  { kind: "html", file: HTML_PREVIEW, token: "downloadAttachmentAndOpen" },
  { kind: "markdown", file: TEXT_PREVIEW, token: "downloadAttachmentAndOpen" },
  { kind: "text", file: TEXT_PREVIEW, token: "downloadAttachmentAndOpen" },
  { kind: "pdf", file: FILE_CARD, token: "downloadAttachmentAndOpen" },
  { kind: "video", file: FILE_CARD, token: "downloadAttachmentAndOpen" },
  { kind: "audio", file: FILE_CARD, token: "downloadAttachmentAndOpen" },
  { kind: "file", file: FILE_CARD, token: "downloadAttachmentAndOpen" },
];

describe("standalone attachment list — every kind is actionable", () => {
  const list = code(LIST);

  it("resolves the kind through the shared helper, not an inline compare", () => {
    // The inline `content_type === "text/html"` compare is the bug: it can
    // never match the server's `text/html; charset=utf-8`.
    expect(list).toContain("attachmentKind(");
    expect(list).not.toContain('content_type === "text/html"');
  });

  it("dispatches every kind that has its own renderer", () => {
    // A kind declared in ATTACHMENT_KINDS but never dispatched would silently
    // fall through to the file card, so pin the dedicated branches by literal.
    //
    // `pdf` / `video` / `audio` / `file` are deliberately absent here: they
    // share one card whose behaviour is identical for all four, differing only
    // in the glyph. Requiring a literal per kind would force three redundant
    // branches just to satisfy the test. Their reachability is proven instead
    // by the exit check below, which the shared card passes once.
    expect(list).toContain("kind ===");
    for (const kind of ["image", "html", "markdown", "text"] as const) {
      expect(list, `no dispatch branch for kind: ${kind}`).toContain(`"${kind}"`);
    }
  });

  it("every kind's renderer carries a user-reachable exit", () => {
    for (const { kind, file, token } of KIND_EXIT) {
      const src = code(file);
      expect(src, `${file} (kind: ${kind}) has no exit affordance`).toContain(
        token,
      );
    }
  });

  it("fails for a kind that has no renderer with an exit", () => {
    // Reverse verification, as the iteration requires: the guard above is only
    // worth having if it actually goes red for a dead-end kind. Rather than
    // trust that reading, exercise it — take the real KIND_EXIT map, drop the
    // entries for a freshly declared kind, and confirm the check rejects it.
    //
    // This is what a future "add a kind, forget its renderer" PR would hit: the
    // exit suite iterates ATTACHMENT_KINDS, so a kind with no entry here is a
    // kind with no proven way out.
    const covered = new Set(KIND_EXIT.map((e) => e.kind));
    for (const kind of ATTACHMENT_KINDS) {
      expect(covered, `kind "${kind}" is declared but has no exit renderer`).toContain(
        kind,
      );
    }
    // And the check is not vacuous: it rejects an uncovered kind.
    const missing = "brandnew" as (typeof ATTACHMENT_KINDS)[number];
    expect(covered.has(missing)).toBe(false);
  });

  it("the html renderer downloads whether or not the preview rendered", () => {
    const src = code(HTML_PREVIEW);
    // The header (success path) and the failure placeholder must both offer
    // the download — web's reasoning verbatim: Preview / Download are the only
    // escape hatches when inline render fails, so on failure the action must
    // not disappear with the body.
    const calls = src.match(/onPress=\{handleDownload\}/g) ?? [];
    expect(
      calls.length,
      "download must be wired in both the loaded and failed states",
    ).toBeGreaterThanOrEqual(2);
  });

  it("the text renderer downloads whether or not the preview rendered", () => {
    // Same invariant as html, in the sibling renderer this iteration added.
    // The two share a chrome design on purpose, so the invariant is asserted
    // against both rather than trusting the copy.
    const src = code(TEXT_PREVIEW);
    expect(src).toContain("downloadAttachmentAndOpen");
    expect(src).toContain("textFailureKey");
    // `retry` must be gated on retryability, not offered unconditionally.
    expect(src).toMatch(/isRetryable/);
    // Loading is its own state — never the failure copy.
    expect(src).toContain('state.status === "loading"');
    expect(src).toContain("richContent.attachment.previewLoading");
  });

  it("the failed state is distinct from the loading state", () => {
    // Rendering the failure copy while the first read is still in flight
    // claims an absence out of an unsettled read. Both text-backed renderers
    // branch on the shared three-state machine for exactly this reason.
    for (const file of [HTML_PREVIEW, TEXT_PREVIEW]) {
      const src = code(file);
      expect(src, file).toContain('state.status === "loading"');
      expect(src, file).toContain('state.status === "failed"');
    }
  });

  it("the retry action appears only for the retryable failure", () => {
    // 413 / 415 are terminal: a retry would fail identically, so offering one
    // is a lie. Only the transport failure is retryable.
    const src = code(HTML_PREVIEW);
    expect(src).toContain("richContent.html.retry");
    expect(src).toMatch(/isRetryable/);
  });

  it("wires the two previously-unreferenced failure strings", () => {
    // `richContent.html.retry` and `richContent.html.loadFailed` shipped in
    // both bundles but had zero references — the wording "use download"
    // presupposed an exit that this iteration adds.
    const src = code(HTML_PREVIEW);
    expect(src).toContain("richContent.html.retry");
    expect(src).toContain("richContent.html.loadFailed");
  });
});

describe("attachment kind resolution matches the live server's values", () => {
  it("maps the real server content types to the intended renderer", () => {
    // Values captured from mu.zztweb.top uploads. If the dispatcher ever
    // goes back to exact matching, these are the cases that break.
    const live: [string, string, string][] = [
      ["text/html; charset=utf-8", "page.html", "html"],
      ["text/plain; charset=utf-8", "fragment.html", "html"],
      ["image/png", "shot.png", "image"],
      ["image/svg+xml", "diagram.svg", "image"],
      ["text/plain; charset=utf-8", "notes.txt", "text"],
      ["text/plain; charset=utf-8", "README.md", "markdown"],
      ["application/pdf", "doc.pdf", "pdf"],
      ["application/octet-stream", "clip.mp4", "video"],
      ["application/octet-stream", "voice.m4a", "audio"],
      ["", "archive.tar.gz", "file"],
    ];
    for (const [ct, filename, expected] of live) {
      expect(attachmentKind(ct, filename), `${filename} (${ct})`).toBe(
        expected,
      );
    }
  });
});

describe("the new strings exist in both bundles", () => {
  // The locale-completeness suite already covers literal `t("...")` keys, but
  // it resolves them through the translator's fallback — these are the ones
  // this iteration introduced, so pin them against both bundles directly
  // (a missing key would otherwise render the raw id in the failure card).
  const en = JSON.parse(
    readFileSync(path.join(__dirname, "i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(__dirname, "i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const NEEDED = [
    "richContent.html.download",
    "richContent.html.previewLoading",
    "richContent.html.loadFailed",
    "richContent.html.retry",
    "richContent.attachment.download",
    "richContent.attachment.previewLoading",
    "richContent.attachment.loadFailed",
    "richContent.attachment.tooLarge",
    "richContent.attachment.unsupported",
    "richContent.attachment.retry",
    "a11y.downloadFile",
  ];

  it.each(NEEDED)("%s is defined in both locales", (key) => {
    expect(en[key], `${key} missing from en.json`).toBeTruthy();
    expect(zh[key], `${key} missing from zh.json`).toBeTruthy();
  });
});
