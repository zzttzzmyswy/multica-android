import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring for iteration 254 (MYS-2215): the surfaces that print an actor's name
 * resolve it through the read-state-aware primitive instead of `getName`, so a
 * directory that has not answered renders as "reading", not as `Unknown`.
 *
 * `lib/actor-name-state.test.ts` locks the decision; this file locks the
 * calling, because the decision is worthless if a surface keeps calling
 * `getName` directly. Source-level assertions are the only way to reach these
 * components from the Node lane — there is no RN renderer here, which is the
 * same constraint every `*-wiring.test.ts` in this folder works under.
 */

const ROOT = join(__dirname, "..");
const code = (rel: string) =>
  readFileSync(join(ROOT, rel), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

describe("the issue table's two actor columns", () => {
  const table = code("components/issue/table-view.tsx");

  it("renders the assignee cell through the shared primitive", () => {
    // Not `getName(issue.assignee_type, …)` into a <Text>: that is the exact
    // line that printed 「Unknown Agent」 on every row of a cold start.
    expect(table).toContain('case "assignee":');
    const assignee = table.slice(table.indexOf('case "assignee":'));
    const creator = assignee.indexOf('case "creator":');
    const cell = assignee.slice(0, creator);
    expect(cell).toContain("<ActorNameLabel");
    expect(cell).toContain(
      "state={resolveActorName(issue.assignee_type, issue.assignee_id)}",
    );
    // The absence it renders is the issue's own (no assignee), which is
    // measured from the row — not a claim about a directory read.
    expect(cell).toContain("empty={empty}");
    expect(cell).toContain(
      "const empty = !issue.assignee_type || !issue.assignee_id;",
    );
  });

  it("renders the creator cell through the shared primitive", () => {
    const creator = table.slice(table.indexOf('case "creator":'));
    const next = creator.indexOf('case "labels"');
    const cell = creator.slice(0, next);
    expect(cell).toContain("<ActorNameText");
    expect(cell).toContain(
      "state={resolveActorName(issue.creator_type, issue.creator_id)}",
    );
  });

  it("keeps the resolved name available for everything else", () => {
    // The CSV export, the group headers, and the property cells still need a
    // plain string — they are gated differently (`actorName` drops the
    // sentinels before a name reaches a file). Only the two visible name cells
    // move.
    expect(table).toContain("const { getName, resolveActorName } = useActorLookup();");
  });

  it("threads the resolver through every hop to the cell", () => {
    // Two hops, and both matter: `IssueTableView` → `DataRow` and `DataRow` →
    // `DataCell`. Dropping either one leaves `DataCell` without the resolver,
    // so the count — not a mere `toContain` — is the assertion.
    // The table's rows are `memo`ised with a hand-written comparator; a prop
    // that reaches `DataCell` without joining the comparator would freeze at
    // its cold-start value and never repaint when the directory lands — the
    // fix would work once and then appear broken forever.
    expect(table).toMatch(/prev\.resolveActorName === next\.resolveActorName/);
    // Three hops: `DataRow` → `DataCell`, `DataCell` → `PropertyCell`, and the
    // view → `DataRow`. Dropping any one leaves a name cell unable to decide.
    expect(table.match(/resolveActorName=\{resolveActorName\}/g)).toHaveLength(3);
    // …and the same through `PropertyCell`, whose actor chips fold names into
    // one line.
    expect(table).toContain("actorNameText(resolveActorName(ref.kind, ref.id))");
  });
});

describe("every other surface that named an actor from the raw lookup", () => {
  it("the issue row's avatar label", () => {
    // A screen reader announced 「View Unknown Agent's profile」 with the same
    // confidence as a real name; there is no visible text to correct it.
    const row = code("components/issue/issue-row.tsx");
    expect(row).toContain(
      "resolveActorName(issue.assignee_type, issue.assignee_id)",
    );
    expect(row).toContain("actorNameText(");
  });

  it("the board card's actor property chips", () => {
    // `cardPropertyChip` folds whatever the resolver returns straight into the
    // chip, so raw `getName` put 「Unknown」 inside a pill on every card.
    const card = code("components/issue/board-card.tsx");
    expect(card).toContain(
      "const chip = cardPropertyChip(display, translate, actorName);",
    );
    expect(card).not.toMatch(/cardPropertyChip\(display, translate, getName\)/);
    expect(card).toContain("actorNameText(resolveActorName(type, id))");
    // An ACTOR chip with nothing known is dropped, not drawn empty. Scoped to
    // `actors`: every other kind reads its text off the issue row, where an
    // empty value is a measurement and keeps its pill.
    expect(card).toContain('if (display.kind === "actors" && !chip.text) return null;');
    // …and the resolver's identity follows the lookup, not the render: an
    // empty dep array would pin the chip to whatever the first render saw —
    // a stable "unsettled" that never repaints when the directory lands.
    expect(card).toContain("[resolveActorName],");
  });

  it("the board's assignee column headers", () => {
    const board = code("components/issue/board-view.tsx");
    expect(board).not.toMatch(
      /label = getName\(column\.assigneeType, column\.assigneeId\);/,
    );
    expect(board).toContain(
      "actorNameText(resolveActorName(column.assigneeType, column.assigneeId))",
    );
  });

  it("the swimlane's assignee lane headers", () => {
    const swimlane = code("components/issue/swimlane-view.tsx");
    expect(swimlane).toContain(
      "actorNameText(actorNameState(lane.assigneeType, lane.assigneeId))",
    );
    // A lane header cannot be blank — it is the row's only label — so the
    // unsettled case gets the neutral "reading" mark rather than a name.
    expect(swimlane).toContain('t("issues.swimlane.loadingLane")');
  });

  it("the primitive paints a load state, never a name, when unsettled", () => {
    // The component's unsettled branch must render the skeleton — not a
    // placeholder string, and not the state's own (empty) name.
    const primitive = code("components/ui/actor-name.tsx");
    expect(primitive).toContain('if (state.kind === "unsettled") {');
    expect(primitive).toContain("<Skeleton");
    // The state's `name` is never read on that branch: `unsettled` carries no
    // name at all, by construction in `actor-name-state.ts`.
    expect(primitive).toContain("state.kind === \"gone\" &&");
  });

  it("the avatar's initials and profile label", () => {
    // `getInitials("Unknown")` is "U": a grey disc stamped "U" on every row is
    // the same false claim in a smaller font. Two call sites — the initials and
    // the profile-call label — and BOTH have to be converted; converting one
    // leaves the other announcing a name nobody looked up. So the assertion is
    // the count, plus the absence of the raw lookup in either spot.
    const avatar = code("components/ui/actor-avatar.tsx");
    expect(
      avatar.match(/const name = actorNameText\(resolveActorName\(type, id\)\);/g),
    ).toHaveLength(2);
    expect(avatar).not.toMatch(/const name = getName\(type, id\);/);
    // The initials are only drawn once there is a name to take them from.
    expect(avatar).toMatch(/\{name \? \(\s*<Text/);
  });
});

describe("the actor lookup exposes what the primitive needs", () => {
  const lookup = code("data/use-actor-name.ts");

  it("keeps a settle flag per directory", () => {
    expect(lookup).toMatch(/member: membersRead\.isResolved/);
    expect(lookup).toMatch(/agent: agentsRead\.isResolved/);
    expect(lookup).toMatch(/squad: squadsRead\.isResolved/);
  });

  it("reads the squad directory through catalogRead too", () => {
    // It used to be `const { data: squads = [] } = useQuery(...)`, which is the
    // construct `lib/catalog-read.ts` exists to remove — and without a state
    // there is no way to know whether an empty squad list is an answer.
    expect(lookup).toMatch(/catalogRead\(useQuery\(squadListOptions\(wsId\)\)\)/);
    expect(lookup).not.toMatch(/data: squads = \[\]/);
  });

  it("decides through the tested primitive, not inline", () => {
    expect(lookup).toContain("actorNameState({ type, id, name, readiness: resolvedBy })");
  });
});

describe("the two new user-facing strings exist in both bundles", () => {
  const en = JSON.parse(readFileSync(join(ROOT, "lib/i18n/locales/en.json"), "utf8"));
  const zh = JSON.parse(readFileSync(join(ROOT, "lib/i18n/locales/zh.json"), "utf8"));

  it("names the reading state without naming an actor", () => {
    for (const key of ["issues.swimlane.loadingLane", "issues.boardReadingAssignee"]) {
      expect(en[key], key).toBeTruthy();
      expect(zh[key], key).toBeTruthy();
      // The whole point: neither string may contain a fallback sentinel, or
      // the row would be asserting a name again under a new key.
      expect(en[key]).not.toMatch(/Unknown/);
      expect(zh[key]).not.toMatch(/未知/);
    }
  });

  it("uses one wording for the same state in both surfaces", () => {
    expect(en["issues.swimlane.loadingLane"]).toBe(
      en["issues.boardReadingAssignee"],
    );
    expect(zh["issues.swimlane.loadingLane"]).toBe(
      zh["issues.boardReadingAssignee"],
    );
  });
});
