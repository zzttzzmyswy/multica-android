/**
 * The skills-list row-action gates (iteration 230, MYS-2097) — the mobile port
 * of web's `SkillRowActions` menu (`packages/views/skills/components/
 * skill-list-actions.tsx:537-614`).
 *
 * Each case below is a rule a plausible edit silently changes. The two that
 * matter most are the ones the round's own issue text got wrong before the web
 * source was read:
 *
 *   - `add_to_agent` is UNCONDITIONAL, so a member who cannot edit a skill
 *     still gets a menu (they may attach it to an agent they own). Hiding the
 *     whole kebab when `!canEdit` would drop a capability web grants.
 *   - `refresh` needs BOTH `canEdit` and a hosted origin WITH a `source_url`:
 *     `canEdit` alone offers a re-download for a manual skill that has no
 *     upstream, and the origin test alone offers one the server will reject.
 */
import { describe, expect, it } from "vitest";
import type { SkillSummary } from "@multica/core/types";
import { canRefreshSkill, skillRowActions } from "./skill-row-actions";
import type { SkillRow } from "./filter-skills";
import { readOrigin } from "./skill-guards";

function row(
  config: unknown,
  canEdit: boolean,
  overrides: Partial<SkillSummary> = {},
): SkillRow {
  return {
    skill: {
      id: "s1",
      name: "brainstorming",
      description: null,
      config,
      created_by: "u1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      ...overrides,
    } as unknown as SkillSummary,
    agents: [],
    creator: null,
    originType: readOrigin({ config } as unknown as SkillSummary).type,
    canEdit,
  };
}

const GITHUB = {
  origin: {
    type: "github",
    source_url: "https://github.com/obra/superpowers/tree/main/skills/brainstorming",
  },
};

describe("skillRowActions", () => {
  it("offers add-to-agent for every row, editable or not", () => {
    // Attaching is gated by the TARGET agent (its owner, or a workspace
    // admin), never by edit rights on the skill — so a read-only member must
    // still get this entry. Web's kebab is never empty for the same reason.
    for (const canEdit of [true, false]) {
      expect(skillRowActions(row(GITHUB, canEdit))).toContain("add-to-agent");
      expect(skillRowActions(row(undefined, canEdit))).toContain(
        "add-to-agent",
      );
    }
  });

  it("offers refresh on a hosted origin the viewer may edit", () => {
    expect(skillRowActions(row(GITHUB, true))).toEqual([
      "add-to-agent",
      "refresh",
      "delete",
    ]);
  });

  it("withholds refresh from a member who may not edit the skill", () => {
    // Refreshing replaces SKILL.md and the whole file set, so it is an edit.
    expect(canRefreshSkill(row(GITHUB, false))).toBe(false);
    expect(skillRowActions(row(GITHUB, false))).toEqual(["add-to-agent"]);
  });

  it("withholds refresh from a manual skill, even for an editor", () => {
    // No origin at all: nothing upstream to re-download.
    expect(canRefreshSkill(row(undefined, true))).toBe(false);
    // An explicit manual origin reads the same way.
    expect(canRefreshSkill(row({ origin: { type: "manual" } }, true))).toBe(
      false,
    );
  });

  it("withholds refresh from a runtime-local skill", () => {
    // Runtime-local copies re-import through the daemon, not a URL; web's
    // `isRefreshableOrigin` excludes them, and the server does too.
    expect(
      canRefreshSkill(
        row({ origin: { type: "runtime_local", runtime_id: "r1" } }, true),
      ),
    ).toBe(false);
  });

  it("withholds refresh from a GitHub skill with no source_url", () => {
    // The deployment's 18 GitHub skills all carry one (measured), but a
    // github-typed origin without a URL has nothing to fetch — web requires a
    // non-empty `source_url` and so does `isRefreshableOrigin`.
    expect(
      canRefreshSkill(row({ origin: { type: "github" } }, true)),
    ).toBe(false);
    expect(
      canRefreshSkill(row({ origin: { type: "github", source_url: "" } }, true)),
    ).toBe(false);
  });

  it("accepts the other two hosted origins", () => {
    // skills_sh and clawhub are hosted sources too — web's check is a
    // three-way union, and dropping either would take refresh away from those
    // rows.
    for (const type of ["skills_sh", "clawhub"]) {
      expect(
        canRefreshSkill(
          row({ origin: { type, source_url: "https://example.com/s" } }, true),
        ),
      ).toBe(true);
    }
  });

  it("puts delete last, where web's separator sits", () => {
    // Menu order is user-visible: web separates the destructive entry from the
    // rest, so a reordering that moves delete into the middle is a change to
    // what the sheet reads like.
    const actions = skillRowActions(row(GITHUB, true));
    expect(actions[actions.length - 1]).toBe("delete");
  });

  it("gates delete on canEdit alone", () => {
    expect(skillRowActions(row(GITHUB, false))).not.toContain("delete");
    // …and not on refreshability: a manual skill the viewer owns is deletable.
    expect(skillRowActions(row(undefined, true))).toEqual([
      "add-to-agent",
      "delete",
    ]);
  });
});
