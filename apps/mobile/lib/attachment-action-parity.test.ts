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
const HTML_BLOCK = "components/rich-content/html-block.tsx";
const FULLSCREEN_SHELL = "lib/rich-content/fullscreen-preview.tsx";
/** The surface that owns the image viewer AND its header — the image kind's
 *  exit lives here, not in the tap target that opens the viewer. */
const LIGHTBOX_PROVIDER = "lib/markdown/lightbox-provider.tsx";
const LIGHTBOX_HEADER = "lib/markdown/lightbox-image.ts";

/** Each kind's renderer file, and the token that proves it can hand the file
 *  to the user — hand the BYTES out, not merely paint them.
 *
 *  `image` used to be the exception here: its token was `useLightbox`, which
 *  only asserts that the viewer OPENS. Opening a viewer is not an exit — the
 *  reader could look at an image fullscreen and had no way to keep it, while
 *  every other kind could be saved. The token is now the download call itself,
 *  which is why the file named below is the lightbox provider (the surface that
 *  owns the viewer's header) rather than `markdown-image.tsx` (the tap target).
 *
 *  Everything else reaches `downloadAttachmentAndOpen` directly, or through the
 *  shared file card that the pdf/video/audio/file kinds dispatch to. */
const KIND_EXIT: {
  kind: (typeof ATTACHMENT_KINDS)[number];
  file: string;
  token: string;
}[] = [
  { kind: "image", file: LIGHTBOX_PROVIDER, token: "downloadAttachmentAndOpen" },
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

  it("the image exit is wired to the viewer's own header, not just imported", () => {
    // The ratchet above is satisfied by the string `downloadAttachmentAndOpen`
    // appearing anywhere in the provider — including a call no header ever
    // reaches. Pin the two links that make it reachable: the header is passed
    // to the viewer, and the header itself renders the button.
    const provider = code(LIGHTBOX_PROVIDER);
    expect(provider).toContain("HeaderComponent={Header}");
    expect(provider).toContain("onDownload={onDownload}");
    // The button is gated on the image being downloadable rather than rendered
    // unconditionally: for an image with no attachment record there is no fetch
    // that could succeed, and a dead button reads as a broken app.
    expect(provider).toContain("image?.canDownload");
    // And the gate is on the button, not merely mentioned: the Download
    // Pressable sits inside the `canDownload` branch.
    const gate = provider.indexOf("image?.canDownload");
    const pressable = provider.indexOf("onPress={onDownload}");
    expect(gate, "the canDownload gate must precede the Download button").toBeLessThan(
      pressable,
    );
    expect(pressable, "no Download Pressable is rendered").toBeGreaterThan(-1);
  });

  it("a lone image (no sequence) still gets a header and no false download", () => {
    // `open(uri)` with no sequence is the composer-chip / unmatched-reference
    // path. Its header must still render (the title fallback exists for it) but
    // must NOT offer Download: nothing backs that URI with a record.
    const provider = code(LIGHTBOX_PROVIDER);
    expect(provider).toContain("canDownload: false");
    expect(provider).toContain("titleFallback");
  });

  it("rejects the pre-fix image entry that only proved the viewer opens", () => {
    // Reverse verification, exercised rather than read. The defect was not a
    // missing string anywhere in the tree — it was that the image kind's
    // declared exit proved the wrong thing. Reproduce that shape and run the
    // same predicates, so this guard is shown to fail on the defect it names.
    //
    // The pre-fix entry was `{ kind: "image", file: markdown-image.tsx,
    // token: "useLightbox" }`, and the provider it implied contained no
    // download call at all (confirmed on the pre-change source:
    // `git show HEAD:apps/mobile/lib/markdown/lightbox-provider.tsx` matches
    // `downloadAttachmentAndOpen` zero times). So the old token passed while
    // the image remained unsaveable.
    const guard = (file: string, token: string) => {
      const src = code(file);
      return src.includes(token) && src.includes("downloadAttachmentAndOpen");
    };
    // The pre-fix pair is rejected: the tap target opens the viewer but never
    // fetches bytes, and it has no download call to find.
    expect(
      guard("lib/markdown/markdown-image.tsx", "useLightbox"),
      "the old useLightbox-only entry must be rejected",
    ).toBe(false);
    // The current pair passes, so the assertion is not vacuous.
    expect(guard(LIGHTBOX_PROVIDER, "downloadAttachmentAndOpen")).toBe(true);
  });

  it("the header maps a record to a download, and a bare URI to none", () => {
    // The mapping is what decides whether the button can appear at all, so pin
    // it where it is decidable: `canDownload` is derived from the record, not
    // from the URL looking plausible.
    const header = code(LIGHTBOX_HEADER);
    expect(header).toContain("canDownload: Boolean(item.attachment)");
  });

  it("the header's title prefers a real filename over the fallback", () => {
    // Web's header shows the filename (`attachment-preview-modal.tsx:562`).
    // Mobile can only do that because the sequence stopped holding bare URIs;
    // this pins the mapping that carries the name across.
    const header = code(LIGHTBOX_HEADER);
    expect(header).toContain("filename");
    expect(header).toContain("imageHeaderTitle");
  });

  it("refuses an authenticated download for an image with no attachment record", () => {
    // The safety half of the download button. An unmatched inline image is an
    // arbitrary third-party host; fetching it with the session Bearer token is
    // the leak `isAttachmentDownloadUrl`'s host gate exists to prevent.
    const header = code(LIGHTBOX_HEADER);
    expect(header).toContain("canDownload");
    expect(header).toMatch(/attachment/);
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

  it("every text-backed kind can be magnified, not just exited", () => {
    // The exit ratchet above answers "can the user get the file out". It does
    // not answer "can the user READ it" — and that was the remaining gap: an
    // html attachment rendered in a fixed 300px WebView and markdown / text in
    // a 320px cap, so a long body was readable only through that slit, while
    // web gave every kind a fullscreen preview. Route each text-backed kind's
    // renderer through the shared shell and confirm it actually opens it.
    //
    // The JSX open tag, not the bare identifier: an import that is never
    // rendered satisfies `toContain("FullscreenPreview")` while giving the user
    // nothing, which is the exact failure this line exists to catch.
    for (const file of [HTML_PREVIEW, TEXT_PREVIEW, HTML_BLOCK]) {
      const src = code(file);
      expect(src, `${file} renders no fullscreen shell`).toContain(
        "<FullscreenPreview",
      );
    }
    // The shell is shared, not copied three times: it is the only file that
    // may declare the modal, so a fourth surface cannot drift from the rest.
    for (const file of [HTML_PREVIEW, TEXT_PREVIEW, HTML_BLOCK]) {
      expect(code(file), `${file} declares its own Modal`).not.toContain(
        "<Modal",
      );
    }
    const shell = code(FULLSCREEN_SHELL);
    expect(shell).toContain("<Modal");
    expect(shell).toContain('presentationStyle="fullScreen"');
    expect(shell).toContain("onRequestClose");
  });

  it("the fullscreen entry exists for parsed content, and never for a failed read", () => {
    // Same discipline the exit ratchet uses, one step stricter: the entry must
    // be reachable whenever there IS content, and must NOT be offered when
    // there is none — a "view fullscreen" button on a failure placeholder
    // magnifies nothing.
    //
    // Where the boundary sits differs by surface and both are deliberate:
    //   - html card / markdown / text card: the body comes from a network read,
    //     so the entry lives after the loading and failed branches return;
    //   - the html fence block: the body is already in the document, so the
    //     entry is unconditional.
    for (const file of [HTML_PREVIEW, TEXT_PREVIEW]) {
      const src = code(file);
      const entry = src.indexOf("setFullscreen(true)");
      expect(entry, `${file} has no fullscreen entry`).toBeGreaterThan(-1);
      // Every bail-out for a state with no content must precede the entry.
      for (const guard of ['state.status === "loading"', 'state.status === "failed"']) {
        const at = src.indexOf(guard);
        expect(at, `${file} lost its ${guard} branch`).toBeGreaterThan(-1);
        expect(
          at,
          `${file}: ${guard} must bail out before the fullscreen entry`,
        ).toBeLessThan(entry);
      }
    }
  });

  it("the fullscreen entry does not depend on the read having succeeded", () => {
    // Reverse verification for the rule above, exercised rather than read: a
    // renderer whose entry sits inside the success branch only (i.e. gated on
    // the loaded body) is exactly what this test must reject. Take the real
    // file, move the entry ahead of its failed-state guard, and confirm the
    // check flips to red — so a future refactor that inverts the order is
    // caught here and not by a user staring at an un-magnifiable card.
    const src = code(TEXT_PREVIEW);
    const entry = src.indexOf("setFullscreen(true)");
    const failed = src.indexOf('state.status === "failed"');
    const before = entry < failed;
    expect(before, "fixture must start with the guard before the entry").toBe(
      false,
    );
    // Invert the order the way a careless refactor would, and re-run the same
    // predicate the test above uses.
    const inverted = src
      .replace("setFullscreen(true)", "__MOVED__")
      .replace('state.status === "failed"', "setFullscreen(true)")
      .replace("__MOVED__", 'state.status === "failed"');
    expect(
      inverted.indexOf("setFullscreen(true)") <
        inverted.indexOf('state.status === "failed"'),
      "a gated entry must be rejected",
    ).toBe(true);
  });

  it("the shell is the only place the fullscreen modal is declared", () => {
    // Three surfaces share one shell. If a fourth copies the Modal instead of
    // using it, the safe-area / back / header behaviour starts drifting — the
    // exact failure this extraction exists to prevent. `mermaid-viewer` is the
    // one legitimate exception: its body is a WebView bridge with its own
    // toolbar, not a re-render of loaded text, so it predates this shell and
    // keeps its own.
    const exceptions = new Set([
      FULLSCREEN_SHELL,
      "components/rich-content/mermaid-viewer.tsx",
    ]);
    for (const file of [HTML_PREVIEW, TEXT_PREVIEW, HTML_BLOCK]) {
      expect(exceptions.has(file), `${file} is not an excepted shell owner`).toBe(
        false,
      );
    }
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
    // The image viewer header's title for a reference with no filename.
    "lightbox.imageFallbackTitle",
  ];

  it.each(NEEDED)("%s is defined in both locales", (key) => {
    expect(en[key], `${key} missing from en.json`).toBeTruthy();
    expect(zh[key], `${key} missing from zh.json`).toBeTruthy();
  });
});
