/**
 * Behavioural guard for the About page's update card (the 2026-10-15 field
 * report).
 *
 * The reported screen said "当前已是最新版本" while the row beneath it named a
 * newer release. Two independent defects produced that one sentence, and both
 * were *branches*, so both are pinned here as behaviour:
 *
 *   1. `parseVersionSegments` could not read the channel's `mobile-v*` tags,
 *      so the comparison silently degraded to "equal" (pinned in
 *      `app-version.test.ts` / `release-check.test.ts`).
 *   2. The card treated any arrived release as either "update available" or
 *      "up to date" — there was no third state for "I could not read this".
 *
 * This file owns the second. It is deliberately behavioural rather than a
 * source-text match: mobile's vitest lane has no RN renderer, so the previous
 * inline `if` chain in `about.tsx` was untestable, and a regex over JSX would
 * pass on a paraphrase. The resolver is pure, so the assertions are about what
 * the user is told.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { UPDATE_STATE_KEYS, resolveUpdateState, shouldShowUpdateBadge } from "./about-update-state";
import { checkForUpdate } from "./release-check";

describe("resolveUpdateState", () => {
  it("says up-to-date only for a release that was read and is not newer", () => {
    expect(resolveUpdateState("idle", "up-to-date")).toBe("up-to-date");
  });

  it("offers the update for a readable newer release", () => {
    expect(resolveUpdateState("idle", "update-available")).toBe(
      "update-available",
    );
  });

  /**
   * The heart of the fix. An unreadable tag must NOT be reported as "up to
   * date": the old code path collapsed it there, which is what let a dead
   * update channel look like a healthy one for ~40 releases.
   */
  it("reports an unreadable tag as its own state, not as up-to-date", () => {
    const state = resolveUpdateState("idle", "unreadable");
    expect(state).toBe("unreadable");
    expect(state).not.toBe("up-to-date");
  });

  it("distinguishes 'not looked yet' from 'looked and cannot say'", () => {
    // No payload yet → idle (the card invites a check).
    expect(resolveUpdateState("idle", null)).toBe("idle");
    // Payload arrived but unreadable → a failure worth reporting.
    expect(resolveUpdateState("idle", "unreadable")).toBe("unreadable");
  });

  it("lets a transport/flow phase win over the check result", () => {
    expect(resolveUpdateState("checking", null)).toBe("checking");
    expect(resolveUpdateState("checking", "update-available")).toBe("checking");
    expect(resolveUpdateState("network-error", "up-to-date")).toBe(
      "network-error",
    );
    expect(resolveUpdateState("no-asset", "update-available")).toBe("no-asset");
    expect(resolveUpdateState("foreign-package", "update-available")).toBe(
      "foreign-package",
    );
    expect(resolveUpdateState("downloading", "update-available")).toBe(
      "downloading",
    );
  });

  it("maps every state to a message key, and no state to a blank one", () => {
    const states = [
      "checking",
      "network-error",
      "no-asset",
      "foreign-package",
      "downloading",
      "update-available",
      "up-to-date",
      "unreadable",
      "idle",
    ] as const;
    expect(Object.keys(UPDATE_STATE_KEYS).sort()).toEqual([...states].sort());
    for (const state of states) {
      expect(UPDATE_STATE_KEYS[state]).toMatch(/^[a-z]+\.[a-zA-Z.]+$/);
    }
    // Every state the resolver can return must be renderable.
    for (const phase of [
      "idle",
      "checking",
      "network-error",
      "no-asset",
      "foreign-package",
      "downloading",
    ] as const) {
      for (const check of [
        null,
        "update-available",
        "up-to-date",
        "unreadable",
      ] as const) {
        expect(UPDATE_STATE_KEYS[resolveUpdateState(phase, check)]).toBeTruthy();
      }
    }
  });
});

/**
 * The same distinction, applied to the More popover's dot. The dot makes a
 * positive claim ("a newer release exists"), so an unreadable tag must not
 * light it — and neither may "we never looked".
 */
describe("shouldShowUpdateBadge", () => {
  it("lights for a readable newer release", () => {
    expect(shouldShowUpdateBadge("update-available")).toBe(true);
  });

  it("stays dark for up-to-date and for not-yet-checked", () => {
    expect(shouldShowUpdateBadge("up-to-date")).toBe(false);
    expect(shouldShowUpdateBadge(null)).toBe(false);
  });

  it("stays dark for an unreadable tag rather than promising an update", () => {
    expect(shouldShowUpdateBadge("unreadable")).toBe(false);
  });

  it("agrees with the checker on the reported inputs", () => {
    expect(shouldShowUpdateBadge(checkForUpdate("mobile-v0.6.83", "0.6.43"))).toBe(
      true,
    );
    expect(shouldShowUpdateBadge(checkForUpdate("mobile-v0.6.83", "0.6.83"))).toBe(
      false,
    );
  });
});

/**
 * End-to-end over the reported inputs: the exact tag the channel published on
 * 2026-10-15 against the version the reporting device was running.
 */
describe("the 2026-10-15 field report, end to end", () => {
  it("offers mobile-v0.6.83 to a device on 0.6.43", () => {
    const check = checkForUpdate("mobile-v0.6.83", "0.6.43");
    expect(check).toBe("update-available");
    expect(resolveUpdateState("idle", check)).toBe("update-available");
  });
});

/**
 * The resolver only helps if `about.tsx` actually renders its result. This is
 * the one assertion that has to look at the source, and it looks for the call,
 * not for the branch structure — the branch under test lives in the resolver.
 */
describe("about.tsx renders the resolved state", () => {
  const ABOUT = path.resolve(
    __dirname,
    "../app/(app)/[workspace]/more/about.tsx",
  );
  const src = readFileSync(ABOUT, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("drives the card from resolveUpdateState and the shared key map", () => {
    expect(src).toMatch(/resolveUpdateState\(phase, check\)/);
    expect(src).toMatch(/UPDATE_STATE_KEYS\[state\]/);
    // The old collapse: deciding the message from a bare boolean/flag chain.
    expect(src).not.toMatch(/unusableTag/);
  });

  /**
   * The doubled-prefix half of the report. The templates already spell a `v`
   * before `{{version}}`, so the value handed to them must be a BARE version
   * (`0.6.83`). Passing the raw tag rendered `vmobile-v0.6.83`.
   *
   * This assertion has to read the source — there is no renderer in this lane —
   * so it pins the two things that make the value bare: it is derived through
   * `displayVersion`, and no `t(...)` call in this file is fed `tag_name`.
   */
  it("hands the templates a bare version, never the raw tag", () => {
    expect(src).toMatch(/displayVersion\(release\.tag_name\)/);
    // No message interpolation may take a raw tag.
    const interpolations = src.match(/t\([^)]*\{[^}]*\}\s*\)/g) ?? [];
    for (const call of interpolations) {
      expect(call).not.toMatch(/tag_name/);
    }
    expect(src).toMatch(/\{\s*version:\s*latestVersion,?\s*\}/);
  });
});
