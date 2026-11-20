/**
 * Wiring guard for comment run steering (iteration 298).
 *
 * `lib/recipient-routing.test.ts` proves the DECISION rules. What it cannot
 * see is whether the decision ever reaches the server: the composer could
 * compute the right `steer_task_ids` and then drop them on the floor, and
 * every unit test would still pass while the phone stayed exactly as broken as
 * before.
 *
 * So this asserts the chain end to end, on the source, at each hop:
 *
 *   chips ← routing        (the composer passes recipients + a setter)
 *   mutation ← routing     (suppress + steer ids reach `createComment`)
 *   wire ← mutation        (`steer_task_ids` is in the POST body)
 *   stop-before-post       (restart turns are cancelled before the comment)
 *
 * It fails loudly if any hop is refactored away, which is the failure mode
 * this feature is most exposed to: every hop is an optional prop, so removing
 * one is silent at runtime and only shows up as a comment that queues a
 * follow-up run instead of correcting the one in flight.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("comment run steering is wired end to end", () => {
  it("the composer derives routing from the preview agents and passes it down", () => {
    const src = code("components/issue/inline-comment-composer.tsx");
    expect(src).toMatch(/useRecipientRouting\(/);
    // The chips must be in ROUTING mode (recipients + setter), not the legacy
    // skip-only mode — otherwise the menu the user taps is the old one.
    expect(src).toMatch(/recipients=\{recipients\}/);
    expect(src).toMatch(/onActionChange=\{setAction\}/);
    // Both submit lists must reach the mutation.
    expect(src).toMatch(/suppressAgentIds:\s*routing\.suppressAgentIds/);
    expect(src).toMatch(/steerTaskIds,/);
  });

  it("restart turns are stopped BEFORE the comment is posted", () => {
    const src = code("components/issue/inline-comment-composer.tsx");
    const stopIdx = src.indexOf("routing.restartTaskIds");
    const postIdx = src.indexOf("createComment.mutateAsync");
    expect(stopIdx).toBeGreaterThan(-1);
    expect(postIdx).toBeGreaterThan(-1);
    // Order is the whole contract: posting first would deliver the message to
    // the very run the user asked to abandon.
    expect(stopIdx).toBeLessThan(postIdx);
    // A failed stop must abort the send, not post anyway.
    expect(src).toMatch(/restart_failed/);
    expect(src).toMatch(/throw new Error/);
  });

  it("the attachment gate reaches the routing hook", () => {
    // A running turn takes text only. If the composer stopped reporting the
    // attachment count, the menu would keep offering "add to current run" for
    // a message the server cannot deliver that way.
    const src = code("components/issue/inline-comment-composer.tsx");
    expect(src).toMatch(/hasAttachments/);
    expect(src).toMatch(/onAttachmentsChange=\{setHasAttachments\}/);
    expect(src).toMatch(/steer_attachment_notice/);
    const composer = code("components/composer/message-composer.tsx");
    expect(composer).toMatch(/onAttachmentsChange\?\.\(hasAttachments\)|onAttachmentsChange\(hasAttachments\)/);
  });

  it("the composer forwards steerTaskIds in the onSubmit payload", () => {
    // NOT "the file mentions steerTaskIds" — the prop declaration does that.
    // The payload object is what actually crosses to the parent, so assert
    // inside the `onSubmit({...})` call. (Mutation-checked: deleting the field
    // from the payload while leaving the prop behind must fail here.)
    const src = code("components/composer/message-composer.tsx");
    const call = src.slice(src.indexOf("await onSubmit({"));
    const payload = call.slice(0, call.indexOf("});"));
    expect(payload).toMatch(/steerTaskIds/);
    expect(payload).toMatch(/suppressAgentIds/);
  });

  it("the mutation forwards steerTaskIds to the API", () => {
    const src = code("data/mutations/issues.ts");
    expect(src).toMatch(/steerTaskIds\?: string\[\]/);
    // Same trap as above: the vars type and the retry payload both mention the
    // name. The API call is the hop that matters.
    const call = src.slice(src.indexOf("api.createComment("));
    const args = call.slice(0, call.indexOf("}),"));
    expect(args).toMatch(/steerTaskIds/);
    // A failed send keeps the choice so a Retry sends exactly what the first
    // attempt would have — including which turn it meant to steer.
    expect(src).toMatch(/steerTaskIds:\s*vars\.steerTaskIds/);
  });

  it("the API puts steer_task_ids in the POST body, and only when non-empty", () => {
    const src = code("data/api.ts");
    expect(src).toMatch(/steer_task_ids:\s*opts\.steerTaskIds/);
    // Empty must be OMITTED, not sent as `[]`: an ordinary comment's body has
    // to stay byte-identical to what this client posted before the feature.
    expect(src).toMatch(/opts\?\.steerTaskIds\?\.length/);
  });

  it("the chips render one action per recipient instead of a skip toggle", () => {
    const src = code("components/issue/comment-trigger-chips.tsx");
    // The routing branch must exist and be gated on BOTH props, so a caller
    // without a task list keeps the old, honest behaviour.
    expect(src).toMatch(/if \(recipients && onActionChange\)/);
    expect(src).toMatch(/recipient_steer/);
    expect(src).toMatch(/recipient_restart/);
  });

  it("every action label the menu can show has a bundle entry in both locales", () => {
    const zh = JSON.parse(source("lib/i18n/locales/zh.json"));
    const en = JSON.parse(source("lib/i18n/locales/en.json"));
    const keys = [
      "comment.recipient_steer",
      "comment.recipient_steer_desc",
      "comment.recipient_after_run",
      "comment.recipient_after_run_desc",
      "comment.recipient_restart",
      "comment.recipient_restart_desc",
      "comment.recipient_join",
      "comment.recipient_join_desc",
      "comment.recipient_state_running",
      "comment.recipient_state_starting",
      "comment.recipient_state_queued",
      "comment.recipient_menu_aria",
      "comment.recipient_menu_title",
      "comment.recipient_count_one",
      "comment.recipient_count_other",
      "comment.steer_attachment_notice",
      "comment.restart_failed",
    ];
    for (const key of keys) {
      expect(zh[key], `zh missing ${key}`).toBeTypeOf("string");
      expect(en[key], `en missing ${key}`).toBeTypeOf("string");
    }
  });
});
