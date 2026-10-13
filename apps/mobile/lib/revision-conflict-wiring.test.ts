import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring guard for the concurrency gate (MYS-2132).
 *
 * Three separate links have to hold for a stale edit to be REFUSED rather than
 * to overwrite someone, and each fails silently on its own:
 *
 *   1. the SCHEMA must keep the token the server sent — `z.object()` strips
 *      unknown keys, so a missing `revision` field means the client never has a
 *      token to send, and every edit stays last-write-wins while looking
 *      perfectly healthy;
 *   2. the HOOK must forward the gate to the transport — the API method accepts
 *      it, but a hook that calls it with four arguments drops it;
 *   3. the SURFACE must capture the baseline when the editor OPENS and pass it
 *      at save — reading it live at save time compares the write against a
 *      version that may already include the other writer's change, which is
 *      precisely the case the gate exists to catch.
 *
 * Link 1 is checked against the real schema here (a parse round-trip); links 2
 * and 3 are source assertions, because neither is reachable from the Node test
 * lane without an RN renderer.
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

describe("the schemas keep the revision token", () => {
  it("IssueSchema parses `revision` instead of stripping it", async () => {
    const { IssueSchema } = await import("@multica/core/api/schemas");
    const parsed = IssueSchema.parse({
      id: "i1",
      workspace_id: "ws",
      number: 1,
      identifier: "MUL-1",
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
      revision: 12,
    });
    // A stripped token is the silent failure: the edit form would gate on
    // `undefined`, send no `expected_revision`, and overwrite.
    expect((parsed as { revision?: number }).revision).toBe(12);
  });

  it("TimelineSchema parses `revision` on comment entries", async () => {
    const { TimelineEntriesSchema } = await import("@multica/core/api/schemas");
    const parsed = TimelineEntriesSchema.parse([
      {
        type: "comment",
        id: "c1",
        actor_type: "member",
        actor_id: "u1",
        created_at: "2026-01-01T00:00:00Z",
        content: "hi",
        revision: 4,
      },
    ]);
    // This is the token the comment editor gates on — `/timeline` is where it
    // reads the comment from, so losing it here disables the gate for comments
    // even though `CommentSchema` kept it.
    expect(parsed[0]?.revision).toBe(4);
  });

  it("downgrades a malformed revision to absent rather than blanking the page", async () => {
    const { TimelineEntriesSchema } = await import("@multica/core/api/schemas");
    const parsed = TimelineEntriesSchema.parse([
      {
        type: "comment",
        id: "c1",
        actor_type: "member",
        actor_id: "u1",
        created_at: "2026-01-01T00:00:00Z",
        content: "hi",
        revision: "not-a-number",
      },
    ]);
    // Falls back to "cannot gate" instead of failing the whole timeline — a
    // stricter schema would blank the comment list on one bad value.
    expect(parsed[0]?.revision).toBeUndefined();
    expect(parsed[0]?.content).toBe("hi");
  });

  it("coerces a malformed ISSUE revision too, rather than passing the raw value on", async () => {
    // The `IssueSchema` declaration is NOT redundant with `.loose()`. Loose mode
    // passes an undeclared key through UNVALIDATED, so without the declaration a
    // `revision: "junk"` lands on the parsed Issue as the STRING "junk" — typed
    // `number | undefined` by `Issue` but carrying a string at runtime, and
    // `revisionForEdit` would then forward it as `expected_revision: "junk"`,
    // which the server refuses with a 400 ("must be a positive integer") on an
    // edit that should simply have been ungated. The declaration is what makes
    // the TS type true and the bad value become "no token".
    const { IssueSchema } = await import("@multica/core/api/schemas");
    const parsed = IssueSchema.parse({
      id: "i1",
      workspace_id: "ws",
      number: 1,
      identifier: "MUL-1",
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
      revision: "junk",
    }) as { revision?: unknown };
    expect(parsed.revision).toBeUndefined();
  });
});

describe("useEditComment forwards the gate to the transport", () => {
  const src = codeOf(read("data/mutations/issues.ts"));

  function hookBody(hook: string): string {
    const start = src.indexOf(`export function ${hook}(`);
    expect(start, `${hook} not found`).toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const next = rest.indexOf("\nexport function ");
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("accepts both gate fields in its variables", () => {
    const body = hookBody("useEditComment");
    expect(body).toContain("contentBase");
    expect(body).toContain("expectedRevision");
  });

  it("passes both through to api.updateComment", () => {
    const body = hookBody("useEditComment");
    // Scoped to the CALL, not the hook: `contentBase` and `expectedRevision`
    // also appear in the destructuring pattern and the type annotation, so a
    // whole-body `toContain` passes even when the call drops them — which is
    // exactly the mutation this has to catch.
    const call = body.slice(body.indexOf("api.updateComment("));
    const args = call.slice(0, call.indexOf(")"));
    // Positional signature: commentId, content, attachmentIds, suppressAgentIds,
    // contentBase, expectedRevision.
    expect(args).toContain("contentBase");
    expect(args).toContain("expectedRevision");
  });
});

describe("useUpdateIssue strips the gate fields from its optimistic patch", () => {
  const src = codeOf(read("data/mutations/issues.ts"));

  it("destructures expected_revision and title_base out before patching", () => {
    const start = src.indexOf("export function useUpdateIssue(");
    const body = src.slice(start);
    // Both are write-time control fields with no `Issue` column. Patching
    // `expected_revision` into a cached row would leave a value the server is
    // about to change, and the next edit would gate on it and be refused for no
    // reason — a bug that only appears on the second save.
    expect(body).toContain("expected_revision: _expectedRevision");
    expect(body).toContain("title_base: _titleBase");
  });
});

describe("the surfaces capture the baseline when the editor opens", () => {
  it("the issue edit form captures revisionForEdit at seed time, not save time", () => {
    const src = codeOf(read("app/(app)/[workspace]/issue/[id]/edit.tsx"));
    // Seeded once from `detail.data` under the `seeded` guard…
    const seed = src.slice(src.indexOf("if (!detail.data || seeded) return;"));
    const seedBlock = seed.slice(0, seed.indexOf("setSeeded(true)"));
    expect(seedBlock).toContain("revisionForEdit(detail.data.revision)");
    // …and the save reads the captured value, never `detail.data` again. A live
    // read would include changes that landed while the member was typing, which
    // is the concurrent case the gate exists to catch.
    const save = src.slice(src.indexOf("const onSave = useCallback"));
    const saveBlock = save.slice(0, save.indexOf("update.mutate("));
    expect(saveBlock).toContain("expected_revision: openedRevision");
    expect(saveBlock).not.toContain("detail.data");
  });

  it("the comment editor snapshots the token when the editor opens", () => {
    const src = codeOf(read("components/issue/comment-card.tsx"));
    const open = src.slice(src.indexOf("const openEditor = useCallback"));
    const openBlock = open.slice(0, open.indexOf("setEditing(true)"));
    // Captured from `entry` at open. Reading it at save time instead would gate
    // the write on whatever the cache holds then — which, after a websocket
    // update or a refetch, already includes the other writer's version, so the
    // compare would succeed and the overwrite would go through.
    expect(openBlock).toContain("revisionForEdit(entry.revision)");
    expect(openBlock).toContain("entry.content");
  });

  it("the comment editor sends the captured baseline on save", () => {
    const src = codeOf(read("components/issue/comment-card.tsx"));
    const save = src.slice(src.indexOf("const saveEdit = useCallback"));
    const saveBlock = save.slice(0, save.indexOf("if (!isRevisionConflictError(err))"));
    expect(saveBlock).toContain("contentBase: gate.content");
    expect(saveBlock).toContain("expectedRevision: gate.revision");
  });

  it("the retry re-bases on the revision the SERVER reported, not the stale entry", () => {
    // The one value a retry cannot afford to guess. `entry` is captured from the
    // render that started the save, so when the rejection arrives it still
    // describes the pre-write state — re-gating on it sends the same doomed
    // value again and the member's "keep my version" does nothing. The 409 body
    // carries `actual_revision` for exactly this, so the retry reads it there.
    const src = codeOf(read("components/issue/comment-card.tsx"));
    const save = src.slice(src.indexOf("const saveEdit = useCallback"));
    const catchBlock = save.slice(save.indexOf("if (!isRevisionConflictError(err))"));

    expect(catchBlock).toContain("parseRevisionConflict(err)");
    expect(catchBlock).toContain("conflict?.actualRevision");
    // …and the retry passes that gate through, rather than falling back to the
    // baseline it just failed on.
    expect(catchBlock).toContain("saveEdit(draft, retryGate)");
  });

  it("the retry sends NO gate when the server reported no revision", () => {
    // The field-baseline 409 carries only `resource_type` — the server compared
    // `content_base` and reported that it moved, with no revisions to name.
    // Falling back to the ORIGINAL gate there would resend the baseline that was
    // just rejected and refuse forever, so the retry must degrade to a plain
    // ungated write, which is exactly what "keep my version" asserts.
    const src = codeOf(read("components/issue/comment-card.tsx"));
    const save = src.slice(src.indexOf("const saveEdit = useCallback"));
    const catchBlock = save.slice(save.indexOf("if (!isRevisionConflictError(err))"));
    expect(catchBlock).toMatch(/:\s*\{\};/);
    expect(catchBlock).not.toMatch(/:\s*gate;/);
  });
});

describe("both locales carry web's revision wording", () => {
  const keys = [
    "revision.conflict",
    "revision.conflictEditForm",
    "revision.useServer",
    "revision.keepLocal",
  ];

  for (const locale of ["zh", "en"]) {
    it(`${locale} resolves every revision key`, () => {
      const dict = JSON.parse(
        readFileSync(path.join(APP_ROOT, `lib/i18n/locales/${locale}.json`), "utf8"),
      ) as Record<string, string>;
      for (const key of keys) {
        // A missing key renders as the raw id — the silence this replaced,
        // wearing a debug string.
        expect(dict[key], `${locale} missing ${key}`).toBeTruthy();
      }
    });
  }
});
