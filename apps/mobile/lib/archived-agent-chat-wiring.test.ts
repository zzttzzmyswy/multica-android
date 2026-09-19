/**
 * Wiring guard for archived-agent chat sessions.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so a correct `resolveSessionAgent` helper that the chat screen
 * never calls fixes nothing. Web resolves the open session's agent from the
 * archived-inclusive agent list and renders `ArchivedAgentBanner` in a slot
 * whose precedence is no-agent > archived > runtime-required > offline
 * (`packages/views/chat/components/chat-window.tsx`); this guard pins that the
 * mobile screen does the same, and that it does not fall back to the
 * archived-free list or to a bare `find`.
 *
 * Matches call syntax after stripping comments, so a comment quoting the call
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

const CHAT = "app/(app)/[workspace]/(tabs)/chat.tsx";
const SESSIONS = "app/(app)/[workspace]/chat-sessions.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("archived-agent chat wiring", () => {
  const chat = code(CHAT);

  it("resolves the session's agent through the shared helper", () => {
    expect(chat).toContain('from "@/lib/chat-session-agent"');
    expect(chat).toMatch(
      /resolveSessionAgent\(\s*agents\s*,\s*activeSession\.agent_id\s*\)/,
    );
  });

  it("does not resolve the session's agent with a bare list find", () => {
    expect(chat).not.toMatch(/agents\.find\(\s*\(a\)\s*=>\s*a\.id ===/);
  });

  it("reads the archived-inclusive agent query, not the archived-free one", () => {
    expect(chat).toContain("agentListAllOptions(wsId)");
    expect(chat).not.toContain("agentListOptions(wsId)");
  });

  it("derives archived-ness from the shared predicate", () => {
    expect(chat).toContain("isAgentArchived(currentAgent)");
  });

  it("renders the archived banner, gated on that predicate", () => {
    expect(chat).toMatch(
      /sessionAgentArchived\s*\?\s*\(\s*<ArchivedAgentBanner/,
    );
  });

  it("puts the archived banner ahead of the runtime and presence banners", () => {
    // Web's slot precedence. A retired agent is read-only rather than offline,
    // so it must not be shadowed by the presence branches.
    const archived = chat.indexOf("<ArchivedAgentBanner");
    const offline = chat.indexOf("<OfflineBanner");
    const runtime = chat.indexOf("<RuntimeRequiredBanner");
    expect(archived).toBeGreaterThan(-1);
    expect(archived).toBeLessThan(offline);
    expect(archived).toBeLessThan(runtime);
  });

  it("disables the composer with the archived reason", () => {
    expect(chat).toMatch(/sessionAgentArchived\s*\?\s*t\("chat\.agentArchived"\)/);
  });

  it("refuses to send into an archived conversation", () => {
    expect(chat).toMatch(/if \(sessionAgentArchived\) return;/);
  });

  it("resolves session-list rows from the archived-inclusive list too", () => {
    const sessions = code(SESSIONS);
    expect(sessions).toContain("agentListAllOptions(wsId)");
    expect(sessions).not.toContain("agentListOptions(wsId)");
  });
});
