/**
 * Wiring guards for iteration 259 (MYS-2245).
 *
 * The three decisions this round makes are unit-tested next to their modules
 * (`issue-details-facts.test.ts`, `duplicate-issue-error.test.ts`,
 * `create-property-writes.test.ts`). What those cannot catch is a decision that
 * exists but is never CALLED — the failure mode this repo has hit repeatedly
 * (a helper lands, the screen keeps its old inline path, the round looks
 * complete). So this file asserts the call sites, by reading their source.
 *
 * Source-text assertions are weaker than behavioural ones, which is why they
 * are confined to "is it connected", while every "what does it decide" question
 * lives in the unit tests beside each module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(APP, rel), "utf8");

describe("#3 issue Details block", () => {
  const timeline = read("components/issue/timeline-list.tsx");
  const section = read("components/issue/issue-details-section.tsx");

  it("is rendered by the issue timeline", () => {
    expect(timeline).toContain("<IssueDetailsSection issue={issue} />");
    expect(timeline).toContain(
      'import { IssueDetailsSection } from "./issue-details-section";',
    );
  });

  it("sits above the metadata bag, matching web's Details → Metadata order", () => {
    const details = timeline.indexOf("<IssueDetailsSection");
    const metadata = timeline.indexOf("<IssueMetadataSection");
    expect(details).toBeGreaterThan(-1);
    expect(metadata).toBeGreaterThan(-1);
    expect(details).toBeLessThan(metadata);
  });

  it("routes the creator name through the shared readiness primitive", () => {
    // Not a hand-rolled `getName(...) ?? "Unknown"` — that is the defect
    // 254–257 removed from eleven other surfaces.
    expect(section).toContain("creatorLine(issue");
    expect(section).toContain("resolvedBy");
    expect(section).not.toContain('"Unknown"');
  });

  it("prints a load mark, never a sentinel, while the creator is unread", () => {
    expect(section).toContain('creator.kind === "name"');
    expect(section).toContain('t("issue.details.creatorLoading")');
  });

  it("draws the creator's avatar from the issue payload, not the directory", () => {
    // `creator_type` / `creator_id` are local reads, so the avatar is correct
    // before any directory answers — only the NAME waits. Dropping it would
    // leave the unread row completely blank.
    expect(section).toContain("<ActorAvatar");
    expect(section).toContain("type={issue.creator_type}");
    expect(section).toContain("id={issue.creator_id}");
  });

  it("renders all three facts", () => {
    expect(section).toContain('t("issue.details.createdBy")');
    expect(section).toContain('t("issue.details.created")');
    expect(section).toContain('t("issue.details.updated")');
  });
});

describe("#2 duplicate 409 on create", () => {
  const screen = read("app/(app)/[workspace]/new-issue.tsx");

  it("classifies the failure before falling back to the generic alert", () => {
    // Scoped to the MANUAL submit's catch block: the agent-mode catch also
    // raises `failedTitle`, and searching the whole file would compare against
    // whichever one happens to come first.
    const start = screen.indexOf("const submitManualMode");
    const end = screen.indexOf("const onSubmit");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = screen.slice(start, end);
    const classify = block.indexOf("classifyCreateFailure(");
    const generic = block.indexOf('t("newIssue.failedTitle")');
    expect(classify).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(-1);
    expect(classify).toBeLessThan(generic);
  });

  it("only hands a real ApiError to the classifier", () => {
    // A thrown string must not be inspected for `.status`.
    expect(screen).toContain("err instanceof ApiError ? err : null");
  });

  it("raises the prompt with its buttons, not a bare message", () => {
    expect(screen).toContain("duplicateCreatePrompt(");
    expect(screen).toContain("prompt.buttons");
  });

  it("navigates with replace, not push — the create screen is a modal", () => {
    expect(screen).toContain("navigate: (path) => router.replace(path)");
  });

  it("does NOT clear the draft on a duplicate refusal", () => {
    // The create failed, so the user's work must survive: the only
    // `resetDraft()` calls in this screen are on the success paths, and there
    // is none between the duplicate classification and the generic fallback.
    const start = screen.indexOf('failure.kind === "duplicate"');
    const end = screen.indexOf('t("newIssue.failedTitle")', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const duplicateBlock = screen.slice(start, end);
    expect(duplicateBlock).not.toContain("resetDraft");
    expect(duplicateBlock).toContain("Alert.alert");
  });
});

describe("#1 custom properties on create", () => {
  const screen = read("app/(app)/[workspace]/new-issue.tsx");
  const row = read("components/issue/create-form-property-row.tsx");
  const editor = read("app/(app)/[workspace]/new-issue-picker/property.tsx");
  const layout = read("app/(app)/[workspace]/_layout.tsx");

  it("draws the property row in manual mode", () => {
    expect(screen).toContain("<CreateFormPropertyRow />");
    expect(screen).toContain(
      'import { CreateFormPropertyRow } from "@/components/issue/create-form-property-row";',
    );
  });

  it("snapshots the values BEFORE the create, so resetDraft cannot erase them", () => {
    const snapshot = screen.indexOf("const pendingPropertyValues = propertyValues;");
    const create = screen.indexOf("createIssue.mutateAsync(");
    expect(snapshot).toBeGreaterThan(-1);
    expect(snapshot).toBeLessThan(create);
    // …and the fan-out actually consumes the SNAPSHOT. Without this second
    // half, deleting the snapshot line still passes (the store read is in
    // scope) while the fan-out would run against the post-reset store.
    expect(screen).toContain("        pendingPropertyValues,");
    // Iteration 262 moved the post-create exit behind `finishCreate()`, which
    // owns BOTH branches (stay-and-reset vs. reset-and-pop). The invariant
    // this test guards is unchanged — the fan-out must finish before whatever
    // consumes the draft — so the anchor follows the call, not the old
    // literal `resetDraft();`.
    const fanout = screen.indexOf("await writeCreatePropertyValues(");
    const exit = screen.indexOf("finishCreate();", fanout);
    expect(fanout).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(fanout);
  });

  it("awaits the fan-out before navigating away", () => {
    // A write cut off by the unmount is silent data loss. The navigation now
    // lives inside `finishCreate`'s close branch (iteration 262), so the
    // assertion is that the pop still happens there AND that the fan-out
    // precedes the call which can pop.
    const fanout = screen.indexOf("await writeCreatePropertyValues(");
    const exit = screen.indexOf("finishCreate();", fanout);
    expect(fanout).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(fanout);
    const finish = screen.indexOf("const finishCreate = useCallback(");
    const back = screen.indexOf("router.back();", finish);
    expect(back).toBeGreaterThan(finish);
  });

  it("dismisses the modal BEFORE the partial-failure alert", () => {
    // The reverse order tears down the alert's host window in the same frame
    // on Android. Scoped to the manual submit's success path. `finishCreate`
    // is the dismissal now — it pops on the close branch and leaves the form
    // mounted (already reset) on the keep-open branch, which is a live host
    // for the alert either way.
    const start = screen.indexOf("const outcome = await writeCreatePropertyValues(");
    const end = screen.indexOf("} catch (err) {", start);
    const block = screen.slice(start, end);
    const dismiss = block.indexOf("finishCreate();");
    const alert = block.indexOf('t("newIssue.propertiesPartialTitle")');
    expect(dismiss).toBeGreaterThan(-1);
    expect(alert).toBeGreaterThan(-1);
    expect(dismiss).toBeLessThan(alert);
  });

  it("reports partial failure separately from a failed create", () => {
    expect(screen).toContain("propertyWriteFailureMessage(outcome, t)");
    expect(screen).toContain('t("newIssue.propertiesPartialTitle")');
  });

  it("does NOT put property values on the create payload", () => {
    // `POST /api/issues` silently ignores an unknown field, so sending them
    // would look like it worked and lose the values. The slice is the ONE
    // submit call (up to its closing `});`), not the prose around it.
    const start = screen.indexOf("await createIssue.mutateAsync({");
    const end = screen.indexOf("\n      });", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const payload = screen.slice(start, end);
    expect(payload).not.toMatch(/propert/i);
    expect(payload).toContain("title: trimmedTitle");
  });

  it("stores draft values in the shared store, not screen state", () => {
    // The picker route is a separate Stack screen with no parent relationship.
    expect(editor).toContain("useNewIssueDraftStore((s) => s.setPropertyValue)");
    expect(editor).toContain("useNewIssueDraftStore((s) => s.propertyValues)");
    // The hook must not be IMPORTED — the module's prose mentions it to explain
    // the contrast with the issue-bound host, which is not a wiring claim.
    expect(editor).not.toContain("useSetIssueProperty,");
    expect(editor).not.toContain("useSetIssueProperty }");
    expect(editor).not.toContain("@/data/mutations/properties");
    // The write itself: `commit` must call the store setter, and the setter
    // call must be the one carrying the property id. Without this the module
    // could import the store, never write to it, and still pass the greps.
    const commitFn = editor.slice(
      editor.indexOf("const commit ="),
      editor.indexOf("const clear ="),
    );
    expect(commitFn).toContain("setPropertyValue(propertyId, next)");
  });

  it("closes the sheet after a single-value commit but stays open for multi", () => {
    const commitFn = editor.slice(
      editor.indexOf("const commit ="),
      editor.indexOf("const clear ="),
    );
    expect(commitFn).toContain("if (!multi) close();");
    // `multi` must actually be derived from the property type, or the branch
    // is dead and every toggle would dismiss the sheet.
    expect(commitFn).toContain('property?.type === "multi_select"');
    expect(commitFn).toContain('property?.type === "multi_actor"');
  });

  it("never asserts 'no properties' while the catalog is unread", () => {
    expect(row).toContain("if (!catalog.isResolved)");
    const guard = row.slice(
      row.indexOf("if (!catalog.isResolved)"),
      row.indexOf("if (catalog.definitions.length === 0)"),
    );
    expect(guard).toContain('catalog.state === "error"');
    expect(guard).toContain("catalog.retry");
  });

  it("registers both new routes in the workspace Stack", () => {
    expect(layout).toContain('name="new-issue-picker/property"');
    expect(layout).toContain('name="new-issue-picker/properties"');
  });

  it("reuses the shared value bodies instead of a second implementation", () => {
    expect(editor).toContain("<PropertyValueBody");
    // The issue-bound editor delegates to the same component (iteration 259's
    // extraction); if either grew its own copy the two would drift.
    const issueEditor = read("components/issue/pickers/property-value-editor.tsx");
    expect(issueEditor).toContain("<PropertyValueBody");
  });

  it("mirrors the body's typed text back to both headers", () => {
    // Both hosts put Done in their header and the body owns the input state,
    // so BOTH must pass `onDraftChange`. Without it the header commits the
    // value the field held on open and silently discards the edit — the exact
    // way this seam failed while the round was being written.
    const body = read("components/issue/pickers/property-value-body.tsx");
    expect(body).toContain("onDraftChange?: (next: string) => void;");
    expect(body).toContain("onDraftChange?.(next);");
    expect(editor).toContain("onDraftChange={setDraftText}");
    const issueEditor = read("components/issue/pickers/property-value-editor.tsx");
    expect(issueEditor).toContain("onDraftChange={setDraft}");
  });
});

describe("draft store carries property values", () => {
  const store = read("data/stores/new-issue-draft-store.ts");

  it("has a values slot, a setter, and a reset to empty", () => {
    expect(store).toContain("propertyValues: IssuePropertyValues;");
    expect(store).toContain("setPropertyValue:");
    expect(store).toContain("propertyValues: {},");
  });

  it("counts a property value as draft content (the sidebar dot)", () => {
    expect(store).toContain("Object.keys(values.propertyValues).length > 0");
  });

  it("round-trips values through snapshot() so persistence keeps them", () => {
    expect(store).toContain("propertyValues: state.propertyValues,");
  });

  it("sanitises persisted values rather than trusting the file", () => {
    expect(store).toContain("propertyValues: asPropertyValues(d.propertyValues)");
  });
});
