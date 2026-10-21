/**
 * Wiring guards for iteration 264 (MYS-2291).
 *
 * Mobile's vitest lane is Node-only (see `vitest.config.ts`) — there is no RN
 * renderer — so "the sheet passes `archived` to the row that must not exist"
 * and "the form sends the empty pair" cannot be asserted by rendering. They are
 * asserted here against the source, the way `inbox-main-filter-wiring.test.ts`
 * pins the main inbox's filter entry.
 *
 * Each assertion below is a specific way this release could regress into
 * looking correct:
 *
 *   #1 The idle dimension is correct in the pure layer and never wired, or
 *      wired into the archive where the backend cannot honour it.
 *   #2 The form computes the empty pair correctly and a `return` above it
 *      makes Save a no-op — the failure mode that is hardest to diagnose from
 *      a bug report ("I tapped save, the sheet closed, nothing changed").
 *
 * Comments are stripped before matching, so a comment quoting the wiring
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "..");
const SCREEN = path.join(APP, "app/(app)/[workspace]/(tabs)/inbox.tsx");
const SHEET = path.join(APP, "components/inbox/inbox-archive-filter-sheet.tsx");
const SNAPSHOT = path.join(APP, "data/queries/agent-task-snapshot.ts");
const FORM = path.join(APP, "components/quick-action/quick-action-form.tsx");
const PICKER = path.join(APP, "components/quick-action/agent-squad-picker-modal.tsx");
const SETTINGS = path.join(
  APP,
  "app/(app)/[workspace]/more/settings/quick-actions.tsx",
);
const SECTION = path.join(APP, "components/quick-action/quick-actions-section.tsx");

function code(abs: string): string {
  return readFileSync(abs, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The main view's `return (...)` block. */
function mainBranch(screen: string): string {
  const archivedAt = screen.indexOf('if (view === "archived")');
  expect(archivedAt).toBeGreaterThan(-1);
  const mainAt = screen.indexOf("\n  return (", archivedAt);
  expect(mainAt).toBeGreaterThan(-1);
  return screen.slice(mainAt);
}

describe("#1 the inbox 'no agents working' dimension", () => {
  const screen = code(SCREEN);
  const main = mainBranch(screen);
  const sheet = code(SHEET);

  it("reads the running-OR-QUEUED projection, not the running-only one", () => {
    // Web answers the dimension from `activityByIssueId`'s key set, which holds
    // queued tasks too (`inbox-page.tsx`). Sharing `useRunningIssueIds` — the
    // issue list's "working right now" set — would make an issue whose task was
    // just dispatched read as idle here and busy on the web, for the same row.
    expect(screen).toMatch(/useIssueActivityIssueIds/);
    expect(screen).not.toMatch(/useRunningIssueIds/);
    const snapshot = code(SNAPSHOT);
    expect(snapshot).toMatch(/export function useIssueActivityIssueIds/);
    expect(snapshot).toMatch(/deriveIssueSurfaceActivity\(data\)\.activityByIssueId\.keys\(\)/);
  });

  it("feeds the set to the list and to the counts", () => {
    // Two different contexts on purpose: the LIST is gated on the dimension
    // being on (task churn is irrelevant otherwise), while the COUNT must be
    // available before it is switched on, or the row offering it carries no
    // number. Web splits them the same way (`:170-173` vs `:174`).
    expect(screen).toMatch(/filterInboxItems\(data, mainFilters, filterContext\)/);
    expect(screen).toMatch(/inboxLocalFacets\(data, mainFilters, \{ activeIssueIds \}\)/);
    expect(screen).toMatch(
      /const idleFilterIssueIds = mainFilters\.idleOnly \? activeIssueIds : undefined/,
    );
  });

  it("does not draw a list while an idle selection is waiting on the snapshot", () => {
    // Neither "everyone is idle" nor "nothing matches" is true yet. The
    // predicate fails closed, so without this gate the screen would flip
    // straight to its empty state and then to the real answer.
    expect(screen).toMatch(/const idleFilterPending =\s*mainFilters\.idleOnly && activeIssueIds === undefined/);
    expect(screen).toMatch(/isLoading \|\| idleFilterPending \?/);
  });

  it("offers the row only in the active inbox", () => {
    // The archive is filtered server-side and has no idle dimension; web hides
    // it there (`inbox-filter-menu.tsx:255-266`). The sheet is mounted twice
    // with no other prop that distinguishes the two lists, so the caller has
    // to say which one it is.
    expect(sheet).toMatch(/archived: boolean;/);
    expect(sheet).toMatch(/\{!archived && onToggleIdleOnly \?/);
    expect(main).toMatch(/archived=\{false\}/);
    expect(main).toMatch(/onToggleIdleOnly=\{/);
    // The archived mount passes the flag the other way and no handler — a
    // handler there would be dead code, and a missing flag would print the row.
    expect(screen).toMatch(/prioritySupport=\{prioritySupport\}\s*archived\s/);
    expect(screen).not.toMatch(/inbox\.archivedFilters"\)\}\s*wsId=\{wsId\}[\s\S]{0,600}onToggleIdleOnly/);
  });

  it("keeps the idle selection out of the archive's list, badge and Clear gate", () => {
    // Three surfaces, one rule. `inboxFiltersForArchive` is the shared answer;
    // using it everywhere is what stops the badge from advertising a filter the
    // list is not applying.
    expect(screen).toMatch(/const archivedFilters = useMemo\(\s*\(\) => inboxFiltersForArchive\(filters\)/);
    expect(screen).toMatch(/filterInboxItems\(rawArchivedItems, archivedFilters\)/);
    expect(screen).toMatch(/const archivedActiveFilterCount = inboxFilterCount\(archivedFilters\)/);
    expect(screen).toMatch(/activeCount=\{archivedActiveFilterCount\}/);
    // And the archive still sends the RAW store value, whose idle branch the
    // query key drops (see `normalizeInboxFilters`).
    expect(screen).toMatch(/archivedInboxPagesOptions\(wsId, filters\)/);
  });
});

describe("#2 quick actions without a target", () => {
  const form = code(FORM);
  const picker = code(PICKER);
  const settings = code(SETTINGS);
  const section = code(SECTION);

  it("does not gate Save on a target", () => {
    expect(form).toMatch(/quickActionCanSave\(\{ name, prompt, templateToken \}\)/);
    expect(form).not.toMatch(/!!assignee/);
    expect(form).not.toMatch(/assignee\.id\.length > 0/);
  });

  it("has no early return that would swallow the save", () => {
    // The nastiest shape of this bug: the button enables, the handler returns
    // immediately, the sheet does not even close — and nothing reports it.
    expect(form).not.toMatch(/if \(!assignee\) return;/);
  });

  it("sends the empty pair through the shared builder", () => {
    expect(form).toMatch(/const target = quickActionTargetPayload\(assignee\);/);
    expect(form).toMatch(/\.\.\.target,/);
  });

  it("lets the picker clear the selection", () => {
    // The signature used to be `Exclude<QuickActionAssignee, null>`, which made
    // "no target" unrepresentable at the call site: you could pick a target but
    // never un-pick one.
    expect(picker).toMatch(/onChange: \(next: QuickActionAssignee\) => void;/);
    expect(picker).not.toMatch(/Exclude<QuickActionAssignee, null>/);
    expect(picker).toMatch(/onChange\(null\)/);
    // Above the list, not inside it, so a search that matches nothing cannot
    // take away the only way to clear the binding. Web renders it as a header
    // for the same reason (`agent-picker.tsx`).
    expect(picker).toMatch(/ListHeaderComponent=\{/);
  });

  it("labels the cleared state as a choice, not an empty field", () => {
    expect(form).toMatch(/if \(!assignee\) return t\("quickActions\.noTarget"\);/);
    expect(form).toMatch(/t\("quickActions\.noTargetHint"\)/);
  });

  it("reads an empty assignee_type before target_missing", () => {
    // Ordered check inside `quickActionTargetState`; this pins the call site so
    // the row cannot grow a second, differently-ordered copy of the rule.
    expect(settings).toMatch(/quickActionTargetState\(action\)/);
    expect(settings).not.toMatch(/action\.target_missing === true/);
    expect(settings).toMatch(/case "none":/);
  });

  it("drops the issue row's 'runs as' line for a targetless action", () => {
    expect(section).toMatch(/quickActionShowsRunsAs\(action\) \?/);
    expect(section).not.toMatch(/action\.assignee_type !== ""/);
  });
});
