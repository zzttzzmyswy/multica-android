import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Iteration 216 (MYS-2040) — wiring ratchet for the wakeup CREATE surface.
 *
 * The mobile vitest lane is Node-only (`vitest.config.ts`: no RN renderer), so
 * `lib/wakeup-draft.test.ts` being green proves the DECISIONS are right and
 * nothing at all about whether any screen asks for them. That gap is exactly
 * where this round's defect lived for two rounds: `buildWakeupInput` can be
 * perfect while `wakeups-section.tsx` renders no entry point and
 * `data/api.ts` has no method to POST to — and every unit test stays green.
 *
 * Same shape and same reason as `lib/wakeup-write-wiring.test.ts` (MYS-2031).
 * Comments are stripped before matching, so a comment that merely *describes*
 * the wiring cannot satisfy an assertion.
 */
const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body of ONE exported hook, up to the next one. An assertion about the
 *  create hook's own options has to be scoped this way: `issue-wakeups.ts`
 *  holds eight hooks that all invalidate and all carry a title, so a match over
 *  the whole file stays green after the create hook loses either — which is
 *  exactly what the first run of `iter222-guards.sh` caught. */
function hookBody(src: string, hook: string): string {
  const start = src.indexOf(`export function ${hook}(`);
  if (start === -1) return "";
  const rest = src.slice(start + 1);
  const next = rest.indexOf("\nexport function ");
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the issue wakeup section can create, not just act", () => {
  const section = code("components/issue/wakeups-section.tsx");
  const sheet = code("components/issue/wakeup-create-sheet.tsx");
  const mutations = code("data/mutations/issue-wakeups.ts");
  const api = code("data/api.ts");

  it("renders the create entry from the section header", () => {
    // The whole defect of this round: the section listed rules and offered no
    // way to add one.
    expect(section).toContain("WakeupCreateSheet");
    expect(section).toMatch(/setCreateOpen\(true\)/);
  });

  it("hides the create entry on a closed issue", () => {
    // Web gates the entry on `{!closed && <WakeupCreate …/>}`
    // (wakeups-section.tsx:438) and the server refuses a create on a closed
    // issue ("issue is closed"), so an entry that leaked through here would be
    // a control whose only outcome is a 400.
    expect(section).toMatch(/\{!closed \? \(\s*\n?\s*<Pressable/);
  });

  it("mounts the create sheet only while it is open", () => {
    // The form owns a draft and four directory reads; one left mounted behind a
    // closed sheet keeps all of them alive.
    expect(section).toMatch(/\{createOpen \? \(\s*\n?\s*<WakeupCreateSheet/);
  });

  it("seeds the wake target from the issue's agent assignee", () => {
    // Web passes `issue.assignee_type === "agent" ? issue.assignee_id : undefined`
    // (issue-detail.tsx:2873). Both surfaces that render this section pass it,
    // or a rule created from the phone starts on no agent and the form has to
    // ask for one the issue already answers.
    expect(section).toContain("defaultAgentId");
    for (const rel of [
      "components/issue/timeline-list.tsx",
      "app/(app)/[workspace]/issue/[id]/wakeups.tsx",
    ]) {
      const src = code(rel);
      expect(src, `${rel} must pass defaultAgentId`).toMatch(
        /defaultAgentId=\{\s*\n?\s*issue\??\.assignee_type === "agent"/,
      );
    }
  });
});

describe("the create form posts through the whole stack", () => {
  const sheet = code("components/issue/wakeup-create-sheet.tsx");
  const mutations = code("data/mutations/issue-wakeups.ts");
  const api = code("data/api.ts");

  it("has an api method that POSTs the wakeup collection", () => {
    expect(api).toContain("async createIssueWakeup(");
    expect(api).toMatch(
      /`\/api\/issues\/\$\{encodeURIComponent\(issueId\)\}\/wakeups`/,
    );
    expect(api).toMatch(/method: "POST"/);
  });

  it("never lets a create degrade to a success", () => {
    // The reads fall back to an empty list on a broken payload; a create must
    // not. A create that resolved on failure would close the sheet as if a rule
    // existed and the user would only find out because nothing ever fires. The
    // assertion is on the method body: no `fetchValidated`, no fallback.
    const body = api.slice(api.indexOf("async createIssueWakeup("));
    const end = body.indexOf("\n  async ", 10);
    const method = end === -1 ? body : body.slice(0, end);
    expect(method).not.toContain("fetchValidated");
    expect(method).not.toContain("parseWithFallback");
  });

  it("binds the create mutation in the form", () => {
    expect(sheet).toContain("useCreateIssueWakeup");
    expect(sheet).toMatch(/create\.mutate\(/);
  });

  it("carries a write-failure title on the create hook", () => {
    // Mobile's reporting channel is the QueryClient's MutationCache, and it
    // only fires for a mutation whose own options carry the meta. Without it a
    // refused create would roll nothing back and say nothing.
    const hook = hookBody(mutations, "useCreateIssueWakeup");
    expect(hook).toContain("WRITE_FAILURE_TITLE_KEY");
    expect(hook).toContain('"wakeups.createError"');
  });

  it("does not report the same failure from the form as well", () => {
    // Hook-level meta + a per-call `onError` is TWO alerts for one failure
    // while the sheet is mounted, and the per-call one is dead once it
    // unmounts (`mutationObserver.js:77` gates it on hasListeners()).
    // `lib/write-wiring.test.ts` documents the rule; this pins it for the new
    // form, whose `onError` exists only to keep the sheet open.
    const call = sheet.slice(sheet.indexOf("create.mutate("));
    const window = call.slice(0, call.indexOf("});"));
    expect(window).not.toContain("Alert.alert");
  });

  it("refreshes the section's own caches on settle", () => {
    // A create must make the new rule appear with the server's id, revision and
    // next_fire_at. The shared invalidation set is MYS-2031's, reused rather
    // than re-derived so the two write paths cannot clear different caches.
    //
    // Scoped to the create hook's OWN body: an unscoped match over the file
    // would be satisfied by any of the six older hooks' `onSettled`, so the
    // create hook could stop invalidating and this would stay green. The guard
    // reverse-check caught exactly that.
    expect(hookBody(mutations, "useCreateIssueWakeup")).toMatch(
      /onSettled: \(\) => invalidateIssueWakeups\(queryClient, wsId, issueId\)/,
    );
  });

  it("builds the request body through the decision layer, not inline", () => {
    // The must-agree point with web. A hand-rolled body here would drift from
    // `lib/wakeup-draft.ts` silently, and the server's 400 would name a field
    // the user cannot see.
    expect(sheet).toContain("buildWakeupInput(");
    expect(sheet).toContain("wakeupDraftErrorKey(");
  });
});

describe("the create form's keys all exist in both bundles", () => {
  const sheet = code("components/issue/wakeup-create-sheet.tsx");
  const section = code("components/issue/wakeups-section.tsx");
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  /** Literal keys the two files pass to `t(...)`. Dynamic ones (the condition
   *  labels, hints and error ids) are resolved by `wakeup-draft.test.ts`. */
  function literalKeys(src: string): string[] {
    return [...src.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*"([a-zA-Z][a-zA-Z0-9_.]*)"/g)].map(
      (m) => m[1],
    );
  }

  it("resolves every literal create-surface key in both locales", () => {
    const keys = [...new Set([...literalKeys(sheet), ...literalKeys(section)])].filter(
      (key) => key.startsWith("wakeups.create") || key === "wakeups.create.open",
    );
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
      expect(en[key], `en blank ${key}`).not.toBe(key);
    }
  });
});
