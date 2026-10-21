/**
 * Wiring guards for iteration 265 (MYS-2294).
 *
 * Two gaps, both of the same shape: the pure layer can be right while the
 * screen it exists for never asks it. Mobile's vitest lane is Node-only (see
 * `vitest.config.ts`), so these are asserted against the source, the way
 * `iter264-wiring.test.ts` pins the previous round's wiring. Comments are
 * stripped before matching, so a comment quoting the wiring cannot satisfy an
 * assertion.
 *
 * Gap 1 — `deferred` reached the client and was rewritten to `queued`.
 *   The schema now names it, and every `Record<AgentTask["status"], …>` has a
 *   key for it. What has to be checked is the SURFACES: a parked retry must be
 *   in neither the runs sheet's Active section nor its Past section, and must
 *   not be counted as a run in the usage breakdown. Each of those is one
 *   `filter` that could be omitted and would still compile.
 *
 * Gap 2 — the archive's deep link had no way to resolve past the first page.
 *   The lookup exists in three places that must agree: the query options (see
 *   `inbox.ts`), the gate (pure, tested by name), and the screen that wires
 *   the gate to `useQuery`. A gate nobody calls fixes nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "..");
const RUNS = path.join(APP, "app/(app)/[workspace]/issue/[id]/runs.tsx");
const RUN_ROW = path.join(APP, "components/issue/run-row.tsx");
const TIMELINE_PANEL = path.join(APP, "components/issue/run-timeline-panel.tsx");
const USAGE_DIALOG = path.join(APP, "components/issue/usage-breakdown-dialog.tsx");
const ITEM_SCREEN = path.join(APP, "app/(app)/[workspace]/inbox-item/[id].tsx");
const INBOX_QUERIES = path.join(APP, "data/queries/inbox.ts");
const SCHEMAS = path.join(APP, "data/schemas.ts");
const CORE_ACTIVITY = path.join(
  APP,
  "../../packages/core/issues/surface/issue-activity.ts",
);
const CORE_TYPES = path.join(APP, "../../packages/core/types/agent.ts");

function code(abs: string): string {
  return readFileSync(abs, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("deferred is a named status, not a rewritten one", () => {
  it("core's AgentTask.status union includes it", () => {
    expect(code(CORE_TYPES)).toMatch(/\|\s*"deferred"/);
  });

  it("the mobile schema parses it rather than catching it into queued", () => {
    // The enum and its `.catch("queued")` are adjacent; the assertion is that
    // "deferred" sits INSIDE the enum, before the catch.
    const src = code(SCHEMAS);
    const enumAt = src.indexOf('"waiting_local_directory"');
    expect(enumAt).toBeGreaterThan(-1);
    const catchAt = src.indexOf('.catch("queued")', enumAt);
    expect(catchAt).toBeGreaterThan(-1);
    const between = src.slice(enumAt, catchAt);
    expect(between).toContain('"deferred"');
  });

  it("every exhaustive status map has a deferred key", () => {
    // A missing key is not a style problem: the type stops compiling, and if
    // it were silenced the lookup would return undefined and the row would
    // render with no tone at all.
    for (const file of [RUNS, RUN_ROW, TIMELINE_PANEL]) {
      expect(code(file), `${path.basename(file)} needs a deferred key`).toMatch(
        /\bdeferred\s*:/,
      );
    }
  });
});

describe("a deferred retry is in neither runs section", () => {
  const runs = code(RUNS);

  it("the Active list filters to the four startable statuses", () => {
    // Without this the Active section renders whatever the endpoint returns.
    // The endpoint excludes deferred today, but the workspace snapshot widened
    // its active query upstream for exactly this status — a server that did the
    // same here would turn the sheet into a list of runs that never happened.
    expect(runs).toMatch(/ACTIVE_TASK_STATUSES/);
    expect(runs).toMatch(
      /new Set\(\[\s*"queued",\s*"dispatched",\s*"waiting_local_directory",\s*"running",?\s*\]\)/,
    );
    expect(runs).toMatch(/\.filter\(\(task\) => ACTIVE_TASK_STATUSES\.has\(task\.status\)\)/);
  });

  it("the Past list names its three terminal statuses and nothing else", () => {
    const pastAt = runs.indexOf("const past = useMemo");
    expect(pastAt).toBeGreaterThan(-1);
    const past = runs.slice(pastAt, runs.indexOf("}, [allTasks])", pastAt));
    expect(past).toContain('t.status === "completed"');
    expect(past).toContain('t.status === "failed"');
    expect(past).toContain('t.status === "cancelled"');
    expect(past).not.toContain("deferred");
  });
});

describe("a deferred retry is not counted as a run", () => {
  it("the usage breakdown drops it before counting", () => {
    // Web's runCount is `tasks.filter(t => t.status !== "deferred").length`: a
    // parked retry has not been run, so it is not a run the user paid for.
    // Mobile counted `priced.length` over ALL tasks — and a deferred retry can
    // carry usage inherited from the attempt it continues.
    const src = code(USAGE_DIALOG);
    expect(src).toMatch(/task\.status !== "deferred"/);
    const filterAt = src.indexOf('task.status !== "deferred"');
    const pricedAt = src.indexOf("const priced = useMemo");
    expect(pricedAt).toBeGreaterThan(filterAt);
  });

  it("the priced set is derived from the deferred-filtered set", () => {
    // Filtering `tasks` for usage only — the pre-fix shape — would leave the
    // exclusion present but unused.
    expect(code(USAGE_DIALOG)).toMatch(
      /const priced = useMemo\(\s*\(\) => counted\.filter\(/,
    );
  });
});

describe("the archive deep link can resolve past page one", () => {
  const queries = code(INBOX_QUERIES);
  const screen = code(ITEM_SCREEN);

  it("the lookup key is a sibling of the pages chain, not a child", () => {
    // A lookup hung off `pages` would join the cursor chain, and a reset of
    // that chain (a filter change) would drop the already-resolved row.
    expect(queries).toMatch(/lookup: \(wsId: string \| null\) =>/);
    expect(queries).toMatch(/\[\.\.\.inboxKeys\.archived\(wsId\), "lookup"\]/);
  });

  it("the lookup sends group_id and is gated on a UUID workspace+group", () => {
    expect(queries).toMatch(/archivedInboxLookupOptions/);
    expect(queries).toMatch(/\{\s*groupId,\s*signal\s*\}/);
    expect(queries).toMatch(/enabled: !!wsId && isIssueUuid\(groupId\)/);
  });

  it("the detail screen calls the gate and the lookup options", () => {
    // The pure module can be perfect and unreferenced. This is the assertion
    // that the screen actually asks it.
    expect(screen).toMatch(/shouldLookupArchivedItem\(/);
    expect(screen).toMatch(/archivedInboxLookupOptions\(/);
  });

  it("a lookup failure reaches the screen's error branch", () => {
    // Not the missing branch: "we could not reach it" is not "it is gone", and
    // rendering the missing sentence on a failed lookup is the exact
    // conflation `inboxItemPhase` exists to prevent.
    //
    // Anchored on the `inboxItemPhase({` call, not a bare `failed:` search.
    // There are two `failed:` lines in this screen (the lookup gate's and the
    // phase's), and an unanchored pattern matched the gate's own `failed:` and
    // then reached the latch line's `lookupQuery.isError` — so deleting the
    // phase's clause left the assertion green. The mutation script found it.
    const at = screen.indexOf("inboxItemPhase({");
    expect(at).toBeGreaterThan(-1);
    const phaseCall = screen.slice(at, screen.indexOf("});", at));
    expect(phaseCall).toMatch(/failed:[\s\S]*lookupQuery\.isError/);
  });

  it("the lookup's own failure feeds back into the gate, so it cannot loop", () => {
    // React Query keeps an errored entry's state when `enabled` flips false, so
    // reading the failure back is what stops the gate re-arming. A hard-coded
    // `false` here — the shape that looks harmless — re-arms the lookup on
    // every render and hammers the endpoint.
    //
    // The flag comes from a cache subscription read BEFORE the query, not from
    // `lookupQuery.isError`: a query object cannot reference itself in its own
    // initializer (TS7022/TS2448), and silencing that with a cast would hide a
    // genuine evaluation-order bug.
    expect(screen).toMatch(/const lookupFailed = useQueryFailed\(lookupOptions\.queryKey\)/);
    const at = screen.indexOf("shouldLookupArchivedItem({");
    expect(at).toBeGreaterThan(-1);
    const gate = screen.slice(at, screen.indexOf("})", at));
    expect(gate).toMatch(/lookupFailed,/);
    // And the subscription itself must report the ERROR state, not merely
    // "settled" — a `status !== "pending"` reading would latch on success too
    // and disable a lookup that never needed to run.
    expect(screen).toMatch(/getQueryState\(queryKey\)\?\.status === "error"/);
  });
});

describe("the deferred-aware activity predicate is wired", () => {
  it("core passes wakeup_id into the predicate at both call sites", () => {
    // The conditional half of the predicate is worthless if the caller only
    // passes the status: `deferred` would then never count as queued, and the
    // inbox would report an issue as idle while a rule is about to fire.
    const src = code(CORE_ACTIVITY);
    const calls = src.match(/isQueuedTaskStatus\(task\.status, task\.wakeup_id\)/g) ?? [];
    expect(calls).toHaveLength(2);
  });
});
