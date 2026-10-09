/**
 * Iteration 217 (MYS-2043) — wiring ratchet for the two workspace wakeup
 * surfaces.
 *
 * `lib/workspace-wakeups.test.ts` proves the DECISIONS are right; it proves
 * nothing about whether a screen asks for them. The mobile vitest lane is
 * Node-only (`vitest.config.ts`: no RN renderer), so the two screens cannot be
 * rendered here — which is exactly the gap a ratchet closes, the same way
 * `lib/wakeup-write-wiring.test.ts` closes it for the issue surface.
 *
 * Every assertion below is a claim the round makes about a SCREEN. Comments are
 * stripped before matching, so a comment that merely describes the wiring cannot
 * satisfy one.
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

const table = code("components/autopilot/workspace-wakeups-table.tsx");
const controller = code("lib/use-workspace-wakeups.ts");
const decisions = code("lib/workspace-wakeups.ts");
const page = code("app/(app)/[workspace]/more/autopilots.tsx");
const settings = code("app/(app)/[workspace]/more/settings.tsx");
const settingsScreen = code("app/(app)/[workspace]/more/settings/wakeups.tsx");
const mutations = code("data/mutations/workspace-wakeups.ts");

describe("the workspace wakeup table is reachable and wired", () => {
  it("mounts the table from the autopilots page behind a tab", () => {
    // Web hangs it off a Tabs on the 自动化 page. Without this the screen that
    // carries 136 rules is unreachable on a phone.
    expect(page).toContain("WorkspaceWakeupsTable");
    expect(page).toContain("SegmentedControl");
    expect(page).toContain("autopilots.wakeups.tab");
    expect(page).toContain("autopilots.wakeups.title");
    // Rendering the component is not enough — it must be the branch the tab
    // actually selects. A `<WorkspaceWakeupsTable />` left in dead JSX (or
    // behind a hardcoded false) satisfies a bare name check while the screen
    // stays unreachable, which is the whole defect this round exists to close.
    expect(page).toMatch(/tab === "wakeups" \?[\s\S]*?<WorkspaceWakeupsTable/);
  });

  it("drives every filter through the controller, not local state", () => {
    // The filter bag travels to the SERVER as query params, so a screen that
    // kept its own copy would show one page while the request asked for another.
    for (const call of [
      "setFilters({ scope",
      "setFilters({ source",
      "setFilters({ kind",
      "setFilters({ agent_id",
    ]) {
      expect(table).toContain(call);
    }
  });

  it("caps the search in BYTES, not with a character maxLength", () => {
    // Measured live: the server refuses >256 BYTES, so web's `maxLength={256}`
    // (characters) accepts a Chinese search the server answers 400 to.
    expect(table).toContain("clampWorkspaceWakeupSearch");
    expect(table).not.toContain("maxLength={256}");
  });

  it("uses the decision layer for selection and paging", () => {
    expect(controller).toContain("workspaceWakeupSelection(");
    expect(controller).toContain("workspaceWakeupSelectable");
    expect(controller).toContain("toggleWorkspaceWakeupSelection");
    expect(controller).toContain("workspaceWakeupPageNumber");
    expect(decisions).toContain("row.enabled && row.can_manage");
  });

  it("renders the partial-failure result through the decision layer", () => {
    // A batch that reports 12-of-15 as plain success is the defect this pins.
    expect(table).toContain("workspaceWakeupBatchMessage");
    expect(decisions).toContain("autopilots.wakeups.batch_partial");
    expect(decisions).toContain("autopilots.wakeups.batch_success");
  });

  it("runs the batch sequentially over the selected rows", () => {
    // Parallel writes are a self-inflicted timeout on a phone link, and they
    // lose the per-rule outcome the result line reports.
    expect(mutations).toContain("disableWorkspaceWakeupsSequentially");
    expect(mutations).toContain("api.disableIssueWakeup");
  });

  it("invalidates the table AND the touched issues' task lists", () => {
    // The easy miss: a row reads its run state from its task, so a disable that
    // withdrew a queued run must clear that issue's tasks or the row keeps
    // saying "running" for a run that no longer exists.
    expect(mutations).toContain("workspaceWakeupInvalidationKeys");
    expect(mutations).toContain("issueKeys.tasks(wsId, issueId)");
  });
});

describe("the app Switch keeps a real box on native", () => {
  // Found on the Pixel 5 during this round's device pass, and it was NOT
  // caused by this round: every switch in the app laid out at zero size, so
  // the notifications screen and the issue wakeup rows were broken too.
  //
  // The cause is that `h-[1.15rem] w-8` / `size-4` are NativeWind
  // arbitrary-value classes; a UI dump showed `android.widget.Switch` nodes
  // present with bounds "[0,0][0,0]". The fix gives the track and thumb
  // numeric dimensions, which is what this app already does wherever a size
  // is load-bearing (presence-dot.tsx, avatar-stack.tsx).
  const sw = code("components/ui/switch.tsx");
  it("sizes the track and the thumb with numbers, not utility classes", () => {
    expect(sw).toContain("TRACK_WIDTH");
    expect(sw).toContain("THUMB_SIZE");
    expect(sw).toContain("width: TRACK_WIDTH");
    expect(sw).toContain("width: THUMB_SIZE");
  });

  it("no longer relies on the arbitrary-value classes that did not resolve", () => {
    expect(sw).not.toContain("h-[1.15rem]");
    expect(sw).not.toContain("size-4");
  });

  it("moves the thumb by layout, not by an arbitrary translate class", () => {
    // `translate-x-3.5` is arbitrary-value too, and it did not resolve either:
    // the knob sat on the track's left edge in BOTH states, so "on" and "off"
    // looked identical.
    expect(sw).toContain("marginLeft");
    expect(sw).not.toContain("translate-x-3.5");
  });
});

describe("the workspace wakeup defaults are reachable and wired", () => {
  it("links the settings screen from the settings list", () => {
    expect(settings).toContain("more/settings/wakeups");
  });

  it("gates every control on owner/admin, like the server does", () => {
    // The endpoint answers 403 below the tier, so a live control here would be
    // a permission fact turned into a failed request.
    //
    // Naming `canManage` is NOT enough — the mutation that drops it from the
    // switch's `disabled` while the variable is still computed keeps a naive
    // assertion green. Each control is asserted on its own gate, so removing
    // any one of them fails here.
    expect(settingsScreen).toContain("canManageRole");
    expect(settingsScreen).toContain("disabled={!canManage || busy}");
    expect(settingsScreen).toContain("editable={canManage && !busy}");
    // The Save button is rendered only for a manager, so a non-admin sees the
    // built-in instruction and no way to write one.
    expect(settingsScreen).toMatch(/\{canManage \?[\s\S]*?<Button/);
  });

  it("sends only the field that changed, so a toggle cannot clobber the text", () => {
    expect(settingsScreen).toContain("save({ enabled })");
    expect(settingsScreen).toContain("wakeupSystemInstructionErrorKey");
  });
});
