import { describe, expect, it } from "vitest";
import type {
  RuntimeLocalSkillSummary,
  SkillSummary,
} from "@multica/core/types";
import {
  runtimeSkillSelection,
  skillDetailTitle,
  skillDetailView,
  workspaceSkillSelection,
} from "./agent-skill-detail";

const RUNTIME_SKILL: RuntimeLocalSkillSummary = {
  key: "pdf-tools",
  name: "pdf-tools",
  description: "Work with PDFs",
  source_path: "/home/u/.claude/skills/pdf-tools",
  provider: "claude",
  root: "provider",
  file_count: 4,
};

const WORKSPACE_SKILL = {
  id: "sk-1",
  name: "review",
  description: "",
  content: "# Review\n",
  files: [],
} as unknown as SkillSummary;

describe("selection", () => {
  it("a workspace skill opens by id (its detail is a read)", () => {
    expect(workspaceSkillSelection(WORKSPACE_SKILL)).toEqual({
      kind: "workspace",
      id: "sk-1",
    });
  });

  it("a workspace skill with no id opens nothing", () => {
    // Guards `/api/skills/undefined`, whose 404 would render as "deleted".
    expect(
      workspaceSkillSelection({ ...WORKSPACE_SKILL, id: "" } as SkillSummary),
    ).toBeNull();
  });

  it("a runtime skill opens from the summary it already carries", () => {
    // No workspace id exists for these — the discovery key is not a skill id,
    // so nothing must be fetched.
    const selection = runtimeSkillSelection(RUNTIME_SKILL);
    expect(selection).toEqual({ kind: "runtime", skill: RUNTIME_SKILL });
  });

  it("a nullish runtime skill opens nothing", () => {
    expect(runtimeSkillSelection(null)).toBeNull();
    expect(runtimeSkillSelection(undefined)).toBeNull();
  });
});

describe("skillDetailView", () => {
  it("returns null with no selection", () => {
    expect(skillDetailView(null, { state: "loading" })).toBeNull();
  });

  it("a runtime selection renders its own fields and issues no read", () => {
    // The read state is deliberately 'failed' here: a runtime skill must not
    // depend on the workspace read at all.
    const view = skillDetailView(runtimeSkillSelection(RUNTIME_SKILL), {
      state: "failed",
    });
    expect(view).toEqual({
      kind: "runtime",
      sourcePath: "/home/u/.claude/skills/pdf-tools",
      provider: "claude",
      plugin: null,
      fileCount: 4,
    });
  });

  it("carries a runtime skill's plugin when the daemon reported one", () => {
    const view = skillDetailView(
      runtimeSkillSelection({ ...RUNTIME_SKILL, plugin: "pdf-pack" }),
      { state: "loading" },
    );
    expect(view).toMatchObject({ kind: "runtime", plugin: "pdf-pack" });
  });

  it("a workspace selection still loading is a spinner, not empty content", () => {
    // The MYS-1908 line: an unanswered read may not be rendered as absence.
    expect(
      skillDetailView(workspaceSkillSelection(WORKSPACE_SKILL), {
        state: "loading",
      }),
    ).toEqual({ kind: "workspace-loading" });
  });

  it("a failed workspace read is a named failure, not empty content", () => {
    expect(
      skillDetailView(workspaceSkillSelection(WORKSPACE_SKILL), {
        state: "failed",
      }),
    ).toEqual({ kind: "workspace-error" });
  });

  it("a ready workspace read renders its content and files", () => {
    const view = skillDetailView(workspaceSkillSelection(WORKSPACE_SKILL), {
      state: "ready",
      skill: {
        content: "# Review\n",
        files: [{ id: "f1", path: "notes.md" }],
      },
    });
    expect(view).toEqual({
      kind: "workspace",
      content: "# Review\n",
      files: [{ id: "f1", path: "notes.md" }],
    });
  });

  it("keeps an empty SKILL.md as content, not as a spinner", () => {
    // An empty SKILL.md is legal. Collapsing it into the loading state would
    // spin forever on a real skill.
    const view = skillDetailView(workspaceSkillSelection(WORKSPACE_SKILL), {
      state: "ready",
      skill: { content: "", files: [] },
    });
    expect(view).toEqual({ kind: "workspace", content: "", files: [] });
  });

  it("defaults a missing files array to empty", () => {
    const view = skillDetailView(workspaceSkillSelection(WORKSPACE_SKILL), {
      state: "ready",
      skill: { content: "x" },
    });
    expect(view).toMatchObject({ kind: "workspace", files: [] });
  });
});

describe("skillDetailTitle", () => {
  it("prefers the runtime skill's own name", () => {
    expect(
      skillDetailTitle(runtimeSkillSelection(RUNTIME_SKILL), "other", "fallback"),
    ).toBe("pdf-tools");
  });

  it("uses the workspace skill's name when it has one", () => {
    expect(
      skillDetailTitle(workspaceSkillSelection(WORKSPACE_SKILL), "review", "fallback"),
    ).toBe("review");
  });

  it("falls back when the workspace name is not known yet", () => {
    // A read that has not answered must not title the sheet with a blank.
    expect(
      skillDetailTitle(workspaceSkillSelection(WORKSPACE_SKILL), null, "技能详情"),
    ).toBe("技能详情");
  });

  it("falls back with no selection at all", () => {
    expect(skillDetailTitle(null, "x", "技能详情")).toBe("技能详情");
  });
});
