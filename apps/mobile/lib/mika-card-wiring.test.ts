/**
 * Wiring guard for the Mika setup card on the runtimes page.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so a correct `memberNeedsMikaSetup` that the page never calls
 * fixes nothing. This guard pins the two things that already burned web:
 * the card gates on the *member* predicate (not the workspace one), and the
 * agent list it reads is the archived-inclusive one the rest of the page
 * uses.
 *
 * Matches call syntax after stripping comments, so a comment quoting the call
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

const RUNTIMES = "app/(app)/[workspace]/more/runtimes.tsx";
const CHAT = "app/(app)/[workspace]/(tabs)/chat.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("Mika setup card wiring", () => {
  const page = code(RUNTIMES);

  it("gates on memberNeedsMikaSetup, never workspaceNeedsMika", () => {
    // workspaceNeedsMika is true the moment step 1 of three commits, so the
    // card would unmount mid-flow and never come back.
    expect(page).toMatch(/memberNeedsMikaSetup\(\s*agents\s*,\s*chatSessions\s*\)/);
    expect(page).not.toContain("workspaceNeedsMika");
  });

  it("waits for both lists before deciding", () => {
    // Showing the card while the session list is still loading would offer
    // the entrypoint to a member who already has a kicked-off Mika.
    expect(page).toMatch(/!agentsLoading\s*&&/);
    expect(page).toMatch(/!chatSessionsLoading\s*&&/);
  });

  it("requires at least one runtime, like web", () => {
    expect(page).toMatch(/runtimes\.length\s*>\s*0/);
  });

  it("renders the card inside the scroll container's header", () => {
    expect(page).toContain("<MikaSetupCard");
    expect(page).toMatch(/showMikaCard\s*\?\s*\(/);
  });

  it("bootstraps through the shared mutation and navigates to the session", () => {
    expect(page).toContain("useBootstrapMika(wsId)");
    expect(page).toMatch(/requestSelect\(\s*chatSession\.id\s*\)/);
    expect(page).toMatch(/router\.replace\(`\/\$\{wsSlug\}\/chat`\)/);
  });

  it("sends the app locale as the onboarding content language", () => {
    expect(page).toContain("pickMikaContentLang(locale)");
    expect(page).toMatch(/getMikaOnboarding\(/);
  });

  it("does not let the chat tab's restore heuristic clobber the new session", () => {
    // The restore effect awaits a SecureStore read; a selection that lands
    // while it is in flight (this card's, or the chat-sessions sheet's) must
    // survive it. A bare `setActiveSessionId(open)` would overwrite it and
    // drop the member into their previous conversation instead of Mika's.
    const chat = code(CHAT);
    expect(chat).toMatch(/setActiveSessionId\(\(current\)\s*=>\s*current\s*\?\?\s*open\)/);
  });
});
