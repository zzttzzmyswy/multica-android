/**
 * Unit tests for the agent "Concurrency" commit rule (iteration 181,
 * MYS-1564 / G29). The rule is a direct port of web's `ConcurrencyField`
 * commit guard (`packages/views/agents/components/agent-detail-inspector.tsx
 * :330-340`), so these cases name that contract explicitly:
 *
 *   - a non-integer or out-of-range draft is NOT sent (the caller rolls back)
 *   - a draft equal to the current value is NOT sent (no pointless PATCH)
 *   - anything else is sent verbatim
 *
 * The bounds come from `@multica/core/agents`, the same constants the backend
 * validates against, so this also pins that the field cannot drift from them.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_MAX_CONCURRENT_TASKS_MAX,
  AGENT_MAX_CONCURRENT_TASKS_MIN,
} from "@multica/core/agents";
import { resolveConcurrencyCommit } from "./agent-concurrency";

describe("resolveConcurrencyCommit", () => {
  it("sends a valid, changed value", () => {
    expect(resolveConcurrencyCommit("3", 1)).toBe(3);
    expect(resolveConcurrencyCommit("50", 1)).toBe(50);
  });

  it("sends nothing when the value did not change", () => {
    expect(resolveConcurrencyCommit("4", 4)).toBeNull();
    // Whitespace around the same number is still the same number.
    expect(resolveConcurrencyCommit(" 4 ", 4)).toBeNull();
  });

  it("accepts both range boundaries, rejects just outside them", () => {
    expect(resolveConcurrencyCommit(String(AGENT_MAX_CONCURRENT_TASKS_MIN), 7)).toBe(
      AGENT_MAX_CONCURRENT_TASKS_MIN,
    );
    expect(resolveConcurrencyCommit(String(AGENT_MAX_CONCURRENT_TASKS_MAX), 7)).toBe(
      AGENT_MAX_CONCURRENT_TASKS_MAX,
    );
    expect(
      resolveConcurrencyCommit(String(AGENT_MAX_CONCURRENT_TASKS_MIN - 1), 7),
    ).toBeNull();
    expect(
      resolveConcurrencyCommit(String(AGENT_MAX_CONCURRENT_TASKS_MAX + 1), 7),
    ).toBeNull();
    // The two values the field's own on-device check exercises.
    expect(resolveConcurrencyCommit("0", 5)).toBeNull();
    expect(resolveConcurrencyCommit("99", 5)).toBeNull();
  });

  it("rejects non-integers, negatives and non-numeric text", () => {
    for (const draft of ["2.5", "-1", "", "abc", "1e2", "٣"]) {
      expect(resolveConcurrencyCommit(draft, 5)).toBeNull();
    }
  });

  it("treats an empty draft as a rollback, not as zero", () => {
    // Clearing the field must restore the server value rather than PATCH 0,
    // which the backend would reject anyway.
    expect(resolveConcurrencyCommit("", 5)).toBeNull();
  });
});
