/**
 * Attachment plumbing for the agent-mode quick-create form (`new-issue.tsx` →
 * `components/issue/quick-create-panel.tsx`, endpoint
 * `POST /api/issues/quick-create`).
 *
 * Until this module existed, mobile's agent panel was a bare `<TextInput>`: the
 * manual tab of the same modal could attach a file and the agent tab could not,
 * even though the request contract already carried `attachment_ids`
 * (`server/internal/handler/issue.go` `QuickCreateIssueRequest`) and the daemon
 * receives them on the task. Web's agent panel uses the same rich editor as its
 * manual form for exactly this reason — the prompt is where "fix this
 * screenshot / read this log" lives, so the attachment IS the task.
 *
 * Pure functions only, so the node vitest lane can pin them (same pattern as
 * `lib/run-confirm.ts`): the decisions that lose a user's file if they regress
 * are worth testing without an RN renderer.
 */

/**
 * Append a freshly uploaded attachment id, ignoring one already collected.
 *
 * The id comes from the server per upload, so a genuine re-upload of the same
 * file is a different id and is kept. The dedup is for a repeated callback for
 * ONE upload — the toolbar can fire once per picker result, but a retry path or
 * a double-tap that slips past the toolbar's `disabled` would otherwise send
 * the same id twice and make the server bind/validate it twice.
 */
export function addUploadedAttachmentId(
  prev: string[],
  id: string,
): string[] {
  return prev.includes(id) ? prev : [...prev, id];
}

/**
 * `attachment_ids` fragment for a create payload — omitted entirely when
 * nothing was uploaded.
 *
 * Spread as `...(attachmentIdsPayload(ids))`. Emitting `attachment_ids: []`
 * instead is not equivalent: the field is `omitempty` on the server and an
 * empty array still travels as JSON, so the request stops being
 * byte-identical to the pre-attachment one that the no-upload path has always
 * sent (and gives the server a UUID-parse branch to run over nothing).
 */
export function attachmentIdsPayload(ids: string[]): {
  attachment_ids?: string[];
} {
  return ids.length > 0 ? { attachment_ids: ids } : {};
}

/**
 * Whether the agent-mode submit button may fire.
 *
 * `uploadsPending` is the gate that matters and the reason this is a function
 * rather than an inline expression: an attachment that has been picked but is
 * still uploading has no id yet, so submitting mid-upload silently drops the
 * file the user just chose — the prompt reaches the agent with a dangling
 * `![](…)` link and no bound attachment. Manual mode holds submit on the same
 * flag (`new-issue.tsx` `uploadsPending`); web does it with `useUploadGate`.
 * The panel's toolbar disables itself while uploading, but the header submit
 * button is a separate control and needs its own hold.
 */
export function canSubmitQuickCreate(input: {
  /** Live prompt text (raw, pre-serialization). */
  prompt: string;
  /** An agent or squad has been picked — the task needs a destination. */
  hasActor: boolean;
  /** A quick-create request is already in flight. */
  submitting: boolean;
  /** An attachment pick is still uploading. */
  uploadsPending: boolean;
}): boolean {
  return (
    !input.submitting &&
    !input.uploadsPending &&
    input.prompt.trim().length > 0 &&
    input.hasActor
  );
}
