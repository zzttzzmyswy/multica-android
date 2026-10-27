import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring for iteration 255 (MYS-2219): the four surface families iteration 254's
 * primitive was built for and did not reach — activity timeline, comments, run
 * records, inbox.
 *
 * `lib/actor-name-state.test.ts` locks the DECISION (including the two shapes
 * this round added: the system constant and the folded author line);
 * `lib/actor-name-wiring.test.ts` locks iteration 254's six call sites. This
 * file locks the calling on the surfaces that moved now, because the decision
 * is worthless wherever a component still calls `getName` directly.
 *
 * Source-level assertions are the only route to these components from the Node
 * lane — there is no RN renderer here, the same constraint every
 * `*-wiring.test.ts` in this folder works under.
 */

const ROOT = join(__dirname, "..");
const raw = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Source with line comments stripped, so a `// getName(` in prose does not
 *  count as a call and a commented-out assertion cannot pass for wiring. */
const code = (rel: string) =>
  raw(rel)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

describe("the activity timeline", () => {
  const row = code("components/issue/activity-row.tsx");
  const search = code("lib/activity-search.ts");

  it("draws its actor run through the read-state-aware resolver", () => {
    // The row used to hand `activityRowText` a `getName` wrapper — the exact
    // function that answers 「Unknown」 both while the read is in flight and when
    // the actor is gone.
    expect(row).toContain("const { resolveActorName } = useActorLookup();");
    expect(row).toMatch(/activityRowText\(entry,\s*\{\s*resolveActorName,/);
    expect(row).not.toMatch(/const resolveName = \(/);
  });

  it("paints a load state where the name would be, not a blank", () => {
    // The verb starts with a space, so an omitted name would leave the line
    // reading 「 changed status …」 with an unexplained hole at the head.
    expect(row).toContain("{actorName ? (");
    expect(row).toContain("<Skeleton");
    // …and the skeleton must not enter the accessibility tree as text.
    expect(row).toMatch(/<Skeleton[\s\S]{0,200}accessibilityElementsHidden/);
  });

  it("keeps the search index on the same decision as the render", () => {
    // THE contract this round had to change together with the row: the module
    // docblock says "行画什么，find 索引什么". A resolver typed `=> string` would
    // have to decide "name or nothing" somewhere, and that somewhere is how the
    // two drift apart.
    expect(search).toContain("export type ResolveActorNameState");
    expect(search).toMatch(
      /resolveActorName: ResolveActorNameState;/,
    );
    // The role runs through `actorNameText`, so an unsettled actor is an EMPTY
    // run — which `activityBlockIndex` drops — rather than the fallback word.
    expect(search).toContain(
      "actor: actorNameText(deps.resolveActorName(entry.actor_type, entry.actor_id)),",
    );
    expect(search).not.toMatch(/actor: deps\.resolveActorName\(/);
  });

  it("feeds the issue screen's index the same resolver it draws with", () => {
    // Both consumers must take the resolver from the SAME source, or the two
    // could disagree about which directory they are waiting on.
    const screen = code("app/(app)/[workspace]/issue/[id].tsx");
    expect(screen).toContain("const { resolveActorName } = useActorLookup();");
    // The bundle now also carries the app locale, because a wakeup sentence
    // embeds an absolute instant and the haystack must hold the words the row
    // draws (MYS-2429). Asserted as the presence of all three fields rather
    // than one exact line, so reordering or reformatting stays allowed while
    // DROPPING the locale fails.
    expect(screen).toMatch(/activityBlockIndex\(timeline\.data,\s*\{/);
    expect(screen).toMatch(/activityBlockIndex\(timeline\.data,[\s\S]{0,200}resolveActorName/);
    expect(screen).toMatch(/activityBlockIndex\(timeline\.data,[\s\S]{0,200}statusLabel/);
    expect(screen).toMatch(/activityBlockIndex\(timeline\.data,[\s\S]{0,200}locale: intlLocale/);
    // The memo has to follow the settle flags, which live inside the resolver;
    // depending on `getName`'s old wrapper would have frozen the index at
    // whatever readiness the first render saw. `intlLocale` joined for the same
    // reason: a language switch changes the sentence a wakeup row draws.
    expect(screen).toMatch(
      /\[timeline\.data, resolveActorName, statusLabel, intlLocale\]/,
    );
  });
});

describe("the comment card", () => {
  const card = code("components/issue/comment-card.tsx");

  it("names the author through the primitive, and marks the wait", () => {
    expect(card).toContain(
      "const name = actorNameText(\n    resolveActorName(",
    );
    // The header shows the name and nothing else identifying, so a withheld
    // name gets a mark rather than an empty header.
    expect(card).toMatch(/\{name \? \([\s\S]{0,400}<Skeleton/);
  });

  it("keeps getName out of every visible-text path", () => {
    // Every surface in this file is visible text, so a surviving `getName`
    // call would be a hole in the rule rather than an exception to it. (The
    // table's CSV export and the board's group keys are the legitimate
    // remaining callers, and both live elsewhere.)
    expect(card).not.toMatch(/\bgetName\(/);
  });

  it("joins the folded bars' authors through the tested helper", () => {
    // Both bars, one helper: `.map(...).join(", ")` inline is the construct
    // that produced "Ada, , Grace" and an inflated `+N`.
    expect(card.match(/joinedActorNames\(authors, resolveActorName, MAX_NAMED_AUTHORS\)/g))
      .toHaveLength(2);
    expect(card).not.toMatch(/\.map\(\(a\) =>\s*\n?\s*getName/);
    // Two names is a policy both bars share, so it is one constant.
    expect(card).toContain("const MAX_NAMED_AUTHORS = 2;");
  });

  it("withholds the whole clause when no author can be named", () => {
    // "Resolved · 3 messages by " with nothing after the preposition is not a
    // sentence. A separate key states the same fact without the clause.
    expect(card).toContain('authorsLabel ? "comment.resolvedBar" : "comment.resolvedBarNoAuthors"');
    expect(card).toContain('authorsLabel ? "comment.foldBar" : "comment.foldBarNoAuthors"');
    expect(card).toMatch(
      /authorsLabel\s*\n?\s*\? "comment\.resolvedBarLabel"\s*\n?\s*: "comment\.resolvedBarNoAuthorsLabel"/,
    );
    expect(card).toMatch(
      /authorsLabel \? "comment\.foldBarLabel" : "comment\.foldBarNoAuthorsLabel"/,
    );
  });

  it("does not name the resolver of a thread it cannot read", () => {
    expect(card).toContain(
      "const resolverName = actorNameText(\n    resolveActorName(",
    );
    expect(card).toContain('t("comment.resolvedNoName")');
  });

  it("keeps the fold chevron's label grammatical without the name", () => {
    // "Collapse 's comment" is what the raw template produces for an empty
    // name; the anonymous phrasing is a whole sentence instead.
    expect(card).toContain('t(isFolded ? "comment.expandAria" : "comment.collapseAria", {');
    expect(card).toContain('"comment.collapseAriaNoName"');
    expect(card).toContain('"comment.expandAriaNoName"');
  });
});

describe("the run records wait on the agent directory only", () => {
  const files = [
    "components/issue/run-row.tsx",
    "components/issue/run-timeline-panel.tsx",
    "components/issue/usage-breakdown-dialog.tsx",
  ];

  it("resolve every name as an agent, through the per-type flag", () => {
    // This is the whole reason iteration 254 split readiness per actor type: a
    // run row never draws a member, so gating it on the members read would
    // blank agent names whenever that read is slow — a new way to lose
    // information, introduced by the fix for an older one. `resolvedBy` is the
    // combined-flag shape, so its ABSENCE here is the assertion: a surface that
    // destructures it has started making its own readiness decision instead of
    // taking the hook's per-type one.
    for (const rel of files) {
      const src = code(rel);
      const agentCalls = src.match(/resolveActorName\("agent",/g) ?? [];
      expect(agentCalls.length, rel).toBeGreaterThan(0);
      // No member/squad reference anywhere in these three: if one appeared, it
      // would be reading a directory these surfaces were not built to wait on.
      expect(src, rel).not.toMatch(/resolveActorName\("(?:member|squad)"/);
      expect(src, rel).not.toMatch(/resolvedBy/);
      expect(src, rel).toContain("const { resolveActorName } = useActorLookup();");
      expect(src, rel).not.toMatch(/\bgetName\(/);
    }
  });

  it("state no fallback name of their own", () => {
    // The resolver is the only thing allowed to decide that a name may be
    // shown; a literal sentinel beside it is a second decision, and the one a
    // reader actually sees. `getName`'s wording must not reappear in any of
    // these files — not through the lookup, and not typed out.
    for (const rel of files) {
      expect(code(rel), rel).not.toMatch(/Unknown/);
    }
  });

  it("does not put a load mark inside a sentence", () => {
    // Each of these names sits inline at the head of a clause. RN does not
    // render a View inside a Text predictably, and a mark mid-sentence would
    // tear the clause apart — so the name and its separator are withheld
    // together, which is why the inline sites go through `actorNameText`.
    const row = code("components/issue/run-row.tsx");
    expect(row).toContain(
      'const agentName = actorNameText(resolveActorName("agent", task.agent_id));',
    );
    expect(row).toContain("{agentName ? (");
    expect(row).not.toContain("<Skeleton");

    // The readout joins its parts; an empty first element would draw a leading
    // " · " before the timestamp.
    const panel = code("components/issue/run-timeline-panel.tsx");
    expect(panel).toContain(".filter((part) => part.length > 0)");
    expect(panel).not.toMatch(/\[getName\("agent", run\.task\.agent_id\), \.\.\.facts\]/);

    // The cost bar's label column keeps its measured width while the name is
    // withheld, so the bar next to it does not reflow when the read lands.
    const usage = code("components/issue/usage-breakdown-dialog.tsx");
    expect(usage).toContain('<View className="w-24">');
    expect(usage).toContain("<ActorNameText");
    // The usage card's header is the third inline site: name and separator go
    // together there for the same reason as the run row.
    expect(usage).toContain("{agentName ? (");
  });
});

describe("the inbox detail line", () => {
  const label = code("components/inbox/detail-label.tsx");

  it("does not drop a name into a sentence from an unread directory", () => {
    // `inbox.assignedTo` is "Assigned to {{name}}" — a name nested mid-sentence.
    expect(label).toContain("actorNameText(");
    expect(label).toContain(
      'return name ? t("inbox.assignedTo", { name }) : typeLabel(t, item.type);',
    );
  });

  it("withholds the clause instead of marking it", () => {
    // A skeleton would have to go INSIDE the template, between "to" and the end
    // of the sentence. So the whole clause is withheld and the row falls back
    // to the item-type label, which is a complete statement on its own.
    expect(label).not.toContain("<Skeleton");
    expect(label).not.toMatch(/\bgetName\(/);
    // …and no sentinel of its own either: `getName`'s wording reappearing as a
    // literal is the same claim under a different spelling.
    expect(label).not.toMatch(/Unknown/);
  });
});

describe("the issue table's group band", () => {
  const table = code("components/issue/table-view.tsx");

  it("names the assignee group through the primitive", () => {
    expect(table).toContain(
      "actorNameText(resolveActorName(value.actor.type, value.actor.id))",
    );
    // A band with no name is the group's ONLY label, so it gets the same
    // neutral reading mark the board and swimlane headers use rather than
    // going blank.
    expect(table).toContain('t("issues.boardReadingAssignee")');
  });

  it("leaves the group KEY on a plain string", () => {
    // `groupActorName` feeds `buildIssueTableDisplayRows`' bucket key and the
    // export path. An empty string there would collapse every unresolved
    // assignee into one group, and the export would lose its names.
    expect(table).toContain(
      "const groupActorName = useCallback(\n    (actor: IssueTableGroupActor) => getName(actor.type, actor.id),",
    );
  });

  it("keeps the CSV export's own sentinel filter", () => {
    // Different contract: a file cannot hold a skeleton, so the export drops
    // the fallbacks itself and falls through to a blank cell.
    expect(table).toMatch(/const actorName = useCallback\([\s\S]{0,400}name === "System"/);
  });
});

describe("a platform-authored row is still nameable", () => {
  // The trap in wiring ANY surface to the primitive: `system` is not one of the
  // three directories, so `isActorTypeResolved` answers false for it — forever.
  // Every platform notice (a child-done comment, a failed-run report) would
  // lose its author name. `resolveActorName` short-circuits before the
  // readiness check.
  const lookup = code("data/use-actor-name.ts");

  it("resolves system to a constant before consulting readiness", () => {
    expect(lookup).toContain('if (type === "system") return SYSTEM_ACTOR_STATE;');
    expect(lookup).toContain("SYSTEM_ACTOR_STATE");
  });
});

describe("the strings the new branches render exist in both bundles", () => {
  const en = JSON.parse(raw("lib/i18n/locales/en.json"));
  const zh = JSON.parse(raw("lib/i18n/locales/zh.json"));

  const KEYS = [
    "comment.collapseAriaNoName",
    "comment.expandAriaNoName",
    "comment.foldBarNoAuthors",
    "comment.foldBarNoAuthorsLabel",
    "comment.resolvedBarNoAuthors",
    "comment.resolvedBarNoAuthorsLabel",
    "comment.resolvedNoName",
  ];

  it("has every key in en and zh", () => {
    for (const key of KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(zh[key], key).toBeTruthy();
    }
  });

  it("states a count without naming anyone", () => {
    // The whole point of the author-less variants: they must not smuggle a
    // fallback sentinel back in under a new key.
    for (const key of KEYS) {
      expect(en[key], key).not.toMatch(/Unknown/);
      expect(zh[key], key).not.toMatch(/未知/);
    }
    for (const key of [
      "comment.foldBarNoAuthors",
      "comment.resolvedBarNoAuthors",
    ]) {
      expect(en[key], key).not.toMatch(/\{\{authors\}\}/);
      expect(zh[key], key).not.toMatch(/\{\{authors\}\}/);
    }
  });

  it("keeps the count placeholders the call sites pass", () => {
    // A missing placeholder renders as literal "{{count}}" on a phone.
    for (const key of [
      "comment.foldBarNoAuthors",
      "comment.foldBarNoAuthorsLabel",
      "comment.resolvedBarNoAuthors",
      "comment.resolvedBarNoAuthorsLabel",
    ]) {
      expect(en[key], key).toContain("{{count}}");
      expect(en[key], key).toContain("{{messageCount}}");
      expect(zh[key], key).toContain("{{count}}");
      expect(zh[key], key).toContain("{{messageCount}}");
    }
  });

  it("reuses the reading mark the other headers already show", () => {
    // One wording for one state across the table band, the board column and
    // the swimlane lane — a fourth spelling would read as a fourth condition.
    expect(en["issues.swimlane.loadingLane"]).toBe(
      en["issues.boardReadingAssignee"],
    );
    expect(zh["issues.swimlane.loadingLane"]).toBe(
      zh["issues.boardReadingAssignee"],
    );
  });
});

describe("the issue-detail attribute chips", () => {
  // Found on the device, not in review: the blocked arm still printed
  // 「Unknown Agent」 in the header's assignee chip after every surface above
  // was wired. The chip took `label: string`, so its only options were a name
  // it did not have or `attr.unknown` — which spells the same word.
  const chip = code("components/issue/attribute-chip.tsx");
  const row = code("components/issue/attribute-row.tsx");
  const createRow = code("components/issue/create-form-attribute-row.tsx");
  const propertyRow = code("components/issue/custom-property-row.tsx");

  it("lets a chip withhold its label instead of forcing a string", () => {
    // `label: string` was the whole bug: a caller holding an unresolved actor
    // had to choose between the fallback and a blank.
    expect(chip).toContain("label: string | null;");
    expect(chip).toContain("{label === null ? (");
    expect(chip).toMatch(/<Skeleton[\s\S]{0,200}accessibilityElementsHidden/);
  });

  it("stops the assignee chip from saying attr.unknown", () => {
    // 「Unknown」 and the lookup's own fallback are the same claim in two
    // spellings; the client had not read the directory, so it may say neither.
    expect(row).toContain("actorNameText(resolveActorName(");
    expect(row).not.toContain('t("attr.unknown")');
    expect(row).not.toMatch(/\bgetName\(/);
  });

  it("states no fallback name of its own on any of the three chips", () => {
    // A literal sentinel beside the resolver is a second decision — and the one
    // the reader sees. `attr.unknown` was exactly that: the lookup's 「Unknown」
    // under an i18n key, printed as though the directory had answered.
    for (const [rel, src] of [
      ["components/issue/attribute-row.tsx", row],
      ["components/issue/create-form-attribute-row.tsx", createRow],
      ["components/issue/custom-property-row.tsx", propertyRow],
    ] as const) {
      expect(src, rel).not.toMatch(/Unknown/);
    }
  });

  it("does the same for the new-issue draft's chip", () => {
    expect(createRow).toContain(
      "actorNameText(resolveActorName(assignee.type, assignee.id)) || null",
    );
    expect(createRow).not.toMatch(/\bgetName\(/);
  });

  it("keeps an actor custom property's chip from printing a fallback", () => {
    expect(propertyRow).toContain("actorNameText(resolveActorName(ref.kind, ref.id))");
    // No empty segment between two commas, and `null` when nothing is readable.
    expect(propertyRow).toContain(".filter(Boolean)");
    expect(propertyRow).toContain('.join(", ") || null');
    expect(propertyRow).not.toMatch(/\bgetName\(/);
  });
});
