import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring guard for the write-failure channel (iteration 195).
 *
 * The behaviour is proven in `write-failure-channel.test.ts` against the real
 * @tanstack/query-core. What a behavioural test cannot catch is a *new*
 * user-facing write that nobody gave a title meta: it would fail in total
 * silence, which is exactly the defect this iteration closed, reintroduced by
 * an unrelated later change.
 *
 * The opt-out is deliberate and must stay available (mark-read calls are
 * bookkeeping the user never asked for), so this cannot assert "every mutation
 * has a title". It asserts the narrower, checkable property: the two mutators
 * that carry every issue/project attribute write — the ones reachable from a
 * picker that closes itself — are configured to report.
 */

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The mutation hooks whose failure used to be invisible. Each entry is
 *  [file, hook name, expected i18n title id]. */
const REPORTING_MUTATIONS: [string, string, string][] = [
  ["data/mutations/issues.ts", "useUpdateIssue", "issueRelation.updateFailed"],
  ["data/mutations/issues.ts", "useUpdateIssueRelations", "issueRelation.updateFailed"],
  ["data/mutations/issues.ts", "useAttachLabel", "labels.attachFailed"],
  ["data/mutations/issues.ts", "useDetachLabel", "labels.attachFailed"],
  ["data/mutations/labels.ts", "useCreateLabel", "labels.createdFailed"],
  ["data/mutations/projects.ts", "useUpdateProject", "projects.updateFailed"],
  ["data/mutations/chat.ts", "useSetChatSessionProject", "chat.projectUpdateFailed"],
  ["data/mutations/quick-actions.ts", "useUpdateQuickAction", "quickActions.updateFailed"],
  ["data/mutations/quick-actions.ts", "useDeleteQuickAction", "quickActions.updateFailed"],
  ["data/mutations/repositories.ts", "useRemoveWorkspaceRepo", "repositories.removeFailed"],
];

/** The body of one exported function, so a meta in a sibling hook cannot
 *  satisfy the assertion for this one. */
function hookBody(src: string, hook: string): string {
  const start = src.indexOf(`export function ${hook}(`);
  expect(start, `${hook} not found`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.indexOf("\nexport function ");
  return next === -1 ? rest : rest.slice(0, next);
}

describe("user-facing writes report their failure", () => {
  for (const [file, hook, titleKey] of REPORTING_MUTATIONS) {
    it(`${hook} carries a write-failure title`, () => {
      const body = hookBody(code(file), hook);
      expect(body).toContain("WRITE_FAILURE_TITLE_KEY");
      expect(body).toContain(`"${titleKey}"`);
    });
  }

  it("the channel is the MutationCache, not a component lifetime", () => {
    // A per-call `onError` passes review but never fires once the picker
    // unmounts (mutationObserver.js:77 gates it on hasListeners()). The
    // QueryClient must own the handler or every one of these writes is silent
    // again in the exact case it was written for.
    const src = code("data/query-client.ts");
    expect(src).toContain("new MutationCache(");
    expect(src).toContain("reportWriteFailure");
  });

  it("keeps the reporting rules free of react-native", () => {
    // `write-failure.ts` is unit-tested in the Node lane, which has no RN
    // renderer; importing Alert there would break that lane. The binding lives
    // in query-client.ts instead.
    expect(code("lib/write-failure.ts")).not.toContain("react-native");
  });

  it("every reporting title id exists in both locales", () => {
    const zh = JSON.parse(
      readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
    ) as Record<string, string>;
    const en = JSON.parse(
      readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
    ) as Record<string, string>;

    for (const [, , titleKey] of REPORTING_MUTATIONS) {
      // A missing key renders as the raw id, which is barely better than the
      // silence this replaced.
      expect(zh[titleKey], `zh missing ${titleKey}`).toBeTruthy();
      expect(en[titleKey], `en missing ${titleKey}`).toBeTruthy();
    }
  });
});
