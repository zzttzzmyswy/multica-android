/**
 * Iteration 217 (MYS-2043) — the workspace-wide wakeup table's decision layer.
 *
 * Web has two workspace-level wakeup homes (自动化 → 任务唤醒 and 设置 → 唤醒);
 * mobile had neither. This module is the table's must-agree point with web
 * (`packages/views/autopilots/components/workspace-wakeups.tsx`): same rows,
 * same filters, same verdict on which rows are selectable, whether a batch can
 * run, and what its result means.
 *
 * Rows below are shaped like the live server's (`mu.zztweb.top`,
 * `GET /api/issue-wakeups`), not invented — including `can_manage`, `source`
 * and `runs_7d`, which are the three fields every branch here reads.
 */
import { describe, expect, it } from "vitest";
import type {
  WorkspaceWakeup,
  WorkspaceWakeupFilters,
} from "@multica/core/types";
import {
  WORKSPACE_WAKEUP_PAGE_SIZE,
  WORKSPACE_WAKEUP_SEARCH_MAX_BYTES,
  canRunWorkspaceWakeupBatch,
  canSelectWorkspaceWakeup,
  clampWorkspaceWakeupSearch,
  countWorkspaceWakeupFilters,
  emptyWorkspaceWakeupFilters,
  previousWorkspaceWakeupOffset,
  selectableWorkspaceWakeups,
  workspaceWakeupBatchOutcome,
  workspaceWakeupInvalidationKeys,
  workspaceWakeupPage,
  workspaceWakeupPager,
  workspaceWakeupSearchBytes,
  workspaceWakeupSearchFits,
  workspaceWakeupSelectionState,
  workspaceWakeupsAreFiltered,
} from "./workspace-wakeups";

/** A live `GET /api/issue-wakeups` row, trimmed to the fields under test. */
function row(over: Partial<WorkspaceWakeup> = {}): WorkspaceWakeup {
  return {
    id: "w-1",
    issue_id: "i-1",
    issue_identifier: "MYS-2042",
    issue_title: "迭代 I13：PC 模式定版 v8.0",
    issue_closed: false,
    can_manage: true,
    active_runs: 0,
    task: null,
    source: "agent",
    runs_7d: 0,
    rule: null,
    system_stage: null,
    system_remaining: null,
    target_type: null,
    agent_id: "a-1",
    agent_name: "Multica安卓开发agent",
    kind: "event",
    mode: "once",
    event_types: ["issue.status_changed"],
    filter_agent_id: null,
    filter_task_id: null,
    filter_actor_type: null,
    filter_actor_id: null,
    filter_actor_name: null,
    interval_seconds: null,
    cron_expression: null,
    timezone: "UTC",
    next_fire_at: null,
    enabled: true,
    revision: 3,
    disabled_at: null,
    last_task_id: null,
    last_error: null,
    filter_agent_name: null,
    last_task_status: null,
    expires_at: null,
    expiry_seconds: null,
    on_timeout: null,
    timed_out_at: null,
    created_by_name: null,
    source_agent_id: null,
    source_agent_name: null,
    condition: null,
    max_fires: null,
    fire_count: 0,
    paused_reason: null,
    ...over,
  };
}

describe("filters", () => {
  it("starts on the active scope with every other dimension open", () => {
    const f = emptyWorkspaceWakeupFilters();
    expect(f.scope).toBe("active");
    expect(f.kind).toBe("all");
    expect(f.source).toBe("");
    expect(f.agent_id).toBe("");
    expect(f.search).toBe("");
    expect(f.offset).toBe(0);
    expect(f.limit).toBe(WORKSPACE_WAKEUP_PAGE_SIZE);
    // A fresh visit IS "filtered", which looks wrong until you follow what the
    // flag is for: the table's empty state reads it to decide between 「暂无唤醒
    // 规则」 and 「没有匹配的唤醒」 + a "clear filters" button. The default view is
    // the `active` SCOPE — not `all` — so an empty `active` page on a workspace
    // that has ended rules is a filtered empty, and the button that widens the
    // scope to `all` is exactly the right offer. Web computes the same
    // (workspace-wakeups.tsx:475).
    expect(workspaceWakeupsAreFiltered(f)).toBe(true);
    // …and widening to `all` clears it, which is what that button does.
    expect(workspaceWakeupsAreFiltered({ ...f, scope: "all" })).toBe(false);
  });

  it("counts a narrowing dimension, and never the scope", () => {
    expect(countWorkspaceWakeupFilters(emptyWorkspaceWakeupFilters())).toBe(0);
    const f: WorkspaceWakeupFilters = {
      ...emptyWorkspaceWakeupFilters(),
      scope: "all",
      kind: "event",
      source: "agent",
      agent_id: "a-1",
      search: "迭代",
    };
    expect(countWorkspaceWakeupFilters(f)).toBe(4);
  });

  it("reads a non-default scope as filtered, for the empty-state branch", () => {
    const base = emptyWorkspaceWakeupFilters();
    // `all` is the one scope that is not a narrowing.
    expect(workspaceWakeupsAreFiltered({ ...base, scope: "all" })).toBe(false);
    for (const scope of ["active", "paused", "disabled", "ended"] as const) {
      expect(workspaceWakeupsAreFiltered({ ...base, scope })).toBe(true);
    }
  });

  it("does not treat paging as a filter", () => {
    // A view paged to the end has no narrowing applied; calling it "filtered"
    // would offer "clear filters" on a table that is showing everything.
    const f = { ...emptyWorkspaceWakeupFilters(), scope: "all" as const, offset: 100 };
    expect(workspaceWakeupsAreFiltered(f)).toBe(false);
    expect(countWorkspaceWakeupFilters(f)).toBe(0);
  });
});

describe("selection", () => {
  it("selects only rows the server will actually let this reader turn off", () => {
    expect(canSelectWorkspaceWakeup(row())).toBe(true);
    // Already off: the write is a no-op, so a batch would report a success it
    // did not achieve.
    expect(canSelectWorkspaceWakeup(row({ enabled: false }))).toBe(false);
    // Not this reader's to manage — the server answers 403.
    expect(canSelectWorkspaceWakeup(row({ can_manage: false }))).toBe(false);
    // A platform rule has no rule id to disable (its `id` is the issue's).
    expect(canSelectWorkspaceWakeup(row({ source: "system" }))).toBe(false);
  });

  it("takes exactly the selectable rows on the page", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", enabled: false }),
      row({ id: "c", source: "system" }),
      row({ id: "d", can_manage: false }),
    ];
    expect(selectableWorkspaceWakeups(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("derives the page box from the selection rather than storing it", () => {
    const selectable = [row({ id: "a" }), row({ id: "b" })];
    expect(workspaceWakeupSelectionState(selectable, new Set())).toBe("none");
    expect(workspaceWakeupSelectionState(selectable, new Set(["a"]))).toBe("some");
    expect(
      workspaceWakeupSelectionState(selectable, new Set(["a", "b"])),
    ).toBe("all");
  });

  it("reads none when the page has nothing selectable", () => {
    // A selection carried over from the previous page must not make the box
    // read "some" against a page that offers nothing to select.
    const selectable = [row({ id: "x", enabled: false })];
    expect(workspaceWakeupSelectionState(selectable, new Set(["a"]))).toBe("none");
    expect(workspaceWakeupSelectionState([], new Set(["a"]))).toBe("none");
  });
});

describe("batch", () => {
  it("refuses to start with an empty selection or one already in flight", () => {
    expect(canRunWorkspaceWakeupBatch(0, false)).toBe(false);
    expect(canRunWorkspaceWakeupBatch(3, true)).toBe(false);
    expect(canRunWorkspaceWakeupBatch(3, false)).toBe(true);
  });

  it("reports a clean batch as a muted success", () => {
    const outcome = workspaceWakeupBatchOutcome({ failed: [], succeeded: 4 });
    expect(outcome.key).toBe("autopilots.wakeups.batch_success");
    expect(outcome.tone).toBe("muted");
    expect(outcome.keepSelected).toEqual([]);
    expect(outcome.params.count).toBe(4);
  });

  it("reports a partial failure as a failure, keeping the failed rows selected", () => {
    const outcome = workspaceWakeupBatchOutcome({
      failed: ["w-9", "w-8"],
      succeeded: 2,
    });
    expect(outcome.key).toBe("autopilots.wakeups.batch_partial");
    // Not skimmable good news: the rules that did not stop will still wake an
    // agent.
    expect(outcome.tone).toBe("destructive");
    expect(outcome.params.succeeded).toBe(2);
    expect(outcome.params.failed).toBe(2);
    // A retry must be one tap, not a manual re-find on a 136-rule workspace.
    expect(outcome.keepSelected).toEqual(["w-9", "w-8"]);
  });
});

describe("paging", () => {
  it("reports the 1-based page the offset sits on", () => {
    expect(workspaceWakeupPage(0)).toBe(1);
    expect(workspaceWakeupPage(WORKSPACE_WAKEUP_PAGE_SIZE)).toBe(2);
    expect(workspaceWakeupPage(WORKSPACE_WAKEUP_PAGE_SIZE * 2 + 1)).toBe(3);
    // A zero limit must not divide by zero into Infinity.
    expect(workspaceWakeupPage(0, 0)).toBe(1);
  });

  it("only offers a next page when the server's total has one", () => {
    // Live: total=136 with a 20-row page — both directions available mid-list.
    expect(workspaceWakeupPager({ offset: 40, limit: 20, total: 136 })).toEqual({
      hasPrevious: true,
      hasNext: true,
    });
    // The last page: offset+limit reaches the total exactly.
    expect(workspaceWakeupPager({ offset: 120, limit: 20, total: 136 })).toEqual({
      hasPrevious: true,
      hasNext: false,
    });
    expect(workspaceWakeupPager({ offset: 0, limit: 20, total: 10 })).toEqual({
      hasPrevious: false,
      hasNext: false,
    });
  });

  it("walks back a page, and offers nothing on the first", () => {
    expect(previousWorkspaceWakeupOffset(40)).toBe(20);
    expect(previousWorkspaceWakeupOffset(10)).toBe(0);
    // `null` on the first page rather than a floored 0: the pager button is
    // `disabled={previousOffset === null}`, so a 0 here would leave the button
    // live and send a request for the page the reader is already on. Same
    // reason the next-page helper answers null instead of an offset past the
    // end.
    expect(previousWorkspaceWakeupOffset(0)).toBeNull();
  });
});

describe("search cap is bytes, not characters", () => {
  it("measures UTF-8 length the way the server does", () => {
    expect(workspaceWakeupSearchBytes("abc")).toBe(3);
    expect(workspaceWakeupSearchBytes("迭代")).toBe(6);
    // Measured live: 85 CJK chars = 255 bytes accepted, 100 chars = 300 bytes
    // refused, 257 ASCII bytes refused.
    expect(workspaceWakeupSearchBytes("迭".repeat(85))).toBe(255);
    expect(workspaceWakeupSearchFits("迭".repeat(85))).toBe(true);
  });

  it("refuses what the server refuses, on the byte count", () => {
    expect(workspaceWakeupSearchFits("a".repeat(256))).toBe(true);
    expect(workspaceWakeupSearchFits("a".repeat(257))).toBe(false);
    // The defect web's `maxLength={256}` would produce if copied: 100 CJK
    // characters pass a CHARACTER cap of 256 and are 300 bytes on the wire.
    expect("迭".repeat(100).length).toBeLessThanOrEqual(256);
    expect(workspaceWakeupSearchFits("迭".repeat(100))).toBe(false);
  });

  it("clamps on a code-point boundary without splitting a character", () => {
    // 100 CJK chars = 300 bytes; the clamp must land on 85 chars = 255 bytes,
    // and the result must remain a valid string of whole characters.
    const clamped = clampWorkspaceWakeupSearch("迭".repeat(100));
    expect(workspaceWakeupSearchBytes(clamped)).toBe(255);
    expect(clamped).toBe("迭".repeat(85));
    expect(workspaceWakeupSearchFits(clamped)).toBe(true);
  });

  it("leaves an acceptable string untouched", () => {
    expect(clampWorkspaceWakeupSearch("迭代 217")).toBe("迭代 217");
    expect(clampWorkspaceWakeupSearch("")).toBe("");
  });

  it("never cuts a 4-byte character in half", () => {
    // 64 emoji = 256 bytes exactly; one more must not produce a lone surrogate.
    const emoji = "😀".repeat(65);
    const clamped = clampWorkspaceWakeupSearch(emoji);
    expect(workspaceWakeupSearchFits(clamped)).toBe(true);
    expect(clamped).toBe("😀".repeat(64));
    expect([...clamped].every((c) => c === "😀")).toBe(true);
  });
});

describe("invalidation set", () => {
  it("de-duplicates the issue ids a batch touched", () => {
    // One issue can hold several rules; its task key must be invalidated once.
    expect(
      workspaceWakeupInvalidationKeys(["i-1", "i-2", "i-1"]).taskIssueIds,
    ).toEqual(["i-1", "i-2"]);
  });

  it("always covers the table and the per-issue rule lists", () => {
    const keys = workspaceWakeupInvalidationKeys([]);
    expect(keys.table).toBe(true);
    expect(keys.issueWakeups).toBe(true);
    expect(keys.taskIssueIds).toEqual([]);
  });
});
