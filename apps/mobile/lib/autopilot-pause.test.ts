/**
 * Iteration 258 (MYS-2236) — a system pause is not a user pause.
 *
 * The schema has parsed `pause_reason` since iteration 82; nothing in
 * `app/` or `components/` read it. So an autopilot the server had paused
 * because its assignee lost its runtime rendered as plain 「已暂停」 on both
 * the list and the detail page, next to a switch showing "off" — the exact
 * control a reader would try, and not the one that fixes anything. Web names
 * the reason in a banner with a deep link to the agent
 * (`autopilot-detail-page.tsx:829-848`) and in the list marker's tooltip
 * (`autopilots-page.tsx:255-256`).
 */
import { describe, expect, it } from "vitest";
import {
  PAUSE_REASON_AGENT_RUNTIME_REQUIRED,
  canJumpToRuntimeBinding,
  isRuntimeRequiredPause,
  pauseBannerCopy,
  pauseStatusLabelKey,
  runtimeBindingHref,
} from "./autopilot-pause";

const pausedForRuntime = {
  status: "paused",
  pause_reason: PAUSE_REASON_AGENT_RUNTIME_REQUIRED,
} as const;

describe("isRuntimeRequiredPause", () => {
  it("is true only for a paused row whose reason is the missing runtime", () => {
    expect(isRuntimeRequiredPause(pausedForRuntime)).toBe(true);
  });

  it("is false for a USER pause (status alone must not read as a system pause)", () => {
    expect(isRuntimeRequiredPause({ status: "paused", pause_reason: null })).toBe(
      false,
    );
    expect(
      isRuntimeRequiredPause({ status: "paused", pause_reason: undefined }),
    ).toBe(false);
  });

  it("is false for an ACTIVE row still carrying a stale reason", () => {
    // Every status write clears the column server-side
    // (`autopilot.sql:73-76`), but a client holding a row across that write
    // must not show "paused because…" for an autopilot that is running.
    expect(
      isRuntimeRequiredPause({
        status: "active",
        pause_reason: PAUSE_REASON_AGENT_RUNTIME_REQUIRED,
      }),
    ).toBe(false);
  });

  it("is false for archived rows even with the reason attached", () => {
    expect(
      isRuntimeRequiredPause({
        status: "archived",
        pause_reason: PAUSE_REASON_AGENT_RUNTIME_REQUIRED,
      }),
    ).toBe(false);
  });

  it("ignores a reason the client does not know", () => {
    // A future server reason must degrade to the plain status word rather
    // than being explained with today's sentence.
    expect(
      isRuntimeRequiredPause({ status: "paused", pause_reason: "quota" }),
    ).toBe(false);
  });
});

describe("pauseStatusLabelKey", () => {
  it("gives the runtime sentence for a system pause", () => {
    expect(pauseStatusLabelKey(pausedForRuntime)).toBe(
      "autopilots.status.pausedRuntimeRequired",
    );
  });

  it("gives no override for a user pause — the plain status word prints", () => {
    expect(pauseStatusLabelKey({ status: "paused", pause_reason: null })).toBe(
      null,
    );
  });

  it("keeps the two states distinct (a fix that returned one key for both would pass nothing else)", () => {
    const system = pauseStatusLabelKey(pausedForRuntime);
    const user = pauseStatusLabelKey({ status: "paused", pause_reason: null });
    expect(system).not.toBe(user);
  });
});

describe("pauseBannerCopy", () => {
  it("names the assignee when the directory answered", () => {
    expect(pauseBannerCopy({ kind: "name", name: "Review Bot" })).toEqual({
      key: "autopilots.detail.pausedRuntimeRequired",
      params: { name: "Review Bot" },
    });
  });

  it("falls back to the unnamed sentence while the directory is unsettled", () => {
    // MYS-2227's rule: an unsettled read may not assert a name.
    expect(pauseBannerCopy({ kind: "unsettled" })).toEqual({
      key: "autopilots.detail.pausedRuntimeRequiredUnnamed",
    });
  });

  it("falls back too when the directory answered and the agent is GONE", () => {
    // The gone branch carries an id fragment, not a name — printing
    // 「由于 3f9a12bc 失去运行时」 would be worse than not naming it.
    expect(pauseBannerCopy({ kind: "gone", name: "3f9a12bc" })).toEqual({
      key: "autopilots.detail.pausedRuntimeRequiredUnnamed",
    });
  });
});

describe("the bind-runtime jump", () => {
  it("is offered for an agent assignee", () => {
    expect(canJumpToRuntimeBinding({ assignee_type: "agent" })).toBe(true);
  });

  it("is withheld for a squad — a squad's runtime is its leader's", () => {
    // Web gates the link on `assignee_type === "agent"` for the same reason
    // (autopilot-detail-page.tsx:836): the banner still explains, it just
    // does not promise a destination.
    expect(canJumpToRuntimeBinding({ assignee_type: "squad" })).toBe(false);
  });

  it("lands on the agent's edit form, which owns the runtime picker", () => {
    expect(runtimeBindingHref("acme", "agent-1")).toBe(
      "/acme/more/agents/agent-1/edit",
    );
  });
});
