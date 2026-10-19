/**
 * Wiring guards for iteration 260 (MYS-2253).
 *
 * Four web-parity gaps were closed by changing call sites, and a call site is
 * exactly where a later refactor can silently undo a fix with no type error
 * and no failing unit test. Each assertion below pins one link in a chain that
 * the pure-function tests cannot see:
 *
 *   1. project create sends `lead_type` + `lead_id` as a PAIR, and only sends
 *      the dates when set;
 *   2. the project description is rendered and edited as MARKDOWN, not as a
 *      plain string;
 *   3. the sub-issue stage is offered only with a parent, is sent only with a
 *      parent, and is read from the ephemeral pick store (never the persisted
 *      draft);
 *   4. the agent detail's two primary actions are mounted and wired to the
 *      chat deep link / agent-mode create form.
 *
 * Source-level (not render-level) on purpose: these are single-line
 * relationships inside large screens that have no other test seam, and the
 * mutation suite (`scripts/falsify-iter260-guards.py`) needs a fast, targeted
 * red signal for each one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(resolve(here, "..", rel), "utf8");

describe("iteration 260 wiring", () => {
  describe("project create: lead + dates", () => {
    const screen = src("app/(app)/[workspace]/project/new.tsx");

    it("sends lead_type and lead_id together", () => {
      // A lone lead_id leaves the server unable to tell a member from an agent.
      expect(screen).toMatch(/lead_type:\s*lead\.type/);
      expect(screen).toMatch(/lead_id:\s*lead\.id/);
    });

    it("omits the lead entirely when none was chosen", () => {
      expect(screen).toMatch(/\.\.\.\(lead\s*\?/);
    });

    it("sends both dates when set", () => {
      expect(screen).toMatch(/start_date:\s*startDate/);
      expect(screen).toMatch(/due_date:\s*dueDate/);
    });

    it("keeps the picked values in the create callback's dependencies", () => {
      // Without these the payload is built from the first render's closure,
      // which had no lead and no dates — the exact bug this round fixes.
      const deps = screen.slice(screen.indexOf("const onCreate = useCallback("));
      const depBlock = deps.slice(deps.indexOf("}, ["), deps.indexOf("]);"));
      for (const dep of ["lead", "startDate", "dueDate"]) {
        expect(depBlock).toContain(dep);
      }
    });

    it("mounts the lead field and wires it to the lead picker", () => {
      // A payload-only fix is invisible: the field has to exist and open the
      // sheet, or the user still cannot set a lead while creating.
      expect(screen).toMatch(/<Field label=\{t\("newProject\.lead"\)\}>/);
      expect(screen).toMatch(/openPicker\("lead"\)/);
    });

    it("no longer claims web hides the lead field", () => {
      // The old header asserted "Lead is intentionally NOT exposed... Web does
      // the same", which contradicted create-project.tsx. A stale rationale is
      // worse than none: it argues against the fix.
      expect(screen).not.toMatch(/Lead is intentionally NOT exposed/);
    });
  });

  describe("project description is markdown", () => {
    const header = src("components/project/project-header-card.tsx");
    const edit = src("app/(app)/[workspace]/project/[id]/edit.tsx");

    it("renders the detail description through the Markdown pipeline", () => {
      expect(header).toMatch(/<Markdown\s+content=\{project\.description\}/);
    });

    it("edits the description with the shared markdown DescriptionField", () => {
      expect(edit).toMatch(/<DescriptionField/);
      expect(edit).toMatch(/description=\{descriptionInput\}/);
    });

    it("does not fall back to a plain textarea for the description", () => {
      // <AutosizeTextArea> here would show stored markdown as source and write
      // it back as literal text.
      expect(edit).not.toMatch(/<AutosizeTextArea/);
    });

    it("turns the mention button off — a project has no mention namespace", () => {
      expect(edit).toMatch(/showMentionButton=\{false\}/);
    });
  });

  describe("sub-issue stage at create time", () => {
    const screen = src("app/(app)/[workspace]/new-issue.tsx");
    const row = src("components/issue/create-form-attribute-row.tsx");
    const store = src("data/stores/new-issue-stage-pick-store.ts");
    const draft = src("data/stores/new-issue-draft-store.ts");

    it("sends the stage only when a parent is set", () => {
      // Web: `parentIssueId && stage != null ? stage : undefined`. A rootless
      // stage is a write nothing can display.
      expect(screen).toMatch(/parent\s*&&\s*stage\s*!=\s*null\s*\?\s*\{\s*stage\s*\}/);
    });

    it("reads the stage through the parent-tagged pick store", () => {
      // Anchored to the statement, not the token: the surrounding comment also
      // says `stageFor(parent)`, so a loose token match would survive the line
      // being replaced by a constant.
      expect(screen).toMatch(
        /const stage = useNewIssueStagePickStore\(\(s\) => s\.stageFor\(parent\)\);/,
      );
    });

    it("keeps the stage OUT of the persisted draft store", () => {
      // Persisting it would replay parent A's stage onto parent B's issue.
      expect(draft).not.toMatch(/\bstage\b\s*:/);
    });

    it("tags each picked stage with the parent it was chosen under", () => {
      expect(store).toMatch(/picked:\s*\{\s*parentId:\s*string;\s*stage:\s*number\s*\|\s*null\s*\}/);
      expect(store).toMatch(/picked\.parentId\s*===\s*parentId/);
    });

    it("only renders the stage chip when a parent exists", () => {
      expect(row).toMatch(/\{parentIssueId\s*\?\s*\(/);
      expect(row).toMatch(/parentIssueId\?:\s*string\s*\|\s*null/);
    });

    it("renders the STAGE the user picked, not just a placeholder label", () => {
      // A chip that always reads "Stage" tells the user nothing about the value
      // they chose — the whole point of the chip.
      expect(row).toMatch(
        /stage == null \? t\("attr\.stage"\) : t\("stage\.value", \{ n: stage \}\)/,
      );
    });

    it("keeps stage outside the settings-driven field union", () => {
      // Folding it into NewIssuePickerField would make it a hideable
      // preference and offer it on root issues.
      const union = row.slice(
        row.indexOf("export type NewIssuePickerField"),
        row.indexOf("const NEW_ISSUE_PICKER_PATHNAMES"),
      );
      expect(union).not.toContain('"stage"');
    });

    it("passes the parent id down to the attribute row", () => {
      expect(screen).toMatch(/parentIssueId=\{parent\s*\?\?\s*null\}/);
    });
  });

  describe("agent detail primary actions", () => {
    const page = src("app/(app)/[workspace]/more/agents/[id].tsx");
    const actions = src("components/agent/agent-primary-actions.tsx");
    const chat = src("app/(app)/[workspace]/(tabs)/chat.tsx");

    it("mounts the primary actions on the agent detail screen", () => {
      expect(page).toMatch(/<AgentPrimaryActions agent=\{agent\}/);
    });

    it("wires chat through the agent deep link", () => {
      expect(actions).toMatch(/agentChatHref\(wsSlug,\s*agent\.id\)/);
    });

    it("wires assign to the agent-mode create form", () => {
      expect(actions).toMatch(/seedAgentId:\s*agent\.id/);
    });

    it("gates both actions through the shared decision functions", () => {
      expect(actions).toMatch(/decideChatAction\(/);
      expect(actions).toMatch(/decideAssignAction\(/);
      expect(actions).toMatch(/agentPrimaryActionVisibility\(/);
    });

    it("uses the mirrored permission rule, not a re-derived one", () => {
      // apps/mobile/CLAUDE.md: mirror `packages/core` logic, never re-invent it.
      expect(actions).toMatch(/canAssignAgent\(agent,\s*userId,\s*role\)/);
    });

    it("keeps chat mounted for a denied viewer so the press can explain", () => {
      // Visibility must not fold the permission decision into mounting.
      expect(actions).not.toMatch(/visibility\.chat\s*&&\s*canAssign/);
    });

    it("has the chat tab honour the ?agent= param", () => {
      expect(chat).toMatch(/useLocalSearchParams<\{ agent\?: string \}>/);
      expect(chat).toMatch(/availableAgents\.some\(\(a\) => a\.id === agentParam\)/);
    });
  });
});
