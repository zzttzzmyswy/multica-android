/**
 * Wiring guard for iteration 250's `chat:session_updated` archive-parity fix
 * (MYS-2183).
 *
 * The behaviour is pinned by `data/realtime/chat-session-archive-parity.test.ts`,
 * which can only reach the patcher if the plan actually hands it the event.
 * Mobile's vitest lane has no RN renderer, so a plan that re-narrowed the
 * payload inline — or a local archive mutation that stopped calling the pure
 * patch — would keep every behavioural test green while shipping the bug again.
 *
 * The assertions inspect call syntax after stripping comments, so prose that
 * merely quotes a call cannot satisfy them. The narrow-inline assertion matters
 * for a second reason: the pre-fix defect was partly a TYPE defect (the inline
 * narrow did not list `status`), and a future "tidy-up" that re-inlines a
 * three-field narrow would silently reintroduce it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PLAN = "data/realtime/chat-sessions-subscriptions.ts";
const UPDATERS = "data/realtime/chat-ws-updaters.ts";
const MUTATIONS = "data/mutations/chat.ts";
const LAYOUT = "app/(app)/[workspace]/_layout.tsx";

describe("chat:session_updated archive-parity wiring", () => {
  it("the plan feeds the shared payload type to the patcher", () => {
    const plan = code(PLAN);
    expect(plan).toMatch(
      /ws\.on\("chat:session_updated", \(p\) => \{[\s\S]*?patchSessionListAfterUpdate\(qc, wsId, payload\);/,
    );
    expect(plan).toMatch(
      /import \{[\s\S]*?type ChatSessionUpdatedPayload,[\s\S]*?\} from "\.\/chat-ws-updaters";/,
    );
  });

  it("the plan does not narrow the payload inline again", () => {
    const plan = code(PLAN);
    // The pre-fix shape: a local object type listing only three fields. It is
    // what made `status` structurally unconsumable.
    expect(plan).not.toMatch(/as \{\s*chat_session_id: string;/);
    expect(plan).not.toMatch(/pinned\?: boolean;\s*\};/);
  });

  it("the patcher applies status, project_id-by-presence, and zeroes unread on archive", () => {
    const updaters = code(UPDATERS);
    expect(updaters).toMatch(
      /\.\.\.\(payload\.status !== undefined \? \{ status: payload\.status \} : \{\}\)/,
    );
    // Presence, not value: an explicit null must detach the project.
    expect(updaters).toMatch(/"project_id" in payload/);
    expect(updaters).not.toMatch(/payload\.project_id !== undefined/);
    expect(updaters).toMatch(/payload\.status === "archived"/);
    expect(updaters).toMatch(/unread_count: 0, has_unread: false/);
  });

  it("the payload type carries every field the server can send", () => {
    const updaters = code(UPDATERS);
    const iface = updaters.slice(
      updaters.indexOf("export interface ChatSessionUpdatedPayload"),
    );
    const body = iface.slice(0, iface.indexOf("}"));
    for (const field of [
      "chat_session_id",
      "title",
      "project_id",
      "pinned",
      "status",
      "updated_at",
    ]) {
      expect(body).toContain(field);
    }
  });

  it("the local archive mutation uses the shared pure patch", () => {
    const mutations = code(MUTATIONS);
    expect(mutations).toMatch(
      /setChatSessionArchivedPatch\(prev, id, archived\)/,
    );
    // A second, hook-local copy of the patch would be the pre-fix behaviour
    // shadowing the fixed one.
    expect(mutations).not.toMatch(/status: archived \? "archived" : "active"/);
  });

  it("the workspace layout still mounts the sessions-list hook", () => {
    // The plan only runs if something subscribes to it: `useChatSessionsRealtime`
    // is mounted once, workspace-wide, by RealtimeSubscriptions. Unmounting it
    // (or moving it behind a conditional) would leave every behavioural test
    // green while no `chat:session_updated` ever reaches the cache again.
    expect(code(LAYOUT)).toMatch(/useChatSessionsRealtime\(\);/);
  });
});
