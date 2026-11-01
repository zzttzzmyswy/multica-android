/**
 * Pins that the issue screen reacts to `task:coalesced` (MYS-2538).
 *
 * The event fires when a comment folds into a run that has not started yet. The
 * run's STATUS does not change, so no other task event fires — but its trigger
 * and covered comments do change, which moves its block under the newest
 * comment it answers. A client that ignores the event keeps the run under the
 * earlier comment and shows the new reply with no queue row at all
 * (upstream #9702).
 *
 * Asserted at the source level because the subscription lives inside a React
 * hook: mobile's vitest lane is Node-only (see vitest.config.ts), so there is
 * no renderer to mount a hook under. What the test can hold is that the
 * handler is wired to the shared `onTaskEvent` invalidator — the same one every
 * other task event uses — rather than to some bespoke path.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskCoalescedPayload, WSEventType } from "@multica/core/types";

const APP_ROOT = path.resolve(__dirname, "..", "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const REALTIME = "data/realtime/use-issue-realtime.ts";

describe("task:coalesced", () => {
  it("is a known WS event with a typed payload", () => {
    // If the union and the payload map disagree, `ws.on("task:coalesced")`
    // stops type-checking and the subscription below would be dropped silently
    // in any file that is not type-checked.
    const event: WSEventType = "task:coalesced";
    expect(event).toBe("task:coalesced");
    const payload: TaskCoalescedPayload = {
      task_id: "t1",
      agent_id: "a1",
      issue_id: "i1",
      status: "queued",
    };
    expect(payload.task_id).toBe("t1");
  });

  it("is subscribed on the issue screen", () => {
    expect(code(REALTIME)).toMatch(/ws\.on\("task:coalesced", onTaskEvent\)/);
  });

  it("goes through the same invalidator as the other task events", () => {
    // A separate handler would have to re-derive the invalidation set, and this
    // event's whole point is that it changes what the timeline shows.
    const src = code(REALTIME);
    for (const name of [
      "task:queued",
      "task:coalesced",
      "task:dispatch",
      "task:completed",
    ]) {
      expect(src, `${name} must use onTaskEvent`).toMatch(
        new RegExp(`ws\\.on\\("${name}", onTaskEvent\\)`),
      );
    }
  });
});
