import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring guard for source context (MYS-2137).
 *
 * Every link below fails SILENTLY on its own, which is why each has an
 * assertion rather than trusting the type checker:
 *
 *   1. the SCHEMA must keep `source_context` — `z.object()` strips unknown keys,
 *      so an undeclared field means the reader banner never draws on any issue
 *      while everything looks healthy;
 *   2. the HOOK must send `capture_token` on the create — the API method takes
 *      it, but a hook that assembles the body itself can drop it, and the
 *      server then refuses EVERY create with 409;
 *   3. the MUTATION must pin the conflict line to the server's CODE — this route
 *      answers 409 for a missing token as well as a stale one, and a
 *      status-only rule would tell a member to "refresh and retry" forever;
 *   4. the ENTRY must be gated on the comment type — the write endpoint is keyed
 *      on a comment id, so an ungated entry offers a button that 404s.
 *
 * Link 1 is a real parse round-trip; the rest are source assertions, because
 * none is reachable from the Node lane without an RN renderer.
 */
const APP_ROOT = path.resolve(__dirname, "..");
const CORE_ROOT = path.resolve(APP_ROOT, "../../packages/core");

function read(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

function readCore(rel: string): string {
  return readFileSync(path.join(CORE_ROOT, rel), "utf8");
}

/** Strip comments so a rule quoted in a docblock cannot satisfy an assertion. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** A minimal valid issue row, so a `source_context` can be added to a parse
 *  that would otherwise fail on required fields. */
const ISSUE_BASE = {
  id: "i1",
  workspace_id: "ws",
  number: 1,
  identifier: "MYS-1",
  title: "t",
  description: null,
  status: "todo",
  priority: "none",
  assignee_type: null,
  assignee_id: null,
  creator_type: "member",
  creator_id: "u1",
  parent_issue_id: null,
  project_id: null,
  position: 0,
  start_date: null,
  due_date: null,
  metadata: {},
  properties: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/** A `source_context` exactly as the live server sends it. */
const SOURCE_CONTEXT = {
  id: "sc-1",
  version: 1,
  usage: "read_only_historical_background",
  display_state: "unchanged",
  source_issue_state: "unchanged",
  comment_thread_state: "unchanged",
  anchor_comment_state: "available",
  can_open_current_source: true,
  change_reasons: [],
  change_details: { changed_comment_ids: [], description_attachment_changes: [] },
  current_source: { issue_id: "src", identifier: "MYS-2138", anchor_comment_id: "c1" },
  snapshot: {
    source_issue: {
      id: "src",
      identifier: "MYS-2138",
      number: 2138,
      title: "source",
      description: "d",
    },
    comment_thread: [
      {
        id: "c1",
        parent_id: null,
        type: "comment",
        content: "anchor",
        author: { type: "member", id: "u1", name: "MYSWY" },
        created_at: "t",
      },
    ],
    anchor_comment_id: "c1",
  },
};

describe("the issue schema keeps source_context", () => {
  it("parses the whole field instead of stripping it", async () => {
    const { IssueSchema } = await import("@multica/core/api/schemas");
    const parsed = IssueSchema.parse({ ...ISSUE_BASE, source_context: SOURCE_CONTEXT });
    // A stripped field is the silent failure: the reader banner renders null for
    // every issue that has a source, and nothing anywhere reports a problem.
    const sc = (parsed as { source_context?: typeof SOURCE_CONTEXT }).source_context;
    expect(sc).toBeDefined();
    expect(sc?.snapshot.source_issue.identifier).toBe("MYS-2138");
    expect(sc?.current_source?.anchor_comment_id).toBe("c1");
    expect(sc?.display_state).toBe("unchanged");
  });

  it("drops an unknown change reason instead of failing the parse", async () => {
    // Enum drift downgrades rather than crashes. A reason invented after this
    // build shipped must not take the banner down with it.
    const { IssueSchema } = await import("@multica/core/api/schemas");
    const parsed = IssueSchema.parse({
      ...ISSUE_BASE,
      source_context: {
        ...SOURCE_CONTEXT,
        display_state: "changed",
        change_reasons: ["comment_thread", "a_reason_from_the_future"],
      },
    }) as { source_context?: { change_reasons?: string[] } };
    expect(parsed.source_context?.change_reasons).toEqual(["comment_thread"]);
  });

  it("drops the whole field when the snapshot itself is unparseable", async () => {
    // `snapshot` is the one nested object the banner needs. Without it there is
    // nothing to draw, so the field degrades to "no source" — which every
    // reader already handles — rather than taking the issue down with it.
    const { IssueSchema } = await import("@multica/core/api/schemas");
    const parsed = IssueSchema.parse({
      ...ISSUE_BASE,
      source_context: { id: "sc", display_state: "unchanged" },
    }) as { source_context?: unknown; title?: string };
    expect(parsed.source_context).toBeUndefined();
    expect(parsed.title).toBe("t");
  });

  it("leaves an issue without a source untouched", async () => {
    const { IssueSchema } = await import("@multica/core/api/schemas");
    const parsed = IssueSchema.parse(ISSUE_BASE) as { source_context?: unknown };
    expect(parsed.source_context).toBeUndefined();
  });

  it("types source_context on the Issue interface, so call sites see it", () => {
    // The type half of link 1: a schema field with no interface declaration is
    // dropped by the TS type, and every reader would have to cast.
    const src = readCore("types/issue.ts");
    expect(src).toContain("source_context?: IssueSourceContext;");
    expect(src).toContain("export interface IssueSourceContext {");
  });
});

describe("the preview schema fails closed", () => {
  it("yields an empty capture_token when the body drifts", async () => {
    // `previewIsUsable` is what the confirm surface gates its create button on.
    // If a drifted body produced a truthy token, the gate would pass and the
    // server would reject every create — with no way for the member to tell why.
    const { CommentSubIssuePreviewSchema, EMPTY_COMMENT_SUB_ISSUE_PREVIEW } =
      await import("@multica/core/api/schemas");
    const result = CommentSubIssuePreviewSchema.safeParse({ nonsense: true });
    expect(result.success).toBe(false);
    expect(EMPTY_COMMENT_SUB_ISSUE_PREVIEW.capture_token).toBe("");
  });

  it("parses a real preview body", async () => {
    const { CommentSubIssuePreviewSchema } = await import("@multica/core/api/schemas");
    const parsed = CommentSubIssuePreviewSchema.parse({
      source_issue: { id: "s", identifier: "MYS-1", number: 1, title: "t", description: null },
      comment_thread: [],
      anchor_comment_id: "c1",
      capture_token: "sha256:abc:s",
      limits: { comment_count: 1, text_bytes: 10, attachment_count: 0, attachment_bytes: 0 },
    });
    expect(parsed.capture_token).toBe("sha256:abc:s");
    expect(parsed.limits.text_bytes).toBe(10);
  });
});

describe("useCreateCommentSubIssue sends what the server needs", () => {
  const src = codeOf(read("data/mutations/issues.ts"));

  function hookBody(): string {
    const start = src.indexOf("export function useCreateCommentSubIssue(");
    expect(start, "useCreateCommentSubIssue not found").toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const next = rest.indexOf("\nexport function ");
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("sends capture_token on BOTH modes", () => {
    // Without the token the server refuses every create with 409
    // `source_context_changed`, whatever else the body says.
    const body = hookBody();
    const manual = body.indexOf('mode: "manual"');
    const agent = body.indexOf('mode: "agent"');
    expect(manual).toBeGreaterThan(-1);
    expect(agent).toBeGreaterThan(-1);
    const manualCall = body.slice(manual, agent);
    const agentCall = body.slice(agent);
    expect(manualCall).toContain("capture_token: vars.captureToken");
    expect(agentCall).toContain("capture_token: vars.captureToken");
  });

  it("pairs each mode with the field name the server requires", () => {
    // `issue` for manual, `quick_create` for agent. The server answers
    // "quick_create is required for agent mode" for a body that carries a bare
    // `prompt`, so getting this wrong is a 400 on every agent-mode create.
    const body = hookBody();
    expect(body).toContain("issue: vars.issue");
    expect(body).toContain("quick_create: vars.quickCreate");
  });

  it("pins the conflict line to the server's own code", () => {
    // This route answers 409 for a missing token as well as a stale one. A
    // status-only rule would substitute "refresh and retry" for the missing-token
    // refusal too — an instruction refreshing cannot satisfy.
    const body = hookBody();
    expect(body).toContain("[WRITE_FAILURE_CONFLICT_KEY]: SOURCE_CONTEXT_CHANGED_KEY");
    expect(body).toContain("[WRITE_FAILURE_CONFLICT_CODE_KEY]: SOURCE_CONTEXT_CHANGED_CODE");
  });

  it("carries a title, so a generic failure is reported at all", () => {
    const body = hookBody();
    expect(body).toContain("[WRITE_FAILURE_TITLE_KEY]");
  });

  it("refreshes the parent's children and timeline on settle", () => {
    // The new child appears under the parent, and the server writes an activity
    // row onto the source issue's timeline — neither is on the issue the member
    // is looking at, so both need an explicit invalidation.
    const body = hookBody();
    expect(body).toContain("issueKeys.children(wsId, vars.sourceIssueId)");
    expect(body).toContain("issueKeys.timeline(wsId, vars.sourceIssueId)");
  });
});

describe("the action-sheet entry is gated", () => {
  const src = codeOf(read("components/issue/comment-context-menu.tsx"));

  it("gates on the comment-type predicate, not a local literal", () => {
    // A local `entry.comment_type === "comment"` here would be a second copy of
    // the rule that the tests and the author side cannot reach.
    expect(src).toContain("canCreateSubIssueFromComment(entry)");
  });

  it("also requires a workspace slug, because the target route is scoped by it", () => {
    expect(src).toContain("canCreateSubIssueFromComment(entry) && !!wsSlug");
  });

  it("pushes the confirm route and seeds the target store", () => {
    expect(src).toContain("useSourceContextTargetStore.getState().setTarget(");
    expect(src).toContain("create-sub-issue");
  });
});

describe("the reader banner is mounted and unconditional", () => {
  const src = codeOf(read("components/issue/timeline-list.tsx"));

  it("draws the source-context strip above the title, outside the header card", () => {
    expect(src).toContain("<IssueSourceContextBanner issue={issue} />");
    // Above the header card, next to the duplicate banner: both are statements
    // about ANOTHER issue, not about this one's identity.
    const bannerAt = src.indexOf("<IssueSourceContextBanner");
    const cardAt = src.indexOf("<IssueHeaderCard");
    expect(bannerAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(bannerAt);
  });

  it("is not gated on a write callback", () => {
    // Unlike the duplicate banner, this strip carries no write — it is a pure
    // read of a field the server already resolved — so it must render whenever
    // the payload carries a source, not only when some parent passed a handler.
    const at = src.indexOf("<IssueSourceContextBanner");
    const line = src.slice(at, src.indexOf("/>", at));
    expect(line).not.toContain("onUnmark");
  });
});

describe("the confirm route is registered", () => {
  it("is declared as a modal screen with a title", () => {
    const src = read("app/(app)/[workspace]/_layout.tsx");
    expect(src).toContain('name="issue/[id]/comment/[commentId]/create-sub-issue"');
    // A title is not cosmetic on Android: `formSheet` is iOS-only and the
    // create surface is a modal, so without one the header is blank.
    expect(src).toContain('t("sourceContext.createTitle")');
  });
});

describe("source-context copy exists in both locales", () => {
  it("resolves every key the surfaces use", () => {
    const en = JSON.parse(read("lib/i18n/locales/en.json")) as Record<string, string>;
    const zh = JSON.parse(read("lib/i18n/locales/zh.json")) as Record<string, string>;
    const used = [
      "sourceContext.action",
      "sourceContext.captureContents",
      "sourceContext.captureIssue",
      "sourceContext.captureComments",
      "sourceContext.captureSize",
      "sourceContext.captureAttachments",
      "sourceContext.captureLimitNote",
      "sourceContext.changeCount_one",
      "sourceContext.changeCount_other",
      "sourceContext.changeSentence",
      "sourceContext.confirm",
      "sourceContext.createFailed",
      "sourceContext.createTitle",
      "sourceContext.createdFrom",
      "sourceContext.descriptionLabel",
      "sourceContext.loadFailed",
      "sourceContext.modeAgent",
      "sourceContext.modeManual",
      "sourceContext.parentNote",
      "sourceContext.queued",
      "sourceContext.sourceChanged",
      "sourceContext.sourceDeleted",
      "sourceContext.sourceUnchecked",
      "sourceContext.subjectCommentThread",
      "sourceContext.subjectIssueAttachments",
      "sourceContext.subjectIssueDescription",
      "sourceContext.subjectIssueTitle",
      "sourceContext.titleLabel",
    ];    for (const key of used) {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
      // The raw-id fallback would satisfy `toBeTruthy`, so the value has to
      // differ from the key itself.
      expect(en[key], `en ${key} is the raw id`).not.toBe(key);
      expect(zh[key], `zh ${key} is the raw id`).not.toBe(key);
    }
  });

  it("keeps the two bundles in step", () => {
    const en = JSON.parse(read("lib/i18n/locales/en.json")) as Record<string, string>;
    const zh = JSON.parse(read("lib/i18n/locales/zh.json")) as Record<string, string>;
    const enKeys = Object.keys(en).filter((k) => k.startsWith("sourceContext.")).sort();
    const zhKeys = Object.keys(zh).filter((k) => k.startsWith("sourceContext.")).sort();
    expect(zhKeys).toEqual(enKeys);
  });
});
