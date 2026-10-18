import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring for iteration 257 (MYS-2228): the seven `getName` call sites that fed
 * a name into an i18n TEMPLATE.
 *
 * `lib/wakeup-sentence-withhold.test.ts` locks the sentence-level decision and
 * `lib/inbox-archive-view.test.ts` locks the archive rows' label/order split.
 * This file locks the calling — a decision is worth nothing at a site that
 * still reads the raw lookup, and these seven are components, which the Node
 * lane cannot render (`vitest.config.ts`).
 *
 * The count matters as much as the content: the round's acceptance is that
 * "`getName(...)` handed straight to an i18n parameter" reaches ZERO. The last
 * test below asserts that over the whole app rather than over the seven files,
 * so a NEW site of the same shape fails here instead of shipping.
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

const WAKEUPS_SECTION = "components/issue/wakeups-section.tsx";
const HEADER_BADGE = "components/issue/issue-wakeup-header-badge.tsx";
const WORKSPACE_CONTROLLER = "lib/use-workspace-wakeups.ts";
const CREATE_SHEET = "components/issue/wakeup-create-sheet.tsx";
const RUN_HINT = "components/issue/create-run-hint.tsx";
const NEW_ISSUE = "app/(app)/[workspace]/new-issue.tsx";
const ARCHIVE_SHEET = "components/inbox/inbox-archive-filter-sheet.tsx";

describe("the three ASSERTION sentences", () => {
  /** Every bundle that reads a wakeup rule back from the server. */
  const ASSERT_SITES = [
    WAKEUPS_SECTION,
    HEADER_BADGE,
    WORKSPACE_CONTROLLER,
  ] as const;

  for (const rel of ASSERT_SITES) {
    it(`${rel} feeds the read-state resolver, not the raw lookup`, () => {
      const src = code(rel);
      expect(src).toContain("resolveActorName");
      // The old wrapper: `getName` narrowed to agents and coerced back to a
      // string, which is exactly the type that cannot represent "not read yet".
      expect(src).not.toMatch(/actorName:\s*\(type[^)]*\)\s*=>\s*getName\(/);
      expect(src).not.toMatch(/\bgetName\(type as "agent", id\)/);
    });
  }

  it("does not mark any assertion bundle as an echo", () => {
    // The context flag is what selects "retreat" over "noun". An assertion
    // surface that opted into echo would name a type where it has no evidence
    // even of the type.
    for (const rel of ASSERT_SITES) {
      expect(code(rel), rel).not.toContain('actorNameContext: "echo"');
    }
  });
});

describe("the three ECHO sites", () => {
  it("the create sheet's picker labels echo instead of withholding", () => {
    const src = code(CREATE_SHEET);
    expect(src).toContain('actorNameContext: "echo"');
    expect(src).not.toMatch(/actorName:\s*\(type, id\)\s*=>\s*getName\(/);
  });

  it("the run caption degrades to a type noun", () => {
    const src = code(RUN_HINT);
    // `selectedActorLabel` is the primitive that never returns an empty string
    // for a set-but-unread selection.
    expect(src).toContain("selectedActorLabel({");
    expect(src).toContain("resolveActorName(assigneeType ?? \"agent\", assigneeId)");
    expect(src).not.toMatch(/\bgetName\(/);
    // The two captions have different subjects, so the fallback has to follow
    // the assignment TYPE rather than being one noun for both.
    expect(src).toContain('assigneeType === "squad" ? t("picker.squad") : t("picker.agent")');
  });

  it("the sent confirmation names a type noun rather than opening a hole", () => {
    const src = code(NEW_ISSUE);
    expect(src).toContain("selectedActorLabel({");
    expect(src).toContain("resolveActorName(agentActor.type, agentActor.id)");
    expect(src).not.toMatch(/\bgetName\(/);
    // The dialog's sentence cannot read 「handed to .」.
    expect(src).toContain('agentActor.type === "squad"');
  });

  it("keeps the caption and the confirmation on ONE primitive", () => {
    // They describe the same choice one tap apart; two decisions could
    // disagree, and the user would read both.
    for (const rel of [RUN_HINT, NEW_ISSUE] as const) {
      expect(code(rel), rel).toContain("selectedActorLabel(");
    }
  });
});

describe("the archive filter's label / sort-key split", () => {
  it("takes its rows from the tested helper", () => {
    const src = code(ARCHIVE_SHEET);
    expect(src).toContain("archivedActorFilterRows({");
    expect(src).toContain("readiness: resolvedBy");
    // No local map/sort over the actor keys: that is the shape whose order
    // followed the (withholdable) label.
    expect(src).not.toMatch(/\.sort\(\(a, b\) => a\.name\.localeCompare/);
  });

  it("draws a load mark instead of a name it may not state", () => {
    const src = code(ARCHIVE_SHEET);
    expect(src).toContain("label === null ?");
    expect(src).toMatch(/<Skeleton[\s\S]{0,200}accessibilityElementsHidden/);
  });

  it("gives the unread row an accessibility name of its own", () => {
    // A checkbox that announced only 「, 12」 would not say what it filters. The
    // visible text is withheld; the announcement falls back to the section.
    const src = code(ARCHIVE_SHEET);
    expect(src).toContain(
      'unreadAccessibilityName: t("inbox.archivedFiltersFrom")',
    );
    expect(src).toContain(
      'accessibilityLabel={`${label ?? unreadAccessibilityName ?? ""}, ${count}`}',
    );
  });

  it("keeps announcing the ACTOR once there is one", () => {
    // The fallback must be a fallback, not a replacement: `label ?? …` reads
    // the name first. This was a real defect caught on the device — the first
    // version put the override ahead of the label, so every settled row
    // announced 「来自, 118」 and a screen-reader user lost the actor entirely.
    const src = code(ARCHIVE_SHEET);
    expect(src).not.toMatch(/accessibilityLabel=\{`\$\{unreadAccessibilityName/);
  });
});

describe("the dep's CONTRACT", () => {
  /**
   * The load-bearing half of this round is a TYPE, not a branch: as long as
   * `WakeupTextDeps.actorName` returns `string`, the "may I say this name yet"
   * decision is necessarily made at each of the five call sites that build the
   * bundle — and that is the drift `lib/actor-name-state.ts` exists to retire.
   *
   * A type change cannot fail a runtime suite (`tsc` catches it; vitest does
   * not), so it is pinned textually here, the same way every `*-wiring.test.ts`
   * in this folder pins a shape it cannot execute.
   */
  const presentation = code("lib/wakeup-presentation.ts");

  it("carries a three-state decision rather than a string", () => {
    expect(presentation).toContain(
      "actorName?: (type: string, id: string) => ActorNameState;",
    );
    expect(presentation).not.toMatch(
      /actorName\?:\s*\(type: string, id: string\)\s*=>\s*string;/,
    );
  });

  it("branches on `unsettled` rather than on an empty string", () => {
    // A `=== ""` test would be a second sentinel convention beside the one
    // `actorNameState` already defines.
    expect(presentation).toContain('if (state.kind === "unsettled")');
    expect(presentation).not.toMatch(/actorName\([^)]*\)\s*===\s*""/);
  });

  it("declares which vocabulary an unsettled sentence uses", () => {
    // `actorNameContext` is what separates "retreat" from "type noun"; without
    // a declared default, one of the two voices would be whatever the reader
    // of the call site assumed.
    expect(presentation).toContain("actorNameContext?: ActorNameContext;");
  });
});

describe("the avatar placeholder is not an assertion", () => {
  /**
   * Iteration 257's secondary item. `getAvatarUrl` reads the same directory as
   * `getName`, so it is the same family — but it is NOT a visible-text
   * assertion and deliberately did not join this round's must-fix list. The
   * issue asked for that reading to be confirmed rather than assumed, and for
   * the finding to be pinned so it cannot silently decay into an assertion.
   *
   * Why it is not one: every branch of the placeholder — the initials disc,
   * the squad glyph, the system cog — is drawn from `resolveActorName` and an
   * empty name yields an EMPTY disc (`{name ? <Text>…</Text> : null}`), never a
   * word. Nothing anywhere renders "this actor has no avatar": the copy a
   * reader can reach is `profileCard.title` (「资料」/「Profile」), a section
   * name, not a claim about the actor.
   */
  const avatar = code("components/ui/actor-avatar.tsx");

  it("draws no word when the name is unknown", () => {
    expect(avatar).toMatch(/\{name \? \(\s*<Text/);
    expect(avatar).not.toContain("getInitials(getName");
  });

  it("falls back to a section name, not to a no-avatar claim", () => {
    expect(avatar).toContain('t("profileCard.title")');
    for (const claim of [
      "profileCard.noAvatar",
      "profileCard.unknownActor",
      "profileCard.noName",
    ]) {
      expect(avatar, claim).not.toContain(claim);
    }
  });
});

describe("the family is cleared app-wide", () => {
  /** The six sites whose `getName` fed a template directly. */
  const TEMPLATE_SITES = [
    "app/(app)/[workspace]/new-issue.tsx",
    "components/issue/wakeups-section.tsx",
    "components/issue/issue-wakeup-header-badge.tsx",
    "components/issue/wakeup-create-sheet.tsx",
    "components/issue/create-run-hint.tsx",
    "lib/use-workspace-wakeups.ts",
  ] as const;

  it("leaves no `getName` at the six template sites", () => {
    for (const rel of TEMPLATE_SITES) {
      expect(code(rel), rel).not.toMatch(/\bgetName\(/);
    }
  });

  it("allows the raw lookup at the archive sheet only as the decision's INPUT", () => {
    // `getName` is not forbidden outright — it is the raw map lookup, and the
    // read-state decision needs raw rows to decide about. What is forbidden is
    // letting its answer REACH the screen. Here it may appear exactly once, as
    // the `nameOf` adapter `archivedActorFilterRows` consults; the helper then
    // decides whether the answer may be said.
    const src = code(ARCHIVE_SHEET);
    const uses = src.match(/\bgetName\(/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(src).toMatch(
      /nameOf: \(type, id\) =>\s*getName\(type as "member" \| "agent" \| "squad", id\)/,
    );
  });
});
