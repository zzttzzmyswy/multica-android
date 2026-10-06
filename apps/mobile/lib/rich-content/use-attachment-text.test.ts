import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The hook module imports `@/data/api`, whose chain reaches `react-native` at
// module scope — and mobile's vitest lane is Node-only. Mocking the data layer
// is the same pattern the data-layer suites use; only the pure `textFailureKey`
// mapping below is under test here, and the hook's own behaviour is exercised on
// device.
vi.mock("@/data/api", () => ({
  api: { getAttachmentTextContent: vi.fn() },
  PreviewTooLargeError: class extends Error {},
  PreviewUnsupportedError: class extends Error {},
}));

const { textFailureKey } = await import("./use-attachment-text");

/**
 * Failure-reason → i18n key, shared by every text-backed attachment renderer.
 *
 * Worth pinning because the mapping is what keeps 413 and 415 from collapsing
 * into the generic "couldn't load" copy: those two are terminal, name their
 * cause, and must not be shown for a transport failure (which is retryable).
 * The keys are also resolved against both bundles, so a rename that misses a
 * locale fails here instead of rendering a raw key id in the failure card.
 */
describe("textFailureKey", () => {
  it("maps each reason to its own distinct key", () => {
    const tooLarge = textFailureKey("tooLarge");
    const unsupported = textFailureKey("unsupported");
    const failed = textFailureKey("failed");

    // One reason must never borrow another's sentence.
    expect(new Set([tooLarge, unsupported, failed]).size).toBe(3);
  });

  it("names the cause in the key, not a generic fallback", () => {
    expect(textFailureKey("tooLarge")).toContain("tooLarge");
    expect(textFailureKey("unsupported")).toContain("unsupported");
    expect(textFailureKey("failed")).toContain("loadFailed");
  });

  it("resolves in both locale bundles", () => {
    const en = JSON.parse(
      readFileSync(path.join(__dirname, "..", "i18n/locales/en.json"), "utf8"),
    ) as Record<string, string>;
    const zh = JSON.parse(
      readFileSync(path.join(__dirname, "..", "i18n/locales/zh.json"), "utf8"),
    ) as Record<string, string>;

    for (const reason of ["tooLarge", "unsupported", "failed"] as const) {
      const key = textFailureKey(reason);
      expect(en[key], `${key} missing from en.json`).toBeTruthy();
      expect(zh[key], `${key} missing from zh.json`).toBeTruthy();
    }
  });
});
