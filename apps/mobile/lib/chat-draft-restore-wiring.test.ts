/**
 * Wiring guard for cancelled-prompt restoration (#5219).
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so a correct `planCancelRestore` that the chat screen never calls
 * fixes nothing, and neither does a composer that never reports its
 * work-in-progress back. This guard pins the CALL SITES: every place the app
 * can cancel a chat task must read the response, and the composer slot must be
 * wired end to end.
 *
 * The bug this iteration fixes is precisely a missing call site — the response
 * was discarded — so call-site assertions are the ones that would have caught
 * it. Matches call syntax after stripping comments, so a comment quoting the
 * call cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

const CHAT = "app/(app)/[workspace]/(tabs)/chat.tsx";
const COMPOSER = "components/composer/message-composer.tsx";
const CHAT_COMPOSER = "components/chat/chat-composer.tsx";
const API = "data/api.ts";
const SESSION_REALTIME = "data/realtime/use-chat-session-realtime.ts";
const LAYOUT = "app/_layout.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("cancel call sites read the response instead of discarding it", () => {
  const chat = code(CHAT);

  it("stops a task through the response-reading path, not a bare void call", () => {
    // The exact regression: `void api.cancelTaskById(taskId).catch(...)` threw
    // away the body, which on the legacy branch is the only copy of the prompt.
    expect(chat).not.toMatch(/void api\.cancelTaskById\(/);
    expect(chat).toMatch(/planCancelRestore\(/);
  });

  it("plans the restore at every cancellation site", () => {
    // stop, steer (the running head it displaces), and the queued edit/remove.
    const plans = chat.match(/planCancelRestore\(/g) ?? [];
    expect(plans.length).toBeGreaterThanOrEqual(4);
  });

  it("evicts the bubble the server deleted", () => {
    expect(chat).toMatch(/removeChatMessageFromCache\(qc, sessionId, plan\.removeMessageId\)/);
  });

  it("hands a synchronous restore to the persisted queue", () => {
    expect(chat).toMatch(/if \(plan\.restore\) enqueueLocalRestore\(plan\.restore\)/);
  });

  it("keeps the queue-edit optimistic draft as a fallback, not the primary", () => {
    // The server is authoritative now; `queueEditDraftText` only covers a
    // response with no payload (an older server).
    expect(chat).toMatch(/setDraft\(sessionId, plan\.restore\.content\)/);
    expect(chat).toMatch(/queueEditDraftText\(task\)/);
  });

  it("settles the durable row the queued-edit response already satisfied", () => {
    // The queued-edit branch both writes a durable row and returns its content,
    // so waiting for the fetch to hand it over would duplicate the round trip.
    expect(chat).toMatch(/settleDurableRestore\(sessionId, plan\.restore\.id\)/);
  });

  it("recovers from the session-menu stop too, not just the composer's", () => {
    // Stop is reachable from three places (composer, header ⋯ menu, session
    // list). Leaving one on the old void call would make the SAME user action
    // lose the prompt from one affordance and recover it from another — worse
    // than the original bug, because it looks nondeterministic.
    const stop = code("data/mutations/chat.ts");
    expect(stop).not.toMatch(/api\.cancelTaskById\(\s*taskId\s*\)\s*,\s*\n?\s*onMutate/);
    expect(stop).toMatch(/planCancelRestore\(/);
    expect(stop).toMatch(/removeChatMessageFromCache\(/);
    expect(stop).toMatch(/if \(plan\.restore\) enqueueLocalRestore\(plan\.restore\)/);
  });

  it("recovers in the agent-builder composer too", () => {
    const builder = code("components/agent/builder-workspace.tsx");
    expect(builder).toMatch(/planCancelRestore\(/);
    // Its composer owns the text inline, so the restore goes straight back in.
    expect(builder).toMatch(/setComposer\(plan\.restore\.content\)/);
    expect(builder).toMatch(/removeChatMessageFromCache\(/);
  });

  it("does not leave the queued-remove's deleted bubble on screen", () => {
    // remove means "discard", so no restore — but the server DID delete the
    // message, so the bubble must still go. Asserted by counting: every one of
    // the four cancellation sites (stop, steer, queued edit, queued remove)
    // plans an eviction, so a missing one shows up as a count mismatch rather
    // than needing a fragile textual anchor.
    expect(chat.match(/planCancelRestore\(/g) ?? []).toHaveLength(4);
    expect(
      chat.match(/removeChatMessageFromCache\(qc, sessionId, plan\.removeMessageId\)/g) ?? [],
    ).toHaveLength(4);
    expect(chat).toMatch(
      /queuedAction: "remove",\s*\n\s*restoreDraftToInput: false/,
    );
  });
});

describe("the composer restore slot is wired end to end", () => {
  const chat = code(CHAT);
  const composer = code(COMPOSER);
  const wrapper = code(CHAT_COMPOSER);

  it("mounts the restore hook on the chat screen", () => {
    expect(chat).toMatch(/useChatDraftRestore\(activeSessionId\)/);
  });

  it("passes the offer, the verdict and the report callback to the composer", () => {
    expect(chat).toMatch(/restoreRequest=\{restoreDraftRequest\}/);
    expect(chat).toMatch(/restoreReady=\{restoreApplication === "apply"\}/);
    expect(chat).toMatch(/onRestoreApplied=\{confirmRestoreApplied\}/);
  });

  it("forwards the whole slot through the chat-specific wrapper", () => {
    for (const prop of [
      "restoreRequest={restoreRequest}",
      "restoreReady={restoreReady}",
      "onRestoreApplied={onRestoreApplied}",
    ]) {
      expect(wrapper).toContain(prop);
    }
  });

  it("never routes composer busy-ness back up to the owner", () => {
    // The loop that crashed the app on device: owner state (busy) → hook deps →
    // verdict → `restoreReady` prop → composer effect → owner state. React threw
    // "Maximum update depth exceeded" in ChatTab. The composer owns the guard
    // instead — same WAIT, no cycle.
    expect(chat).not.toMatch(/onBusyChange/);
    expect(chat).not.toMatch(/composerBusy/);
    expect(wrapper).not.toMatch(/onBusyChange/);
  });

  it("applies the restored text AND its attachments", () => {
    expect(composer).toMatch(/setText\(restoreRequest\.content\)/);
    expect(composer).toMatch(/restoredAttachmentToComposerItem/);
  });

  it("reports the hand-off only after writing, never before", () => {
    // Reporting first would let the owner consume the durable row for a
    // hand-off the composer then declined — deleting the prompt's only copy.
    const body = composer.slice(
      composer.indexOf("if (appliedRestoreIdRef.current === restoreId) return;"),
    );
    const write = body.indexOf("setText(restoreRequest.content)");
    const report = body.indexOf("onRestoreApplied?.()");
    expect(write).toBeGreaterThan(-1);
    expect(report).toBeGreaterThan(write);
  });

  it("releases its latch when the offer is withdrawn", () => {
    // A request released because the surface was hidden comes back; a latch
    // that survived it would silently refuse the same id forever.
    expect(composer).toMatch(/appliedRestoreIdRef\.current = null;/);
  });

  it("holds the restore back while the composer has work in progress", () => {
    // The guard that replaced the upward signal. A WAIT — no latch, no report.
    expect(composer).toMatch(/if \(busy\) return;/);
    expect(composer).toMatch(/const busy = text\.trim\(\)\.length > 0 \|\| attachments\.length > 0 \|\| mentions\.length > 0/);
  });

  it("expands so the recovered prompt is visible", () => {
    expect(composer).toMatch(/setExpanded\(true\)/);
  });
});

describe("offering a restore is never terminal", () => {
  // The one ordering rule with no runtime test: consuming (or even recording)
  // a durable restore at OFFER time deletes the prompt's only copy for a
  // hand-off the composer may then decline, because its draft is not empty. The
  // Node lane cannot render the hook, so the structure that makes this true is
  // pinned here instead — `applyTerminal` may appear only in the two paths that
  // run AFTER the composer reports it wrote the text.
  const hook = code("lib/use-chat-draft-restore.ts");

  it("runs no terminal transition from the offer effect", () => {
    // `code()` strips comments, so the effect is located by a code-only anchor:
    // the server-less queue lookup is unique to the offer effect.
    const start = hook.indexOf("const queued = pendingSendRestores[");
    expect(start).toBeGreaterThan(-1);
    // The effect's dependency array closes its body (multi-line, hence `}, [`).
    const end = hook.indexOf("}, [", start);
    expect(end).toBeGreaterThan(start);
    const offerEffect = hook.slice(start, end);
    expect(offerEffect).toContain("setRestoreDraftRequest(");
    expect(offerEffect).not.toContain("applyTerminal");
    expect(offerEffect).not.toContain("markApplied");
    expect(offerEffect).not.toContain("consume(");
  });

  it("routes every terminal transition through the tested consumer", () => {
    const terminals = hook.match(/applyTerminal\(/g) ?? [];
    // settleDurableRestore (the queued-edit response) + handleRestoreDraftApplied.
    expect(terminals).toHaveLength(2);
    // Not a hand-rolled mark/consume pair — the ordering guarantees are the
    // consumer's, and that module is what the dry-run tests exercise.
    expect(hook).not.toMatch(/markApplied\(wsId, restoreRequest/);
  });

  it("keeps the consume path out of the hook's own reconcile logic", () => {
    expect(hook).toMatch(/consume\(activeSessionId, row\.id\)/);
    expect(hook).toContain("createRestoreConsumer(");
  });

  it("gives the store selectors a stable empty fallback", () => {
    // A selector returning a fresh `[]` / `{}` fails Zustand's `Object.is` check
    // on EVERY store notification, so the component re-renders forever. On
    // device that is a hard crash ("Maximum update depth exceeded" in ChatTab),
    // and it is invisible to the Node lane — hence a structural guard. The
    // fallback must be a module-level constant, never an inline literal.
    expect(hook).not.toMatch(/\?\? \[\]/);
    expect(hook).not.toMatch(/\?\? \{\}/);
    expect(hook).toMatch(/EMPTY_APPLIED_RESTORES/);
    expect(hook).toMatch(/EMPTY_RESTORE_QUEUE/);
  });
});

describe("api layer advertises the capability and exposes the durable endpoints", () => {
  const api = code(API);

  it("sends the capability header on cancel", () => {
    expect(api).toMatch(/"X-Client-Capabilities": CHAT_DRAFT_RESTORE_CAPABILITY/);
  });

  it("routes the capability token through the shared constant", () => {
    // One definition, so the two clients cannot drift from the string the
    // server compares.
    expect(api).toContain('from "@/lib/chat-draft-restore"');
  });

  it("parses the cancel body rather than discarding it", () => {
    expect(api).toMatch(/CancelTaskResponseSchema,/);
    expect(api).toMatch(/EMPTY_CANCEL_TASK_RESPONSE,/);
  });

  it("declares both durable endpoints", () => {
    expect(api).toContain("/draft-restores");
    expect(api).toMatch(/consumeChatDraftRestore/);
  });
});

describe("realtime wiring for the deferred outcome", () => {
  const realtime = code(SESSION_REALTIME);

  it("handles chat:cancel_finalized", () => {
    expect(realtime).toMatch(/ws\.on\("chat:cancel_finalized"/);
    expect(realtime).toMatch(/applyChatCancelFinalizedToCache\(/);
  });

  it("re-pulls the durable restores on reconnect", () => {
    // A cancel_finalized broadcast missed while disconnected is exactly what
    // the durable rows exist for.
    expect(realtime).toMatch(
      /invalidateQueries\(\{ queryKey: chatKeys\.draftRestores\(sessionId\) \}\)/,
    );
  });

  it("passes the current user id so the initiator gate can fail closed", () => {
    expect(realtime).toMatch(/useAuthStore\(\(s\) => s\.user\?\.id\)/);
    expect(realtime).toMatch(/userId,/);
  });
});

describe("client identity no longer lies about platform and version", () => {
  const api = code(API);
  const layout = code(LAYOUT);

  it("has no hard-coded ios / stale-version header left", () => {
    expect(api).not.toContain('"X-Client-OS": "ios"');
    expect(api).not.toContain('"X-Client-Version": "0.6.5"');
  });

  it("sources both headers from the shared identity helper", () => {
    expect(api).toMatch(/clientIdentityHeaders\(/);
    const uses = api.match(/clientIdentityHeaders\(/g) ?? [];
    // Both the JSON transport and the multipart upload path.
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it("resolves the real platform and version at app startup", () => {
    expect(layout).toMatch(/os: Platform\.OS/);
    expect(layout).toMatch(/version: resolveAppVersion\(Constants\)/);
  });
});
