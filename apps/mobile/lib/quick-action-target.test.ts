/**
 * The quick-action target, exercised directly. Iteration 264 (MYS-2291).
 *
 * Three decisions, and each of them is a place where "no target" and "broken
 * target" look identical from the outside while meaning opposite things:
 *
 *   - what goes on the wire when the author clears the target;
 *   - which of the saved action's flags wins when read back;
 *   - whether Save is allowed before a target has been chosen at all.
 *
 * Web only gained all three in the same release, so the whole point of the
 * suite is that mobile answers them the same way rather than inventing a
 * fourth reading of `target_missing`.
 */
import { describe, expect, it } from "vitest";
import {
  quickActionCanSave,
  quickActionShowsRunsAs,
  quickActionTargetPayload,
  quickActionTargetState,
} from "./quick-action-target";

describe("quickActionTargetPayload", () => {
  it("sends the chosen binding verbatim", () => {
    expect(quickActionTargetPayload({ type: "agent", id: "a1" })).toEqual({
      assignee_type: "agent",
      assignee_id: "a1",
    });
    expect(quickActionTargetPayload({ type: "squad", id: "s1" })).toEqual({
      assignee_type: "squad",
      assignee_id: "s1",
    });
  });

  it("sends an explicit empty PAIR for no target, never an omitted field", () => {
    // The two failure modes this rules out, both silent:
    //   - `{}` (or leaving the keys undefined) on PATCH means "leave this
    //     column alone" to the server, so clearing a target reports success
    //     and the old binding survives — the worst kind of failure, because
    //     the UI closed as if it worked;
    //   - `null` is not what the server's validator recognises.
    const payload = quickActionTargetPayload(null);
    expect(payload).toEqual({ assignee_type: "", assignee_id: "" });
    expect(Object.keys(payload).sort()).toEqual(["assignee_id", "assignee_type"]);
  });

  it("keeps the pair consistent so the server cannot read a half-binding", () => {
    // `validateQuickActionAssignee` accepts ("", "") and rejects an empty type
    // beside a real id. Every shape this function can produce must therefore
    // be either both-set or both-empty.
    for (const choice of [null, { type: "agent" as const, id: "a1" }]) {
      const payload = quickActionTargetPayload(choice);
      expect(payload.assignee_id.length > 0).toBe(payload.assignee_type !== "");
    }
  });
});

describe("quickActionTargetState", () => {
  const base = {
    assignee_type: "agent",
    target_missing: false,
    target_public: true,
    visibility: "public",
  };

  it("reads an empty assignee_type as a deliberate no-target", () => {
    // The reason this is a state of its own rather than a fall-through: the
    // server resolves `""` to a FOUND target, so `target_missing` is false.
    // Any check ordered after that one silently misses this case and prints
    // `target_name`, which is the empty string.
    expect(
      quickActionTargetState({ ...base, assignee_type: "", target_missing: false }),
    ).toBe("none");
  });

  it("reads an empty assignee_type as no-target even if a server sets the missing flag", () => {
    // Rollback path: an older server, or one that has not reloaded, may report
    // the flag for a row it deserialized before the column became nullable.
    // "The author chose nobody" is the more specific fact and wins.
    expect(quickActionTargetState({ ...base, assignee_type: "", target_missing: true })).toBe(
      "none",
    );
  });

  it("reports a bound target that no longer resolves as missing", () => {
    expect(quickActionTargetState({ ...base, target_missing: true })).toBe("missing");
  });

  it("flags a public action whose target the team cannot invoke", () => {
    expect(
      quickActionTargetState({ ...base, visibility: "public", target_public: false }),
    ).toBe("mismatched");
  });

  it("does not flag the same target on a private action", () => {
    // Private promises nothing to the team, so a private target is not wrong.
    expect(
      quickActionTargetState({ ...base, visibility: "private", target_public: false }),
    ).toBe("ok");
  });

  it("is ok for a resolving, invocable binding", () => {
    expect(quickActionTargetState(base)).toBe("ok");
  });

  it("does not confuse a missing target with a mismatched one", () => {
    // Both are red-ish in the UI, but only one is recoverable by re-picking:
    // reporting a deleted agent as "made private" would send the owner to the
    // wrong screen.
    expect(
      quickActionTargetState({
        ...base,
        target_missing: true,
        target_public: false,
      }),
    ).toBe("missing");
  });
});

describe("quickActionCanSave", () => {
  const filled = { name: "Review", prompt: "Look at this", templateToken: null };

  it("allows saving with NO target — the whole point of the release", () => {
    // Nothing in the form's three inputs mentions a target. Web's `canSave`
    // (`quick-actions-tab.tsx:466-469`) has the same three clauses; the mobile
    // form's fourth one is what made this impossible on a phone.
    expect(quickActionCanSave(filled)).toBe(true);
  });

  it("still requires a name and a prompt", () => {
    expect(quickActionCanSave({ ...filled, name: "   " })).toBe(false);
    expect(quickActionCanSave({ ...filled, prompt: "" })).toBe(false);
  });

  it("still refuses a template token", () => {
    // The server rejects any `{{...}}`; mirroring it inline is an affordance,
    // not the authority, but a Save that always 400s is not one either.
    expect(quickActionCanSave({ ...filled, templateToken: "{{issue}}" })).toBe(false);
  });
});

describe("quickActionShowsRunsAs", () => {
  it("hides the sentence for a targetless action", () => {
    // "Runs as X" answers "who will this call". For a targetless action the
    // answer is nobody, and the row's fallback word ("the agent") would name a
    // target that does not exist.
    expect(quickActionShowsRunsAs({ assignee_type: "" })).toBe(false);
  });

  it("shows it for every bound action", () => {
    expect(quickActionShowsRunsAs({ assignee_type: "agent" })).toBe(true);
    expect(quickActionShowsRunsAs({ assignee_type: "squad" })).toBe(true);
  });
});
