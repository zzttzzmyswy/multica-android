/**
 * The two failure prompts `new-issue.tsx` raises after a submit, kept out of
 * the screen so each sentence's SHAPE is testable (iteration 259, MYS-2245).
 *
 * A screen-level `Alert.alert(...)` is invisible to the Node vitest lane, which
 * is where this repo tests decisions (`lib/actor-name-state.ts`,
 * `lib/write-failure.ts`). The previous round's lesson applies: any rule that
 * lives only inside JSX gets re-derived from memory at the next call site and
 * drifts. So both prompts are built here as plain data — title, message, and
 * the buttons with their callbacks — and the screen only hands the result to
 * `Alert.alert`.
 *
 * ## Why the duplicate prompt carries a button at all
 *
 * Web's duplicate toast has a "View existing issue" action
 * (`create-issue.tsx:636-647`). Without it the refusal is a dead end: the
 * server has told the client exactly which issue is in the way, and the user
 * would still have to go search the title by hand. So the primary button
 * navigates, and the cancel button is the "let me fix the title" exit.
 *
 * ## Why `router.replace` and not `push`
 *
 * The create screen is a `modal` in the workspace Stack. `replace` swaps it out
 * for the destination in one transition and leaves the history as
 * `[..., <the screen under the modal>, issueDetail]`, so the back gesture from
 * the issue lands where the user started. That is the pattern this app already
 * uses for modal → detail jumps (`search.tsx:174`, with the reasoning spelled
 * out there); a `push` would stack the detail ON the modal and back would
 * return to a form for an issue that already exists.
 */
import type { DuplicateIssueErrorBody } from "@multica/core/api";
import { duplicateIssueLine, duplicateIssueRoute } from "./duplicate-issue-error";

/** A button on a prompt, in the shape React Native's `Alert.alert` takes. */
export interface PromptButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

export interface Prompt {
  title: string;
  message?: string;
  buttons: PromptButton[];
}

/** Bridge for the two platform calls the prompts need. Injected so the test
 *  lane can observe what the screen would have done. */
export interface PromptDeps {
  /** Signature-compatible with `useTranslation().t`, whose params are
   *  `Record<string, string | number>`; these prompts pass no variables, so the
   *  narrower param type is the honest one to declare. */
  t: (key: string, params?: Record<string, string | number>) => string;
  wsSlug: string | null | undefined;
  navigate: (path: string) => void;
}

/**
 * The prompt for a structured duplicate refusal.
 *
 * Falls back to a single OK button when the workspace slug is unknown — the
 * issue routes are `/[workspace]/issue/[id]`, so there is no path to build and
 * a button that cannot navigate is worse than none. That branch is reachable
 * in practice (a deep link into the modal before the workspace store hydrated)
 * and is covered by a unit test rather than left to chance.
 */
export function duplicateCreatePrompt(
  issue: DuplicateIssueErrorBody["issue"],
  deps: PromptDeps,
): Prompt {
  const { t, wsSlug, navigate } = deps;
  const path = duplicateIssueRoute(wsSlug, issue.id);
  const message = duplicateIssueLine(issue);

  if (!path) {
    return {
      title: t("newIssue.duplicateTitle"),
      message,
      buttons: [{ text: t("common.ok"), style: "default" }],
    };
  }

  return {
    title: t("newIssue.duplicateTitle"),
    message,
    buttons: [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("newIssue.duplicateView"),
        style: "default",
        onPress: () => navigate(path),
      },
    ],
  };
}
