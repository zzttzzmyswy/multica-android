/**
 * Wiring guard for the conversation-starters chain (MUL-6629).
 *
 * The rules themselves are covered in
 * `packages/core/agents/conversation-starters.test.ts`, and the mobile
 * bindings in `lib/conversation-starters-mobile.test.ts`. Neither can see the
 * defect this iteration actually fixes, because both are about functions being
 * CORRECT — the bug was that nothing called them.
 *
 * Before this iteration the chat empty state rendered a module-level
 * `STARTER_PROMPTS` array of three hard-coded i18n keys. It was self-contained,
 * type-checked, tested-green and wrong: on any agent whose author had
 * configured starters, the phone showed three buttons nobody wrote. A helper
 * test cannot catch that, because the helper was fine — it simply had no
 * caller. These assertions match on the SURFACES instead.
 *
 * Comments are stripped before matching, so a comment that quotes the banned
 * construct cannot satisfy or trip an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FOCUS_CONVERSATION_STARTERS } from "./conversation-starters-mobile";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const EMPTY_STATE = "components/chat/chat-empty-state.tsx";
const MESSAGE_LIST = "components/chat/chat-message-list.tsx";
const CHAT_TAB = "app/(app)/[workspace]/(tabs)/chat.tsx";
const FORM = "components/agent/manual-agent-form.tsx";
const EDITOR = "components/agent/conversation-starters-editor.tsx";
const EDIT_PAGE = "app/(app)/[workspace]/more/agents/[id]/edit.tsx";
const SCHEMAS = "data/schemas.ts";

describe("the reader side reads the agent's own starters", () => {
  it("resolves them through selectConversationStarters", () => {
    const source = code(EMPTY_STATE);
    expect(source).toContain("selectConversationStarters(");
    expect(source).toContain("agent?.conversation_starters");
  });

  it("no longer carries a hard-coded prompt list", () => {
    // The specific regression: a module-level literal that made every agent
    // look identically configured. `chat.prompt1..3` were its i18n keys.
    const source = code(EMPTY_STATE);
    expect(source).not.toMatch(/chat\.prompt[123]/);
    expect(source).not.toMatch(/STARTER_PROMPTS/);
  });

  it("takes the agent as a prop, and the list passes it through", () => {
    expect(code(EMPTY_STATE)).toMatch(/agent\??:\s*Agent\s*\|\s*null/);
    expect(code(MESSAGE_LIST)).toContain("agent={agent}");
  });
});

describe("the author side exists and is reachable", () => {
  it("mounts the editor from the agent form", () => {
    expect(code(FORM)).toContain("<ConversationStartersEditor");
  });

  it("renders it only when the deployment persists starters", () => {
    // A server without the capability drops the field, so an editor there
    // would be a form whose save silently does nothing.
    expect(code(FORM)).toMatch(/conversationStartersSupported\s*\?/);
    expect(code(FORM)).toContain("agent_conversation_starters_supported");
  });

  it("blocks save on a half-filled row instead of dropping it", () => {
    const source = code(FORM);
    expect(source).toContain("conversationStartersWithinLimits(");
    expect(source).toMatch(/startersReady/);
  });

  it("tells the API whether this deployment accepts the field", () => {
    expect(code(FORM)).toMatch(/includeConversationStarters\s*:/);
  });

  it("previews through the same resolver, fallback AND row component", () => {
    // The preview must not be a hand-maintained mock: web's editor renders the
    // reader's own component for exactly this reason.
    const source = code(FORM);
    expect(source).toContain("selectConversationStarters(");
    expect(source).toContain("fallbackConversationStarters(");
    expect(code(EDITOR)).toContain("previewIsFallback");
  });

  it("renders both surfaces' rows through ONE component", () => {
    // A preview that re-implements the reader's rows drifts from what it
    // previews the first time either side gains a style, and the author then
    // configures against a picture that is not true.
    expect(code(EDITOR)).toContain("<ConversationStarterList");
    expect(code(EMPTY_STATE)).toContain("<ConversationStarterList");
    // The editor's preview is inert (no onPick → presentation only).
    const editorPreview = code(EDITOR).slice(
      code(EDITOR).indexOf("previewLabel"),
    );
    expect(editorPreview).toContain("<ConversationStarterList starters={preview} />");
  });
});

describe("the chat empty state offers the way in only when it can be honoured", () => {
  it("gates the affordance on the shared three-part rule", () => {
    const source = code(CHAT_TAB);
    expect(source).toContain("canCustomizeConversationStarters(");
    expect(source).toContain("canEditAgentOnMobile(");
    expect(source).toContain("agent_conversation_starters_supported");
  });

  it("passes null rather than a dead handler when the viewer may not customize", () => {
    expect(code(CHAT_TAB)).toMatch(
      /onCustomizeStarters=\{\s*canCustomizeStarters\s*\?/,
    );
  });

  it("sends the reader to the block, not to the top of the form", () => {
    // The deep link is only worth offering if it lands on the setting; the
    // form is long enough that the top of it is a different screen. Both
    // sides name the SAME constant, so a parity test on the shared value is
    // what makes a one-sided rename fail rather than silently produce a link
    // that opens the right page at the wrong place.
    expect(code(CHAT_TAB)).toContain("focus: FOCUS_CONVERSATION_STARTERS");
    expect(code(CHAT_TAB)).toMatch(
      /import\s*\{[\s\S]*?FOCUS_CONVERSATION_STARTERS[\s\S]*?\}\s*from\s*"@\/lib\/conversation-starters-mobile"/,
    );
    expect(code(EDIT_PAGE)).toContain(
      "focus === FOCUS_CONVERSATION_STARTERS",
    );
    expect(code(EDIT_PAGE)).toMatch(
      /import\s*\{\s*FOCUS_CONVERSATION_STARTERS\s*\}\s*from\s*"@\/lib\/conversation-starters-mobile"/,
    );
    expect(code(EDIT_PAGE)).toContain("scrollTo(");
    expect(code(FORM)).toContain("onFocusStartersLayout");
  });

  it("keeps the focus sentinel a single shared literal", () => {
    // The value the route carries. Pinned here so both surfaces cannot drift
    // apart by one editing a string the other does not read.
    expect(FOCUS_CONVERSATION_STARTERS).toBe("conversation_starters");
  });
});

describe("the wire actually carries the field", () => {
  it("parses conversation_starters off an agent payload", () => {
    // Without this the server's array was silently discarded by zod and every
    // agent looked unconfigured no matter what its author had saved.
    expect(code(SCHEMAS)).toMatch(
      /conversation_starters:\s*z\s*\.array\(AgentConversationStarterSchema\)/,
    );
  });

  it("declares the deployment capability, failing closed", () => {
    const source = code(SCHEMAS);
    expect(source).toContain("agent_conversation_starters_supported");
    expect(source).toMatch(
      /agent_conversation_starters_supported:\s*\n?\s*BooleanWithDefaultSchema\(false\)/,
    );
  });
});
