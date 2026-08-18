/**
 * Save-view visibility policy (MYS-437). The saved-view dialog's visibility
 * toggle (private ⇄ workspace) renders for every non-my scope — project
 * surfaces get it exactly like the workspace surface (web
 * save-view-dialog.tsx:718-726). These pure functions decide the submitted
 * value; the bar wires `scopeAllowsViewVisibility(scope.scope_type)` into
 * both the dialog's visibilityAllowed and the share/unshare affordance.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));

import {
  resolveSubmittedVisibility,
  scopeAllowsViewVisibility,
} from "./issue-views";

describe("scopeAllowsViewVisibility", () => {
  it("allows workspace and project scopes", () => {
    expect(scopeAllowsViewVisibility("workspace")).toBe(true);
    expect(scopeAllowsViewVisibility("project")).toBe(true);
  });

  it("never allows my scope", () => {
    expect(scopeAllowsViewVisibility("my")).toBe(false);
  });
});

describe("resolveSubmittedVisibility", () => {
  it("honors the chosen visibility when allowed", () => {
    expect(resolveSubmittedVisibility(true, "workspace")).toBe("workspace");
    expect(resolveSubmittedVisibility(true, "private")).toBe("private");
  });

  it("forces private when the surface cannot share (my scope)", () => {
    expect(resolveSubmittedVisibility(false, "workspace")).toBe("private");
  });
});