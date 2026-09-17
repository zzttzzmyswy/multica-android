/**
 * Pure helpers for the chat composer's project-context row (web parity with
 * `packages/views/chat/components/chat-input.tsx` ~590-660).
 *
 * Web renders a clearable pill above the editor whenever the session carries a
 * `project_id`, plus a "project context unsupported" warning when the bound
 * daemon is older than the chat-project-context floor. These helpers own the
 * three branch decisions so the RN row stays a dumb renderer:
 *   - resolveChatProjectContext: bound? + resolved display name
 *   - chatProjectContextSupport / chatProjectContextUnsupported: soft version gate
 *   - chatProjectPillAccessibilityLabel: screen-reader label composition
 *
 * Pure only — no RN / network imports, so the suite runs in Node.
 */
import { describe, expect, it } from "vitest";
import {
  chatProjectContextSupport,
  chatProjectContextUnsupported,
  chatProjectPillAccessibilityLabel,
  resolveChatProjectContext,
  resolveChatProjectName,
} from "./chat-project-context";

const PROJECTS = [
  { id: "p-1", title: "Apollo" },
  { id: "p-2", title: "  Padded name  " },
  { id: "p-3", title: "   " },
];

// Stand-in for the i18n `t()` — echoes the key so assertions can see which
// catalog entry the label pulled without depending on locale JSON.
const t = (id: string) => `t:${id}`;

describe("resolveChatProjectContext", () => {
  it("reports unbound when the session has no project", () => {
    expect(resolveChatProjectContext(null, PROJECTS)).toEqual({
      bound: false,
      projectName: null,
    });
    expect(resolveChatProjectContext(undefined, PROJECTS).bound).toBe(false);
    expect(resolveChatProjectContext("", PROJECTS).bound).toBe(false);
  });

  it("resolves the project name when bound", () => {
    expect(resolveChatProjectContext("p-1", PROJECTS)).toEqual({
      bound: true,
      projectName: "Apollo",
    });
  });

  it("reports bound with no name when the project is not in the list", () => {
    // Deleted project / list not loaded yet: the pill must still carry a
    // clear affordance, so `bound` keys off the id alone, not the lookup.
    expect(resolveChatProjectContext("p-missing", PROJECTS)).toEqual({
      bound: true,
      projectName: null,
    });
  });
});

describe("resolveChatProjectName", () => {
  it("resolves a known id to its trimmed title", () => {
    expect(resolveChatProjectName(PROJECTS, "p-2")).toBe("Padded name");
  });

  it("returns null for a blank title so the caller can fall back", () => {
    expect(resolveChatProjectName(PROJECTS, "p-3")).toBeNull();
  });

  it("returns null for an unknown id or unset project", () => {
    expect(resolveChatProjectName(PROJECTS, "nope")).toBeNull();
    expect(resolveChatProjectName(PROJECTS, null)).toBeNull();
    expect(resolveChatProjectName(PROJECTS, undefined)).toBeNull();
  });
});

describe("chatProjectContextSupport", () => {
  it("cannot tell (null) when no runtime is bound — no warning", () => {
    expect(chatProjectContextSupport(null)).toBeNull();
    expect(chatProjectContextSupport(undefined)).toBeNull();
  });

  it("is true at / above the floor version", () => {
    expect(
      chatProjectContextSupport({ metadata: { cli_version: "0.4.10" } }),
    ).toBe(true);
    expect(
      chatProjectContextSupport({ metadata: { cli_version: "v0.5.0" } }),
    ).toBe(true);
  });

  it("is false below the floor version", () => {
    expect(
      chatProjectContextSupport({ metadata: { cli_version: "0.4.9" } }),
    ).toBe(false);
  });

  it("is false when the metadata carries no parsable version (fail closed)", () => {
    expect(chatProjectContextSupport({ metadata: {} })).toBe(false);
    expect(chatProjectContextSupport({ metadata: undefined })).toBe(false);
  });
});

describe("chatProjectContextUnsupported", () => {
  it("warns only when we can positively tell the runtime is too old", () => {
    expect(
      chatProjectContextUnsupported({ metadata: { cli_version: "0.4.9" } }),
    ).toBe(true);
  });

  it("stays quiet when supported or unknown (soft gate)", () => {
    expect(
      chatProjectContextUnsupported({ metadata: { cli_version: "0.4.10" } }),
    ).toBe(false);
    expect(chatProjectContextUnsupported(null)).toBe(false);
    expect(chatProjectContextUnsupported(undefined)).toBe(false);
  });
});

describe("chatProjectPillAccessibilityLabel", () => {
  it("names the action and the project when resolvable", () => {
    expect(chatProjectPillAccessibilityLabel("Apollo", t)).toBe(
      "t:chat.project.change: Apollo",
    );
  });

  it("falls back to the bare action when the name is unknown", () => {
    expect(chatProjectPillAccessibilityLabel(null, t)).toBe(
      "t:chat.project.change",
    );
  });
});
