import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canEditAgentOnMobile,
  fallbackConversationStarters,
} from "./conversation-starters-mobile";

/** A translator that returns the key, so assertions name the key they mean. */
const t = (key: string) => key;

describe("fallbackConversationStarters", () => {
  it("resolves the three defaults from the bundle, label and prompt each", () => {
    const starters = fallbackConversationStarters(t);

    expect(starters).toEqual([
      {
        label: "chat.starters.capabilities.label",
        prompt: "chat.starters.capabilities.prompt",
      },
      {
        label: "chat.starters.firstTask.label",
        prompt: "chat.starters.firstTask.prompt",
      },
      {
        label: "chat.starters.recommend.label",
        prompt: "chat.starters.recommend.prompt",
      },
    ]);
  });

  it("never returns a row whose prompt is empty", () => {
    // The empty state renders `prompt` into the composer on tap. A row whose
    // prompt resolved to "" would fill the composer with nothing and look like
    // a broken button, so this is the contract worth pinning.
    for (const starter of fallbackConversationStarters(t)) {
      expect(starter.label).not.toBe("");
      expect(starter.prompt).not.toBe("");
    }
  });

  it("returns a fresh list each call so a caller cannot mutate the bundle", () => {
    const first = fallbackConversationStarters(t);
    first[0].label = "mutated";
    expect(fallbackConversationStarters(t)[0].label).toBe(
      "chat.starters.capabilities.label",
    );
  });
});

describe("canEditAgentOnMobile", () => {
  const agent = { owner_id: "user-1" };

  it("allows the agent's own owner", () => {
    expect(
      canEditAgentOnMobile({
        agent,
        currentUserId: "user-1",
        currentRole: "member",
      }),
    ).toBe(true);
  });

  it("allows a workspace owner or admin who does not own the agent", () => {
    for (const role of ["owner", "admin"]) {
      expect(
        canEditAgentOnMobile({
          agent,
          currentUserId: "user-2",
          currentRole: role,
        }),
      ).toBe(true);
    }
  });

  it("denies a plain member editing somebody else's agent", () => {
    expect(
      canEditAgentOnMobile({
        agent,
        currentUserId: "user-2",
        currentRole: "member",
      }),
    ).toBe(false);
  });

  it("fails closed for an unresolved viewer or agent", () => {
    // A null role is what the member list looks like while it loads. Reading
    // that as "allowed" would flash an editor at someone who cannot save.
    expect(
      canEditAgentOnMobile({
        agent,
        currentUserId: "user-1",
        currentRole: null,
      }),
    ).toBe(true); // owner still wins — role is only the second test
    expect(
      canEditAgentOnMobile({
        agent: null,
        currentUserId: "user-1",
        currentRole: "owner",
      }),
    ).toBe(false);
    expect(
      canEditAgentOnMobile({
        agent,
        currentUserId: null,
        currentRole: "owner",
      }),
    ).toBe(false);
    expect(
      canEditAgentOnMobile({ agent, currentUserId: undefined, currentRole: "owner" }),
    ).toBe(false);
  });

  it("does not treat an ownerless agent as owned by everyone", () => {
    // `owner_id: null` is a real server state (the owner was removed). A
    // member must not inherit write access from it.
    expect(
      canEditAgentOnMobile({
        agent: { owner_id: null },
        currentUserId: "user-2",
        currentRole: "member",
      }),
    ).toBe(false);
    expect(
      canEditAgentOnMobile({
        agent: { owner_id: null },
        currentUserId: null,
        currentRole: "member",
      }),
    ).toBe(false);
  });
});

describe("the fallback copy is web's, sentence for sentence", () => {
  // The three defaults are the product's own suggestion copy, not mobile
  // invention: web renders the same three from its `chat.conversation_starters.*`
  // keys. A phone that paraphrased them would be describing a different feature,
  // and the drift would be invisible — both sides still show "three
  // suggestions".
  //
  // Pinned as literals rather than read from `packages/views/locales/en/chat.json`
  // because this checkout's `packages/views` is pinned to an upstream revision
  // that PREDATES those keys (they exist on the upstream default branch, whose
  // file is not in this tree). The literals below were read from
  // `origin/main:packages/views/locales/en/chat.json` when this iteration was
  // written, so the assertion is against the real strings; an upstream wording
  // change needs a deliberate edit here rather than silently forking.
  const WEB = {
    capabilities: {
      label: "What can you help with?",
      prompt: "What are you best at helping with? Give me a concise overview.",
    },
    first_task: {
      label: "Suggest a first issue",
      prompt: "Suggest three useful issues I could assign to you.",
    },
    recommend: {
      label: "Recommend an action",
      prompt:
        "Review what you know about my workspace and recommend a useful first action.",
    },
  } as const;

  const en = JSON.parse(
    readFileSync(path.resolve(__dirname, "i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.resolve(__dirname, "i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  it.each([
    ["capabilities", "capabilities"],
    ["firstTask", "first_task"],
    ["recommend", "recommend"],
  ])("matches web's %s wording", (mobileKey, webKey) => {
    const web = WEB[webKey as keyof typeof WEB];
    expect(en[`chat.starters.${mobileKey}.label`]).toBe(web.label);
    expect(en[`chat.starters.${mobileKey}.prompt`]).toBe(web.prompt);
  });

  it("resolves each key to a non-empty string in zh too", () => {
    for (const key of [
      "chat.starters.capabilities.label",
      "chat.starters.capabilities.prompt",
      "chat.starters.firstTask.label",
      "chat.starters.firstTask.prompt",
      "chat.starters.recommend.label",
      "chat.starters.recommend.prompt",
      "chat.customizeStarters",
    ]) {
      expect(zh[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("resolves the customize label, which the affordance renders as its a11y name", () => {
    expect(en["chat.customizeStarters"]).toBe("Customize starters");
  });
});
