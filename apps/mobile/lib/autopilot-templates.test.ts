/**
 * Pure-function tests for the autopilot empty-state templates (iteration 105,
 * web alignment). Mirrors web `packages/views/autopilots/components/
 * autopilots-page.tsx` TEMPLATES + `schedule-editor/cron-mapping.ts` toCron
 * semantics: six operational templates, each with an at-time + every/weekly
 * day pattern serialized to a server cron expression. Unknown template ids
 * degrade conservatively (templateScheduleToCron → null, isTemplateId →
 * false), never a crash.
 */
import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_TEMPLATES,
  isTemplateId,
  templateScheduleToCron,
} from "./autopilot-templates";

describe("AUTOPILOT_TEMPLATES", () => {
  it("defines exactly the six web templates with unique ids and non-empty prompts", () => {
    const ids = AUTOPILOT_TEMPLATES.map((t) => t.id);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(6);
    for (const tpl of AUTOPILOT_TEMPLATES) {
      expect(tpl.prompt.trim().length).toBeGreaterThan(0);
      expect(tpl.schedule.time.kind).toBe("at");
      expect(tpl.schedule.time.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("keeps the web template id set stable", () => {
    const ids = AUTOPILOT_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual([
      "bug_triage",
      "daily_news",
      "dependency_audit",
      "documentation_check",
      "pr_review",
      "weekly_progress",
    ]);
  });

  it("carries full web prompts (spot-check the first line of each)", () => {
    const byId = Object.fromEntries(AUTOPILOT_TEMPLATES.map((t) => [t.id, t]));
    expect(byId.daily_news.prompt).toContain("Search the web for news");
    expect(byId.pr_review.prompt).toContain("List all open pull requests");
    expect(byId.bug_triage.prompt).toContain("List all backlog issues");
    expect(byId.weekly_progress.prompt).toContain("Gather all issues completed");
    expect(byId.dependency_audit.prompt).toContain("Run dependency audit tools");
    expect(byId.documentation_check.prompt).toContain("List all code changes merged");
  });
});

describe("templateScheduleToCron", () => {
  it("serializes an every-day at-time template to a 5-field cron", () => {
    expect(
      templateScheduleToCron({
        time: { kind: "at", time: "09:00" },
        days: { kind: "every" },
      }),
    ).toBe("0 9 * * *");
  });

  it("serializes weekdays to a comma/range day-of-week field", () => {
    expect(
      templateScheduleToCron({
        time: { kind: "at", time: "10:00" },
        days: { kind: "weekly", daysOfWeek: [1, 2, 3, 4, 5] },
      }),
    ).toBe("0 10 * * 1-5");
  });

  it("serializes a single day of week", () => {
    expect(
      templateScheduleToCron({
        time: { kind: "at", time: "17:00" },
        days: { kind: "weekly", daysOfWeek: [1] },
      }),
    ).toBe("0 17 * * 1");
  });

  it("serializes every template to the cron the web toCron mapping yields", () => {
    const expected: Record<string, string> = {
      daily_news: "0 9 * * *",
      pr_review: "0 10 * * 1-5",
      bug_triage: "0 9 * * 1-5",
      weekly_progress: "0 17 * * 1",
      dependency_audit: "0 8 * * 1",
      documentation_check: "0 14 * * 1",
    };
    for (const tpl of AUTOPILOT_TEMPLATES) {
      expect(templateScheduleToCron(tpl.schedule)).toBe(expected[tpl.id]);
    }
  });

  it("defends against a spread-out weekly pattern via comma ranges", () => {
    expect(
      templateScheduleToCron({
        time: { kind: "at", time: "09:00" },
        days: { kind: "weekly", daysOfWeek: [1, 5] },
      }),
    ).toBe("0 9 * * 1,5");
  });

  it("degrades unknown schedule shapes to null", () => {
    expect(
      templateScheduleToCron({
        time: { kind: "at", time: "9999" },
        days: { kind: "every" },
      } as never),
    ).toBeNull();
    expect(templateScheduleToCron(undefined as never)).toBeNull();
  });
});

describe("isTemplateId", () => {
  it("accepts every defined template id", () => {
    for (const tpl of AUTOPILOT_TEMPLATES) {
      expect(isTemplateId(tpl.id)).toBe(true);
    }
  });

  it("rejects unknown / empty / undefined ids conservatively", () => {
    expect(isTemplateId("random")).toBe(false);
    expect(isTemplateId("")).toBe(false);
    expect(isTemplateId(undefined)).toBe(false);
    expect(isTemplateId(null)).toBe(false);
    expect(isTemplateId("daily_news ")).toBe(false);
  });
});