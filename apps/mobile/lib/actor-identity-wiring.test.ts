import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring for iteration 256 (MYS-2227): the read-state primitive reaches the
 * surfaces that print an identity as a PROPERTY VALUE, and the pickers that
 * echo a value the user just picked get a decision of their own.
 *
 * Iterations 254 and 255 wired cells and lines. What was left were two shapes
 * the earlier rounds could not serve with one rule:
 *
 *   - a **detail page's property row** ("Owner", "Installed by", "Leader",
 *     "Subscribers"), where the actor is the row's VALUE and there is no cell
 *     machinery to hang a `state` on;
 *   - a **picker's echo**, where the same string is not a claim about a
 *     directory at all — the user picked it one tap ago — and withholding it is
 *     the bug, not the fix.
 *
 * `lib/actor-name-state.test.ts` locks both decisions. This file locks the
 * calling, because a decision nobody calls fixes nothing. Source-level
 * assertions are the only route to these components from the Node lane.
 */

const ROOT = join(__dirname, "..");
const raw = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Source with line comments stripped, so `// getName(` in prose does not
 *  count as a call and a commented-out assertion cannot pass for wiring. */
const code = (rel: string) =>
  raw(rel)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

describe("identity printed as a property value", () => {
  it("the agent detail page's owner row", () => {
    const page = code("app/(app)/[workspace]/more/agents/[id].tsx");
    expect(page).not.toMatch(/getName\("member", agent\.owner_id\)/);
    expect(page).toContain(
      'state={resolveActorName("member", agent.owner_id)}',
    );
    // Owner is always a user id, so the AGENT directory has nothing to answer
    // for here. Using the combined `resolved` flag would blank this row
    // whenever the agent list is slow — the regression the per-type flag
    // exists to prevent, and one a warm cache hides completely.
    expect(page).not.toMatch(/resolved\b(?!By)/);
  });

  it("the integrations card's installer row", () => {
    const page = code("app/(app)/[workspace]/more/agents/[id]/integrations.tsx");
    expect(page).not.toMatch(/getName\("member", install\.installer_user_id\)/);
    expect(page).toContain(
      'resolveActorName("member", install.installer_user_id)',
    );
    // An empty value and an unread one are different facts: the row's
    // existing "—" means "this installation has no installer", so the
    // unsettled case must not reach it. Hence a dedicated `pending` prop.
    expect(page).toContain("pending={installer.kind === \"unsettled\"}");
    expect(page).toMatch(/pending\?: boolean;/);
    // …and the decision is taken ONCE, so the text and the flag cannot
    // disagree inside one render.
    expect(page).toContain(
      'const installer = resolveActorName("member", install.installer_user_id);',
    );
    expect(page).toContain("value={actorNameText(installer)}");
  });

  it("the autopilot detail page's three actor rows, each on its own type", () => {
    const page = code("app/(app)/[workspace]/more/autopilots/[id].tsx");
    // Assignee: agent OR squad (AutopilotAssigneeType), so the resolver's own
    // per-type readiness picks the right directory.
    expect(page).toContain(
      "state={resolveActorName(\n              autopilot.assignee_type,\n              autopilot.assignee_id,\n            )}",
    );
    // Subscribers and collaborators are members only.
    expect(page).toContain('state={resolveActorName("member", s.user_id)}');
    expect(page).toContain('state={resolveActorName("member", c.user_id)}');
    // Nothing on this page names an actor through the raw lookup any more.
    expect(page).not.toMatch(/\{getName\(/);
  });

  it("the squads list's leader line", () => {
    const page = code("app/(app)/[workspace]/more/squads.tsx");
    expect(page).not.toMatch(/leaderName=\{getName\("agent", item\.leader_id\)\}/);
    expect(page).toContain(
      'leaderName={resolveActorName("agent", item.leader_id)}',
    );
    // The prop carries the STATE, not a string: a squad's leader is the only
    // thing that names the sub-line, and an empty string there reads as "this
    // squad has no leader" rather than "the agents have not loaded".
    expect(page).toContain("leaderName: ActorNameState;");
    expect(page).toContain("<ActorNameText\n              state={leaderName}");
  });

  it("the run transcript header names the agent it ran as", () => {
    const dialog = code("components/agent/run-transcript-dialog.tsx");
    expect(dialog).not.toMatch(/\{getName\("agent", task\.agent_id\)\}/);
    expect(dialog).toContain(
      'state={resolveActorName("agent", task.agent_id)}',
    );
  });

  it("the working-agents roster names each agent", () => {
    const roster = code("components/issue/working-agents-roster.tsx");
    expect(roster).not.toMatch(/\{getName\("agent", agent\.id\)\}/);
    expect(roster).toContain('state={resolveActorName("agent", agent.id)}');
  });

  it("the project detail page's lead row", () => {
    const section = code("components/project/project-properties-section.tsx");
    expect(section).not.toMatch(/getName\(project\.lead_type, project\.lead_id\)/);
    // Reuses the tested decision the projects LIST already uses, rather than
    // inventing a second three-state rule for the same field.
    expect(section).toContain("projectLeadCell({");
    expect(section).toContain(
      'catalogsResolved: isActorTypeResolved(resolvedBy, project.lead_type),',
    );
    // Pending draws a load mark; `none` keeps 「未指派」, which measures the
    // project's own field. The avatar follows `none` ALONE — swapping it for
    // the placeholder would claim there is no lead.
    expect(section).toContain('leadCell.kind === "pending" ? (');
    expect(section).toContain("<Skeleton");
    expect(section).toContain("{leadKnown ? leadCell.name : t(\"picker.unassigned\")}");
  });
});

describe("a section header names an actor but cannot be blank", () => {
  const chrome = code("components/issue/issue-surface-chrome.tsx");

  it("withholds the name and keeps the header labelled", () => {
    expect(chrome).not.toMatch(
      /\{getName\(section\.assigneeType, section\.assigneeId\)\}/,
    );
    expect(chrome).toContain(
      "resolveActorName(section.assigneeType, section.assigneeId)",
    );
    // A blank lane title reads as a rendering fault and a skeleton would
    // change the row's height, so the unsettled case takes the same neutral
    // reading mark the board and swimlane headers already use.
    expect(chrome).toContain('t("issues.boardReadingAssignee")');
  });

  it("leaves the grouping key where it was — on ids", () => {
    // The lane key comes from the issue rows (`assigneeGroupKey` →
    // `"type:id"`), never from this text. Asserting it here is what makes the
    // withhold safe: if the key ever followed the label, two lanes could merge
    // or swap places as directories answered.
    const groups = code("lib/filter-issues.ts");
    expect(groups).toContain("key: `${issue.assignee_type}:${issue.assignee_id}`");
    expect(groups).not.toMatch(/key:.*getName/);
  });
});

describe("the projects list's lead filter", () => {
  const screen = code("components/project/projects-screen.tsx");

  it("withholds the chip text without touching the count", () => {
    // The decision lives in the pure module so both halves are unit-testable
    // (`lib/lead-filter-options.test.ts` pins "read progress does not change
    // the order"); the screen must consume it rather than re-derive a sort.
    expect(screen).toContain(
      "() => leadFilterOptions(data, resolveActorName),",
    );
    expect(screen).not.toContain("label: getName(type, id),");
    // The count comes from the project rows, not from a directory, so it stays
    // true even while the name is withheld.
    expect(screen).toContain("`(${opt.count})`");
    // Withheld → the chip still renders, with the count and no name.
    expect(screen).toContain("const name = opt.label ?? \"\";");
  });

  it("orders by a key that exists before any name does", () => {
    // Sorting by `label` would reshuffle the chips as directories answer, and
    // on a partial cache it would actively interleave them. The screen must
    // not sort at all — the order is the helper's, settled on `sortKey`.
    expect(screen).not.toMatch(/leadOptions[\s\S]{0,200}\.sort\(/);
    const helper = code("lib/filter-projects.ts");
    expect(helper).toContain("sortKey: value,");
    expect(helper).toContain(
      ".sort((a, b) => a.sortKey.localeCompare(b.sortKey));",
    );
    expect(helper).not.toMatch(/\.sort\(\(a, b\) => a\.label\.localeCompare/);
  });
});

describe("an author's name on a surface that also indexes it", () => {
  it("the thread navigator withholds in the row and in the haystack alike", () => {
    const sheet = code("components/issue/thread-nav-sheet.tsx");
    expect(sheet).not.toMatch(/getName\(\s*entry\.actor_type/);
    // `prepareThreads` folds this value into BOTH the author line and the
    // search haystack. A blank line above an index that still held 「Unknown」
    // would let the query match a word nobody can see — iteration 255's defect,
    // one surface over.
    expect(sheet).toContain("actorNameText(\n            resolveActorName(");
    expect(sheet).toContain("[threads, resolveActorName],");
    // Withheld → the sub-line drops rather than leaving a blank caption.
    expect(sheet).toContain("{authorName ? (");
  });

  it("the deliverables heading falls back to a sentence that names nobody", () => {
    const sheet = code("components/issue/deliverables-overview-sheet.tsx");
    expect(sheet).not.toMatch(/const name = getName\(/);
    expect(sheet).toContain(
      "actorType as \"member\" | \"agent\" | \"squad\" | null | undefined",
    );
    expect(sheet).toContain("const name = actorNameText(resolved);");
    // 「Comment by」 with nothing after it is a dangling preposition; the
    // section's own title is true on its own.
    expect(sheet).toContain("? t(\"deliverables.groupCommentBy\", { name })");
    expect(sheet).toContain('t("deliverables.sectionTitle")');
  });

  it("the comment long-press resolves the author once, for both consumers", () => {
    const menu = code("components/issue/comment-context-menu.tsx");
    expect(menu).not.toMatch(/const authorName = getName\(/);
    expect(menu).toContain("const authorName = actorNameText(");
    // The sheet was opened from a card that drew the author through the
    // primitive, so a second raw lookup could print a different word for the
    // same person in the same breath.
    expect(menu).toContain("resolveActorName,");
    // …and the moderated-delete question drops the name rather than opening a
    // possessive on nothing.
    expect(menu).toContain("isOwn || !authorName");
    // The reply chip keeps its existing generic fallback.
    expect(menu).toContain('actorName: authorName || "comment",');
  });

  it("the source-context preview trusts the frozen name it was captured with", () => {
    const body = code("components/issue/source-context-create-body.tsx");
    // The snapshot's `author.name` is a FACT — the server resolved and froze it
    // — so it is not a read and must not be re-resolved against a live
    // directory that could even disagree with the frozen copy.
    expect(body).not.toContain(
      'c.author.name || getName(c.author.type as "member" | "agent", c.author.id)',
    );
    expect(body).toContain("{c.author.name ? (");
    // The live fallback (a capture that carried no name) does follow the rule.
    expect(body).toContain(
      "state={resolveActorName(\n                        c.author.type as \"member\" | \"agent\",",
    );
  });
});

describe("a picker echoes its own selection instead of withholding it", () => {
  const ECHO_SITES: { file: string; why: string }[] = [
    {
      file: "app/(app)/[workspace]/issue/[id]/picker/assignee.tsx",
      why: "the assign-confirm dialog for a just-picked target",
    },
    {
      file: "components/issue/batch-action-bar.tsx",
      why: "the same dialog for a batch selection",
    },
    {
      file: "components/quick-action/quick-action-form.tsx",
      why: "the form's own assignee field",
    },
    {
      file: "components/issue/quick-create-panel.tsx",
      why: "the panel's seeded/picked agent",
    },
    {
      file: "components/issue/wakeup-create-sheet.tsx",
      why: "the draft's reply-actor / field-value pills",
    },
  ];

  for (const { file, why } of ECHO_SITES) {
    it(`${why} decides through the shared echo function`, () => {
      const src = code(file);
      // One function, not five conditionals: the three-state table has to be
      // the same in every picker or two sheets will disagree about the very
      // value the user carried between them.
      expect(src).toContain("selectedActorLabel({");
      expect(src).not.toMatch(/getName\(\s*assignTarget\?\.type/);
    });
  }

  it("a set selection never borrows the surface's EMPTY prompt", () => {
    // The failure this rules out is subtler than withholding: a picker that
    // echoes 「Choose an agent」 over a value that IS chosen reads as
    // unconfigured immediately after the user configured it. So each echo site
    // branches on emptiness FIRST and hands the echo function a noun.
    const quickCreate = code("components/issue/quick-create-panel.tsx");
    // The set/unset split must still be a branch, not a single call: without
    // it an absent actor would echo 「—」 instead of asking to pick one.
    expect(quickCreate).toMatch(
      /const actorLabel = actor\s*\n\s*\? selectedActorLabel\(/,
    );
    expect(quickCreate).toContain(": t(\"newIssue.agentSelectAgent\");");
    // …and the noun it passes for a SET actor is a different key from the
    // prompt above, so the two states cannot render the same string.
    expect(quickCreate).toContain('fallback: t("picker.agent"),');
    expect(quickCreate).not.toContain(
      'fallback: t("newIssue.agentSelectAgent"),',
    );
  });

  it("the filter chips in the workbench chrome echo too", () => {
    const chrome = code("components/issue/issue-surface-chrome.tsx");
    // A filter chip stands for a value the user picked; a chip that vanished
    // until some directory answered would look like the filter had been
    // cleared.
    expect(chrome).toContain('state: resolveActorName(a.type, a.id),');
    expect(chrome).toContain('state: resolveActorName(c.type, c.id),');
    expect(chrome).not.toMatch(/label: getName\([ac]\.type, [ac]\.id\),/);
  });

  it("the property editor's field keeps its own empty copy", () => {
    const editor = code("components/issue/pickers/property-value-editor.tsx");
    expect(editor).not.toMatch(/\.map\(\(ref\) => getName\(ref\.kind, ref\.id\)\)/);
    // Folded through the SAME helper the collapsed-thread bars use, so the
    // "Ada, , Grace" and "" +3"" defects stay fixed in one place and stay
    // unit-tested in the Node lane rather than only asserted as source text.
    expect(editor).toContain("joinedActorNames(");
    expect(editor).toContain("resolveActorName,");
    // A load mark inside a text field's value reads as an unfilled form; the
    // field's own 「empty」 copy is the honest word while nothing is readable.
    expect(editor).toContain(') || t("properties.value.empty")');
  });
});

describe("what is deliberately NOT converted", () => {
  it("keeps the raw lookup where a stable STRING is the contract", () => {
    // Each of these feeds something other than visible actor identity, and
    // wiring them to a withholding primitive would break that consumer:
    //   - the table's group key and CSV export need one stable string per
    //     bucket (iteration 255 established the split);
    //   - the activity formatter's `resolveActorName` dep is `=> string` and
    //     already folds an empty run away;
    //   - the wakeup preview builders interpolate a name into a sentence the
    //     caller has already gated.
    const table = code("components/issue/table-view.tsx");
    expect(table).toContain("(actor: IssueTableGroupActor) => getName(actor.type, actor.id),");
  });

  it("does not reach for the combined readiness flag", () => {
    // `resolved` is `members && agents`. Every row this round touched names a
    // KNOWN type, so waiting on both directories would blank it for a read it
    // cannot use — and on a warm cache nobody would ever see the bug.
    for (const file of [
      "app/(app)/[workspace]/more/agents/[id].tsx",
      "app/(app)/[workspace]/more/autopilots/[id].tsx",
      "components/issue/working-agents-roster.tsx",
      "components/agent/run-transcript-dialog.tsx",
      "app/(app)/[workspace]/more/squads.tsx",
    ]) {
      const src = code(file);
      expect(src, file).not.toMatch(/const \{[^}]*\bresolved\b[^}]*\} = useActorLookup\(\);/);
    }
  });
});
