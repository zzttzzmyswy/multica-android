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

/** Each kind's renderer file, and the token that proves it can hand the file
 *  to the user. `image` goes through the lightbox, whose exit is the viewer;
 *  the other two download. */
const KIND_EXIT: { kind: (typeof ATTACHMENT_KINDS)[number]; file: string; token: string }[] = [
  { kind: "image", file: "lib/markdown/markdown-image.tsx", token: "useLightbox" },
  { kind: "html", file: HTML_PREVIEW, token: "downloadAttachmentAndOpen" },
  { kind: "file", file: LIST, token: "downloadAttachmentAndOpen" },
];

describe("standalone attachment list — every kind is actionable", () => {
  const list = code(LIST);

  it("resolves the kind through the shared helper, not an inline compare", () => {
    // The inline `content_type === "text/html"` compare is the bug: it can
    // never match the server's `text/html; charset=utf-8`.
    expect(list).toContain("attachmentKind(");
    expect(list).not.toContain('content_type === "text/html"');
  });

  it("has a branch for every declared kind", () => {
    // A kind declared in ATTACHMENT_KINDS but never dispatched would silently
    // fall through to the file card, so pin the dispatch on the constant.
    expect(list).toContain("kind ===");
    for (const kind of ATTACHMENT_KINDS) {
      if (kind === "file") continue; // the fallthrough branch
      expect(list).toContain(`"${kind}"`);
    }
  });

  it("every kind's renderer carries a user-reachable exit", () => {
    for (const { kind, file, token } of KIND_EXIT) {
      const src = code(file);
      expect(src, `${file} (kind: ${kind}) has no exit affordance`).toContain(token);
    }
  });

  it("the html renderer downloads whether or not the preview rendered", () => {
    const src = code(HTML_PREVIEW);
    // The header (success path) and the failure placeholder must both offer
    // the download — web's reasoning verbatim: Preview / Download are the only
    // escape hatches when inline render fails, so on failure the action must
    // not disappear with the body.
    const calls = src.match(/onPress=\{handleDownload\}/g) ?? [];
    expect(calls.length, "download must be wired in both the loaded and failed states").toBeGreaterThanOrEqual(2);
  });

  it("the failed state is distinct from the loading state", () => {
    // Rendering the failure copy while the first read is still in flight
    // claims an absence out of an unsettled read.
    const src = code(HTML_PREVIEW);
    expect(src).toContain("text === null");
    expect(src).toContain("richContent.html.previewLoading");
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
    // Values captured from muapi.zztweb.top uploads. If the dispatcher ever
    // goes back to exact matching, these are the cases that break.
    const live: [string, string, string][] = [
      ["text/html; charset=utf-8", "page.html", "html"],
      ["text/plain; charset=utf-8", "fragment.html", "html"],
      ["image/png", "shot.png", "image"],
      ["image/svg+xml", "diagram.svg", "image"],
      ["text/plain; charset=utf-8", "notes.txt", "file"],
      ["application/pdf", "doc.pdf", "file"],
    ];
    for (const [ct, filename, expected] of live) {
      expect(attachmentKind(ct, filename), `${filename} (${ct})`).toBe(expected);
    }
  });
});

describe("the html renderer's new strings exist in both bundles", () => {
  // The locale-completeness suite already covers literal `t("...")` keys, but
  // it resolves them through the translator's fallback — these three are the
  // ones this iteration introduced, so pin them against both bundles directly
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
    "a11y.downloadFile",
  ];

  it.each(NEEDED)("%s is defined in both locales", (key) => {
    expect(en[key], `${key} missing from en.json`).toBeTruthy();
    expect(zh[key], `${key} missing from zh.json`).toBeTruthy();
  });
});
