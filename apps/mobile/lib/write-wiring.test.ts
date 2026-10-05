import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring guard for the write-failure channel (iterations 195-196).
 *
 * The behaviour is proven in `write-failure-channel.test.ts` against the real
 * @tanstack/query-core. What a behavioural test cannot catch is a *new*
 * user-facing write that nobody gave a title meta: it would fail in total
 * silence, which is exactly the defect iteration 195 closed, reintroduced by an
 * unrelated later change.
 *
 * The opt-out is deliberate and must stay available (mark-read calls are
 * bookkeeping the user never asked for), so this cannot assert "every mutation
 * has a title". It asserts the narrower, checkable properties: the mutations
 * reachable from a surface that closes itself report their failure, and no
 * call site reports the same failure twice.
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
  // Iteration 196 — the inbox cluster. Web raises a toast for every one of
  // these (packages/views/inbox/components/inbox-page.tsx:340-426); mobile
  // rolled the optimistic patch back and said nothing.
  ["data/mutations/inbox.ts", "useArchiveInbox", "inbox.archiveFailed"],
  ["data/mutations/inbox.ts", "useUnarchiveInbox", "inbox.unarchiveFailed"],
  ["data/mutations/inbox.ts", "useMarkInboxRead", "inbox.markReadFailed"],
  ["data/mutations/inbox.ts", "useMarkInboxUnread", "inbox.markUnreadFailed"],
  ["data/mutations/inbox.ts", "useMarkAllInboxRead", "inbox.markReadFailed"],
  ["data/mutations/inbox.ts", "useArchiveAllInbox", "inbox.batchFailed"],
  ["data/mutations/inbox.ts", "useArchiveAllReadInbox", "inbox.batchFailed"],
  ["data/mutations/inbox.ts", "useArchiveCompletedInbox", "inbox.batchFailed"],
  // Destructive deletes: the confirm dialog promises the action cannot be
  // undone, so silence is the one outcome that reads as success.
  ["data/mutations/issues.ts", "useDeleteIssue", "issue.deleteFailed"],
  ["data/mutations/projects.ts", "useDeleteProject", "project.deleteFailed"],
  // Autopilot access and the notification toggles: web toasts each of these
  // (autopilot-access-manager.tsx:69, notifications-tab.tsx:53).
  ["data/mutations/autopilots.ts", "useGrantAutopilotAccess", "autopilots.access.failedTitle"],
  ["data/mutations/autopilots.ts", "useRevokeAutopilotAccess", "autopilots.access.failedTitle"],
  ["data/mutations/quick-actions.ts", "useCreateQuickAction", "quickActions.createFailed"],
  ["data/mutations/notification-preferences.ts", "useUpdateNotificationPreferences", "notif.saveFailed"],
];

/** Hooks whose title is a PARAMETER rather than a hardcoded literal, so one
 *  hook can serve both a picker write and a save-specific form. [file, hook,
 *  default title id]. The literal must still appear — as the default value. */
const PARAMETERISED_MUTATIONS: [string, string, string][] = [
  ["data/mutations/issues.ts", "useUpdateIssue", "issueRelation.updateFailed"],
  ["data/mutations/projects.ts", "useUpdateProject", "projects.updateFailed"],
];

/** Screens that override a parameterised hook's default title with their own
 *  save-specific line: [file, hook var, expected key]. Their form is not a
 *  picker — it stays on screen while the write is in flight — so this is an
 *  override of the *message*, not a second reporting channel. */
const SPECIALISED_SITES: [string, string, string][] = [
  ["app/(app)/[workspace]/issue/[id]/edit.tsx", "useUpdateIssue", "editIssue.failedTitle"],
  ["app/(app)/[workspace]/project/[id]/edit.tsx", "useUpdateProject", "editProject.failedTitle"],
];

/** Screens that hand a mutation a per-call `onError`.
 *
 *  This is the iteration-196 regression guard. A hook-level title makes the
 *  MutationCache outlet fire on every failure of that mutation; a per-call
 *  `onError` on the same call is a SECOND, independent channel
 *  (`mutation.js:148` calls the cache handler, `mutationObserver.js` calls the
 *  per-call one, gated on `hasListeners()`). Mounted, both fire — two alerts
 *  for one failure. Unmounted, only the cache one fires. So a per-call handler
 *  on a hook that already carries a title is never the better half of the pair:
 *  it is either duplicate noise or dead code. */
const PER_CALL_HANDLERS_THAT_MUST_NOT_COEXIST: [string, string][] = [
  // [file, hook var whose hook carries a write-failure title]
  ["app/(app)/[workspace]/issue/[id].tsx", "updateRelations"],
  ["app/(app)/[workspace]/issue/[id]/edit.tsx", "update"],
  ["app/(app)/[workspace]/issue/[id]/picker/child.tsx", "updateRelations"],
  ["app/(app)/[workspace]/issue/[id]/picker/parent.tsx", "updateRelations"],
  ["app/(app)/[workspace]/project/[id]/edit.tsx", "update"],
  // The parent row inside the issue detail renders the same remove-parent
  // write as the actions menu; both sites kept their own handler when the
  // hook grew a title.
  ["components/issue/issue-parent-section.tsx", "updateRelations"],
];

/** The awaited counterpart of the list above: a call site that reports by
 *  catching the rejection of a `mutateAsync` the hook already titles.
 *
 *  It is the same defect wearing different syntax — and the one form that
 *  actually DID fire twice, because `try/catch` runs on the component's own
 *  lifetime rather than behind `hasListeners()`. `quick-action-form.tsx` kept
 *  both a hook title and a `catch`-and-Alert for two saves and an archive
 *  toggle, so one failure raised two dialogs. A `catch` may still exist for
 *  control flow (keeping the form open, re-enabling Save) — what it must not do
 *  is alert. */
const AWAITED_SITES_THAT_MUST_NOT_ALERT: [string, string][] = [
  ["components/quick-action/quick-action-form.tsx", "handleSave"],
  ["components/quick-action/quick-action-form.tsx", "handleArchiveToggle"],
];

/** The body of one function declared as `const NAME = async () => {`, up to the
 *  next top-level `const`/`};` boundary — enough to cover the whole try/catch. */
function handlerBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = async`);
  if (start === -1) return "";
  const end = src.indexOf("\n  const ", start + 1);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

/** The body of one exported function, so a meta in a sibling hook cannot
 *  satisfy the assertion for this one. */
function hookBody(src: string, hook: string): string {
  const start = src.indexOf(`export function ${hook}(`);
  expect(start, `${hook} not found`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.indexOf("\nexport function ");
  return next === -1 ? rest : rest.slice(0, next);
}

/** The call expression starting at `varName.mutate(`, up to its matching close
 *  paren — so `onError` inside the options object is found but `onError` in an
 *  unrelated earlier statement is not. */
function callWindow(src: string, varName: string): string {
  const idx = src.indexOf(`${varName}.mutate`);
  if (idx === -1) return "";
  const open = src.indexOf("(", idx);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  return src.slice(idx);
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

    for (const [, , titleKey] of [
      ...REPORTING_MUTATIONS,
      ...PARAMETERISED_MUTATIONS,
      ...SPECIALISED_SITES.map(
        ([, , key]) => ["", "", key] as [string, string, string],
      ),
    ]) {
      // A missing key renders as the raw id, which is barely enough to notice
      // — and is the silence this replaced, wearing a debug string.
      expect(zh[titleKey], `zh missing ${titleKey}`).toBeTruthy();
      expect(en[titleKey], `en missing ${titleKey}`).toBeTruthy();
    }
  });
});

describe("no write reports its failure twice", () => {
  // The regression iteration 195 shipped: giving a hook a title while a call
  // site kept its own `onError` puts two alerts on one failure while the screen
  // is mounted, and leaves the per-call one dead once it unmounts.
  for (const [file, varName] of PER_CALL_HANDLERS_THAT_MUST_NOT_COEXIST) {
    it(`${file} does not pass ${varName} a per-call onError`, () => {
      const window = callWindow(code(file), varName);
      expect(window, `${varName}.mutate call not found in ${file}`).not.toBe("");
      expect(window).not.toContain("onError");
    });
  }

  // The awaited form of the same defect. These handlers keep a `catch` for
  // control flow, so the assertion is on what it CONTAINS, not that it exists.
  for (const [file, handler] of AWAITED_SITES_THAT_MUST_NOT_ALERT) {
    it(`${file} ${handler} does not alert from its catch`, () => {
      const body = handlerBody(code(file), handler);
      expect(body, `${handler} not found in ${file}`).not.toBe("");
      const catches = body.match(/catch\s*(\([^)]*\))?\s*\{[\s\S]*?\n {4}\}/g);
      expect(catches, `${handler} has no catch to inspect`).not.toBeNull();
      for (const block of catches ?? []) {
        expect(block, `${handler} alerts from catch`).not.toContain("Alert.alert");
      }
    });
  }
});

describe("a form screen's failure line is its own", () => {
  // These two screens write a whole form, so "Failed to save" beats the
  // attribute-picker's generic line. The override is passed to the hook (the
  // hook meta is the only channel that survives the screen popping); asserting
  // the call site keeps it honest.
  for (const [file, hook, key] of SPECIALISED_SITES) {
    it(`${file} passes ${key} to ${hook}`, () => {
      const src = code(file);
      const idx = src.indexOf(`${hook}(`);
      expect(idx, `${hook}( not found in ${file}`).toBeGreaterThan(-1);
      expect(src.slice(idx, idx + 120)).toContain(`"${key}"`);
    });
  }
});
