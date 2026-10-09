/**
 * Iteration 215 (MYS-2031) — wiring ratchet for the wakeup write surface.
 *
 * The mobile vitest lane is Node-only (`vitest.config.ts`: no RN renderer), so
 * `lib/wakeup-controls.test.ts` being green proves the DECISIONS are right and
 * nothing at all about whether the section asks for them. That gap is exactly
 * where this iteration's defect lived for a round: `wakeupControlState` can be
 * perfect while `wakeups-section.tsx` still renders a read-only row, and every
 * unit test stays green.
 *
 * Same shape as `lib/actor-property-wiring.test.ts`, for the same reason.
 * Comments are stripped before matching so a comment that merely *describes*
 * the wiring cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the issue wakeup section writes, not just reads", () => {
  const section = code("components/issue/wakeups-section.tsx");
  const actions = code("components/issue/wakeup-row-actions.tsx");

  it("binds the enable and disable mutations for a rule row", () => {
    expect(section).toContain("useEnableIssueWakeup");
    expect(section).toContain("useDisableIssueWakeup");
  });

  it("asks the decision layer which control to draw rather than deciding inline", () => {
    // The must-agree point with web. A hand-rolled branch here would drift from
    // `wakeup-controls.ts` silently, and the branch order is load-bearing
    // (a spent one-shot must NOT get a switch reading "off").
    expect(section).toContain("wakeupControlState(");
    expect(section).toContain("wakeupRunFacts(");
  });

  it("explains an inert control instead of drawing a dead one", () => {
    // Both halves: the key must be computed AND rendered. A call whose value is
    // dropped, or a branch swapped to `{false ? …}`, leaves the row with an
    // inert control and no reason — a button that does nothing, which the
    // reader cannot tell apart from a broken one.
    expect(section).toMatch(/wakeupBlockedTextKey\(control\.blocked\)/);
    expect(section).toMatch(/\{blockedKey \? \(\s*\n?\s*<Text[^>]*>\s*\n?\s*\{t\(blockedKey\)\}/);
  });

  it("does not fall back to revision 0 when enabling", () => {
    // Web sends `revision ?? 0`, which the server rejects with "revision is
    // required". The decision layer hands over the fence, so this call site
    // reads THAT value and never reconstructs one from `wakeup`.
    expect(section).toContain("control.enableRevision");
    expect(section).toMatch(/const revision = control\.enableRevision;/);
    // The guard that makes the value safe to spread, asserted in the negative
    // so a later "simplification" back to `?? 0` is caught.
    expect(section).toMatch(/if \(revision === null\) return;/);
    expect(section).not.toMatch(/revision:\s*wakeup\.revision\s*\?\?\s*0/);
  });

  it("mounts the row sheet only while it is open", () => {
    // A sheet left mounted keeps the instruction editor's draft alive, keyed to
    // a rule the user may have just deleted.
    expect(section).toMatch(/\{sheetOpen \? \(\s*\n?\s*<WakeupRowSheet/);
  });

  it("offers wake-now, edit and delete from the row sheet", () => {
    for (const hook of [
      "useTriggerIssueWakeup",
      "useEditWakeupInstruction",
      "useDeleteIssueWakeup",
    ]) {
      expect(actions, `${hook} must be wired`).toContain(hook);
    }
    for (const key of [
      "wakeups.wakeNow",
      "wakeups.editInstruction",
      "wakeups.delete",
    ]) {
      expect(actions, `${key} must be reachable`).toContain(key);
    }
  });

  it("confirms the delete and nothing else", () => {
    // Web confirms only the delete. A confirmation on a reversible action
    // trains people to tap through the one that matters — and the destructive
    // style is what makes the dialog's affirmative read as "this cannot be
    // undone", so both halves are pinned. The cancel entry is asserted too:
    // a dialog with only a destructive button has no way out.
    expect(actions).toContain("Alert.alert(");
    expect(actions).toMatch(/style: "destructive"/);
    expect(actions).toMatch(/\{ text: t\("common\.cancel"\), style: "cancel" \}/);
  });

  it("gates wake-now on the rule still being live, not on the sheet opening", () => {
    // A rule the platform switched off has no run left to fire, so the action
    // must be absent rather than failing on tap. Asserted through the CALL
    // SITE: the sheet honors `canTrigger`, so computing the flag and not
    // passing it (or passing a constant) would leave a dead menu entry.
    expect(section).toContain("canTrigger={!closed && !wakeup.disabled_at}");
    expect(actions).toMatch(/\{canTrigger \? \(/);
  });

  it("sends the instruction fences the server compares", () => {
    // `expected_instruction` beside `revision`: the server compares BOTH, so
    // dropping either lets a stale editor overwrite someone else's edit in the
    // window where the other fence still matches. `expected_instruction` is
    // the fence that is easy to lose — `revision` also appears in the enable
    // and delete paths, so a bare "contains revision" would survive its
    // removal from THIS call.
    expect(actions).toMatch(/expected_instruction: original\.instruction/);
    expect(actions).toMatch(/revision: original\.revision/);
  });

  it("validates the prompt before sending it", () => {
    expect(actions).toContain("wakeupInstructionErrorKey(");
  });

  it("wires withdraw to the DISABLE write, not to an enable", () => {
    // Web's second branch calls `onDisable` (`wakeup-control.tsx:74-82`). The
    // rule is already off; the button withdraws the run the rule enqueued, and
    // that is what the disable endpoint does. Wiring it to `onEnable` — the
    // obvious reading of "this branch has an `onEnable` prop in scope" — turns
    // the one control that STOPS a queued run into one that restarts the rule.
    // The withdraw BLOCK, isolated: from its `if` to the next top-level
    // branch, so an `onDisable` in the switch above cannot satisfy it.
    const withdraw = actions.match(
      /if \(control\.kind === "withdraw"\) \{[\s\S]*?\n  \}/,
    );
    expect(withdraw, "withdraw branch must exist").not.toBeNull();
    expect(withdraw![0]).toContain("onPress={onDisable}");
    expect(withdraw![0]).not.toContain("onEnable");
    // …and the resubscribe tail must still enable, or a copy-paste that put
    // `onDisable` in both branches would pass the assertions above.
    expect(actions).toMatch(
      /label=\{t\("wakeups\.resubscribe"\)\}[\s\S]{0,200}?onPress=\{\(\) => onEnable/,
    );
  });
});

describe("the platform rule row acts on the rule", () => {
  const section = code("components/issue/wakeups-section.tsx");

  it("binds the system-rule mutation", () => {
    expect(section).toContain("useUpdateIssueSystemWakeup");
  });

  it("sends only the field a control changed", () => {
    // The server keeps an omitted field. Web forces the other field back to the
    // value the client last read, so a toggle against a stale row reverts an
    // instruction someone else typed — this must not copy that.
    expect(section).toMatch(/update\.mutate\(\s*\{\s*rule: rule\.rule,\s*enabled\s*\}\s*\)/);
    expect(section).toMatch(/update\.mutate\(\s*\{[^}]*rule: rule\.rule,\s*instruction:/);
  });

  it("holds the system prompt to its own smaller limit, and lets it be cleared", () => {
    expect(section).toContain("wakeupSystemInstructionErrorKey(");
  });
});
