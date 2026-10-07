import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring ratchet for the issue deliverables surfaces (iteration 208, MUL-7649).
 *
 * `lib/deliverables.test.ts` proves the grouping and counting helpers answer
 * correctly, but none of that reaches a user unless four separate links exist:
 * the timeline must compute the deliverables, mount the section, hand it the
 * timeline entries for the overview's group headers, and the sheet must route
 * every open through the shared exits.
 *
 * That matters here more than usual, because the WHOLE feature is one mount
 * site: delete the single `<DeliverablesSection …>` line and the app still
 * compiles, the helpers' 17 tests still pass, and the issue deliverables are
 * gone from the phone again — silently, which is the exact defect this
 * iteration exists to fix. Mobile's vitest lane is Node-only (see
 * `apps/mobile/vitest.config.ts`), so this is asserted against source rather
 * than against rendered markup, which is the convention this repo already uses
 * for wiring (`custom-pricing-wiring.test.ts`, `attachment-action-parity.test.ts`).
 *
 * Comments are stripped before matching so a comment that merely describes the
 * wiring cannot satisfy an assertion.
 */
const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const TIMELINE = "components/issue/timeline-list.tsx";
const SECTION = "components/issue/deliverables-section.tsx";
const OVERVIEW = "components/issue/deliverables-overview-sheet.tsx";
const OPEN_HOOK = "lib/use-open-deliverable.ts";
const THUMBNAIL = "components/issue/deliverable-thumbnail.tsx";

describe("deliverables surfaces are mounted and reachable", () => {
  const timeline = code(TIMELINE);

  it("computes the deliverables from the raw timeline", () => {
    // `buildTimelineRows` folds replies into their parent row, so computing
    // from the threaded rows would drop every reply-time upload from the
    // count. Web derives its memo from the raw timeline for the same reason.
    expect(timeline).toContain("collectDeliverableFiles(");
    expect(timeline).toMatch(/collectDeliverableFiles\(\s*entries/);
  });

  it("mounts the section, and passes it the entries the overview groups by", () => {
    // The mount is the whole feature: without this line the phone shows
    // nothing, and nothing else in the app fails.
    expect(timeline).toContain("<DeliverablesSection");
    expect(timeline).toMatch(/<DeliverablesSection[\s\S]*?files=\{deliverableFiles\}/);
    // Without `entries` the overview cannot name or date the comment that
    // posted a group, so the group headers fall back to the uploader only.
    expect(timeline).toMatch(/<DeliverablesSection[\s\S]*?entries=\{entries\}/);
    // `source` reaches a `useCallback` dependency list inside the open hook, so
    // an inline object literal would rebuild that callback on every keystroke
    // in the composer, which re-renders this whole list header.
    expect(timeline).toMatch(/<DeliverablesSection[\s\S]*?source=\{deliverableSource\}/);
    expect(timeline).toMatch(/deliverableSource = useMemo/);
  });

  it("keeps the section inside the list header the reader scrolls through", () => {
    // The section is part of `ListHeader`, not a separate screen: it has to sit
    // between the PR list and the quick actions in the same header block.
    const header = timeline.indexOf("const ListHeader = (");
    const mount = timeline.indexOf("<DeliverablesSection");
    const activity = timeline.indexOf("timeline.activity");
    expect(header).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(header);
    expect(activity).toBeGreaterThan(mount);
  });
});

describe("the section routes every file through an existing exit", () => {
  const section = code(SECTION);

  it("uses the shared open hook rather than a private preview path", () => {
    expect(section).toContain("useOpenDeliverable(");
    // A second preview implementation is the drift this project already paid
    // for once (the .html attachment no renderer could open).
    expect(section).not.toContain("downloadAttachmentAndOpen");
  });

  it("offers the overview behind the count-bearing entry point", () => {
    expect(section).toContain("DeliverablesOverviewSheet");
    expect(section).toMatch(/viewAll/);
    // The sheet must receive the same array the badge counts, or the overview's
    // total and the section's number would disagree on the same screen.
    expect(section).toMatch(/<DeliverablesOverviewSheet[\s\S]*?files=\{files\}/);
  });

  it("renders nothing when the issue delivered nothing", () => {
    // The early return is what keeps the section from becoming a permanent
    // empty row on every issue that never produced a file.
    expect(section).toMatch(/files\.length === 0\) return null/);
  });
});

describe("the shared open hook keeps the comment list's exits", () => {
  const hook = code(OPEN_HOOK);

  it("sends images to the lightbox and everything else to the download flow", () => {
    expect(hook).toContain("useLightbox");
    expect(hook).toContain("useImageSequence");
    expect(hook).toContain("downloadAttachmentAndOpen");
    // The kind split must be the shared dispatcher, not a content-type compare:
    // that inline compare is the bug that made `.html` unopenable.
    expect(hook).toContain("attachmentKind(");
    expect(hook).not.toContain('content_type === "image');
  });

  it("resolves a server-relative URL before handing it to either exit", () => {
    // The backend returns `/api/attachments/{id}/download` when it has no CDN
    // signer, and RN's image loader has no document origin to resolve that
    // against.
    expect(hook).toContain("resolveAttachmentUrl(");
  });
});

describe("the overview keeps the section's count and version semantics", () => {
  const overview = code(OVERVIEW);

  it("shows the latest version of each file, so its count equals the badge's", () => {
    // Grouping and the word "latest" are in the pure helper; what matters here
    // is that the sheet reads that helper rather than its own list.
    expect(overview).toContain("groupDeliverablesByComment(");
    expect(overview).toContain("deliverableCategoryCounts(");
  });

  it("carries the version picker a phone cannot get from its viewer", () => {
    // Web puts the version dropdown in the viewer's title bar;
    // react-native-image-viewing has no such slot, so the sheet owns it.
    expect(overview).toContain("VersionPickerSheet");
    expect(overview).toMatch(/versionOf/);
  });

  it("closes itself before opening a file, like web does", () => {
    // The sheet covers the screen; opening underneath it would leave the
    // reader looking at the list they just tapped.
    expect(overview).toMatch(/onClose\(\);\s*openFile\(/);
  });
});

describe("the thumbnail degrades instead of showing an empty box", () => {
  const thumbnail = code(THUMBNAIL);

  it("falls back to the type glyph when the image cannot load", () => {
    // No thumbnail endpoint exists, so an image tile loads the original; a
    // failed load must still say what the file is.
    expect(thumbnail).toContain("onError");
    expect(thumbnail).toContain("FileFace");
  });

  it("decides 'is this an image' through the shared icon mapping", () => {
    expect(thumbnail).toContain("deliverableIconName(");
  });
});

describe("reverse verification — the guard goes red on the defect", () => {
  // The ratchet above is only worth having if it actually fails when the
  // feature is unwired. Rather than trust that reading, exercise the same
  // predicate on the pre-change shape: a timeline with no mount and no memo.
  const mounts = (src: string) => [
    src.includes("collectDeliverableFiles("),
    src.includes("<DeliverablesSection"),
    /<DeliverablesSection[\s\S]*?entries=\{entries\}/.test(src),
  ];

  it("rejects a timeline that computes nothing and mounts nothing", () => {
    const unwired = "const data = useMemo(() => buildTimelineRows(entries), []);";
    expect(mounts(unwired)).toEqual([false, false, false]);
  });

  it("rejects a mount that is missing the entries prop", () => {
    // This is the near-miss: the section renders, the counter is right, and
    // every group header silently loses its author and timestamp.
    const noEntries =
      'const deliverableFiles = collectDeliverableFiles(entries ?? []);' +
      '<DeliverablesSection files={deliverableFiles} identifier={issue.identifier} />';
    expect(mounts(noEntries)).toEqual([true, true, false]);
  });

  it("accepts the current source, so the assertion is not vacuous", () => {
    expect(mounts(code(TIMELINE))).toEqual([true, true, true]);
  });
});
