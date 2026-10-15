/**
 * Wiring guard for the sessions-list realtime plan (MYS-2178).
 *
 * The behaviour is pinned by `chat-sessions-subscriptions.test.ts`, which can
 * only reach the plan if the hook actually calls it. Mobile's vitest lane has
 * no RN renderer, so a hook that re-inlined its own subscription list would
 * keep every behavioural test green while shipping the bug again — the same
 * "correct helper, no call site" trap iter-157 documented.
 *
 * Matches call syntax after stripping comments, so prose that quotes a call
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

const HOOK_REL = "data/realtime/use-chat-sessions-realtime.ts";
const PLAN_REL = "data/realtime/chat-sessions-subscriptions.ts";
const LAYOUT_REL = "app/(app)/[workspace]/_layout.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("sessions-list realtime wiring", () => {
  it("the hook delegates to the plan instead of re-inlining the list", () => {
    const hook = code(HOOK_REL);
    expect(hook).toMatch(/planChatSessionsSubscriptions\(qc, ws, wsId\)/);
    // The invalidation branches must live in the plan — one of them is the
    // fix, and a second copy in the hook would be the pre-fix behaviour
    // shadowing it.
    expect(hook).not.toMatch(/ws\.on\(/);
  });

  it("the plan owns the task:failed branch and gates it on the session id", () => {
    const plan = code(PLAN_REL);
    expect(plan).toMatch(/ws\.on\("task:failed",/);
    expect(plan).toMatch(
      /if \(payload\.chat_session_id\) invalidateSessions\(\);/,
    );
  });

  it("the workspace layout still mounts the hook", () => {
    // The plan only runs if something subscribes to it: this hook is mounted
    // once, workspace-wide, by RealtimeSubscriptions.
    const layout = code(LAYOUT_REL);
    expect(layout).toMatch(/useChatSessionsRealtime\(\);/);
  });
});
