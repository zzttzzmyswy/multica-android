/**
 * Wiring ratchet for the two-layer instruction surface (MYS-2162).
 *
 * `lib/agent-system-prompt.test.ts` proves the two decisions answer correctly;
 * nothing reaches a user unless the FORM and the DETAIL screen consume them.
 * The helper could exist while the form kept rendering 「指令」 over the
 * workspace-notes draft — which is exactly the state this iteration starts
 * from — so this suite asserts the consumption, against source, the way
 * `agent-detail-access-wiring.test.ts` does for the 403 probe.
 *
 * Mobile's vitest lane is Node-only (no RN renderer), so this is asserted
 * against source rather than rendered markup. Comments are stripped first, so a
 * comment describing the wiring cannot satisfy it.
 *
 * The load-bearing assertions:
 *   - the form derives BOTH the card and the copy from the helper, and renders
 *     the plain branch unchanged when there is no system layer;
 *   - the card is fed `systemPromptLayer(agent)`, never `draft.instructions` —
 *     the read-only half must not be wired to the editable state;
 *   - the system half is never written into the draft or the update request;
 *   - the DETAIL screen renders the block only under `hasSystemLayer`, so an
 *     ordinary agent's screen is untouched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FORM = "components/agent/manual-agent-form.tsx";
const DETAIL = "app/(app)/[workspace]/more/agents/[id].tsx";
const CARD = "components/agent/agent-system-layer-card.tsx";

describe("the edit form names both halves of a system agent's prompt", () => {
  const src = code(FORM);

  it("derives the layer and the copy from the shared helpers", () => {
    expect(src).toContain("hasSystemPromptLayer(agent)");
    expect(src).toContain("systemPromptLayer(agent)");
    expect(src).toContain("agentInstructionsCopy(hasSystemLayer)");
  });

  it("gates the system layer on EDIT mode, not on create or duplicate", () => {
    // Create cannot mint a system agent (the endpoint accepts neither `kind`
    // nor `system_key`), and a duplicate is an ordinary agent, so neither has a
    // product half to show. `isEdit &&` is what keeps them identical to today.
    expect(src).toContain("isEdit && hasSystemPromptLayer(agent)");
  });

  it("renders the read-only card only when there is a system layer", () => {
    const gateAt = src.indexOf("{hasSystemLayer ? (");
    const cardAt = src.indexOf("<AgentSystemLayerCard");
    expect(gateAt, "system-layer card is not gated").toBeGreaterThan(-1);
    expect(cardAt, "system-layer card is not rendered").toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(cardAt);
  });

  it("feeds the card the product half, never the editable draft", () => {
    expect(src).toContain("<AgentSystemLayerCard instructions={systemLayer} />");
    // `draft.instructions` in the card's prop would make the read-only half
    // follow the textarea — the exact confusion this iteration removes.
    expect(src).not.toContain("<AgentSystemLayerCard instructions={draft.instructions}");
  });

  it("switches the field label and placeholder with the layer", () => {
    // Not the literal keys: the switch itself is the behaviour, and the keys
    // are pinned in the helper's own suite. A literal here would keep passing
    // if the form hardcoded the workspace-notes wording for every agent.
    expect(src).toContain("t(instructionsCopy.labelKey)");
    expect(src).toContain("t(instructionsCopy.placeholderKey)");
    expect(src).not.toContain('t("agents.new.instructionsLabel")');
    expect(src).not.toContain('t("agents.new.instructionsPlaceholder")');
  });

  it("states the layering above the editable field, on the layered branch only", () => {
    // The rename says WHAT the field holds; only the intro says how it relates
    // to the half above it (never overwritten, applies on top).
    expect(src).toContain("instructionsCopy.introKey");
    const introAt = src.indexOf("t(instructionsCopy.introKey)");
    const textareaAt = src.indexOf("value={draft.instructions}");
    expect(introAt).toBeGreaterThan(-1);
    expect(textareaAt).toBeGreaterThan(-1);
    expect(introAt).toBeLessThan(textareaAt);
  });

  it("sends only the workspace notes on save", () => {
    // `buildUpdateAgentRequest({ draft, … })` — the request is assembled from
    // the draft, and the draft only ever held `instructions`. Asserted so a
    // later "just send it back too" edit has to argue with this line.
    expect(src).toContain("buildUpdateAgentRequest({");
    expect(src).toContain("draft,");
    expect(src).not.toContain("system_instructions:");
    expect(src).not.toContain("systemInstructions:");
  });
});

describe("the read-only card is read-only", () => {
  const src = code(CARD);

  it("renders the prompt as text, not as an input", () => {
    expect(src).toContain("<Text");
    expect(src).not.toContain("TextInput");
    expect(src).not.toContain("AutosizeTextArea");
    expect(src).not.toContain("editable=");
  });

  it("exposes no prop a caller could wire back into a draft", () => {
    // The whole safety argument is structural: there is no `onChange` to pass.
    expect(src).toContain("{ instructions }: { instructions: string }");
    expect(src).not.toContain("onChange");
    expect(src).not.toContain("onChangeText");
  });

  it("caps the body height so the editable field below stays reachable", () => {
    // The product prompt is ~3.5 KB — longer than the screen. An uncapped
    // block would bury the textarea the author opened the screen for.
    expect(src).toContain("max-h-[260px]");
  });

  it("labels the expanded body with the product's own words", () => {
    expect(src).toContain('t("agents.systemLayer.label")');
    expect(src).toContain('t("agents.systemLayer.hint")');
  });
});

describe("the detail screen reviews both halves, without changing ordinary agents", () => {
  const src = code(DETAIL);

  it("derives the layer from the same helpers", () => {
    expect(src).toContain("hasSystemPromptLayer(agent)");
    expect(src).toContain("systemPromptLayer(agent)");
  });

  it("renders the instructions block only under the system-layer gate", () => {
    const gateAt = src.indexOf("{hasSystemLayer ? (");
    const titleAt = src.indexOf('t("agents.detail.instructions")');
    const cardAt = src.indexOf("<AgentSystemLayerCard");
    expect(gateAt, "detail instructions block is not gated").toBeGreaterThan(-1);
    expect(titleAt, "detail has no instructions heading").toBeGreaterThan(-1);
    expect(cardAt, "detail has no read-only product card").toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(titleAt);
    expect(gateAt).toBeLessThan(cardAt);
  });

  it("shows the workspace notes beside the product half, not instead of it", () => {
    // Showing only the product half would repeat the defect in reverse: the
    // reader would take it for the whole prompt.
    expect(src).toContain('t("agents.instructions.workspaceLabel")');
    expect(src).toContain("agent.instructions");
  });

  it("offers no edit affordance for the product half", () => {
    expect(src).not.toContain("system_instructions:");
    expect(src).not.toContain("systemInstructions:");
  });
});
