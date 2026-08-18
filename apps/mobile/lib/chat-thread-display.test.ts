/**
 * Pure display helpers for the IM-style chat session list (MYS-449).
 *
 * Mirrors the functions in `packages/views/chat/components/chat-thread-list.tsx`
 * so the mobile session sheet renders the same preview / time / badge shapes
 * as web. Pure functions only — no RN / network imports, testable in Node.
 */
import { describe, expect, it } from "vitest";
import { formatChatTime, toPreview, unreadBadgeText } from "./chat-thread-display";

describe("toPreview", () => {
  it("collapses fenced code blocks into a single space", () => {
    expect(toPreview("Summary:\n```ts\nconst x = 1\n```\nDone")).toBe(
      "Summary: Done",
    );
  });

  it("strips markdown heading / emphasis / inline-code / blockquote symbols", () => {
    expect(toPreview("## Heading and *bold* and `code` and > quote")).toBe(
      "Heading and bold and code and quote",
    );
  });

  it("folds newlines and runs of whitespace into single spaces", () => {
    expect(toPreview("line1\nline2    \n\n  line3")).toBe("line1 line2 line3");
  });

  it("returns an empty string for empty input", () => {
    expect(toPreview("")).toBe("");
    expect(toPreview("   ")).toBe("");
  });
});

describe("formatChatTime", () => {
  // `now` is injectable so the three branches are testable deterministically.
  const now = new Date("2026-08-19T12:00:00Z");

  it("same day → clock time (HH:mm)", () => {
    const out = formatChatTime("2026-08-19T08:30:00Z", now);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("same year, different day → M/D", () => {
    const out = formatChatTime("2026-07-03T08:30:00Z", now);
    expect(out).not.toMatch(/\d{1,2}:\d{2}/);
    expect(out).toMatch(/\d{1,2}\/\d{1,2}/);
  });

  it("previous year → full date", () => {
    const out = formatChatTime("2025-11-20T08:30:00Z", now);
    expect(out).not.toMatch(/\d{1,2}:\d{2}/);
    expect(out.length).toBeGreaterThan(6);
  });
});

describe("unreadBadgeText", () => {
  it("renders plain numbers up to 99", () => {
    expect(unreadBadgeText(1)).toBe("1");
    expect(unreadBadgeText(9)).toBe("9");
    expect(unreadBadgeText(99)).toBe("99");
  });

  it("caps at 99+ (web parity: badge overflow reads 99+ top)", () => {
    expect(unreadBadgeText(100)).toBe("99+");
    expect(unreadBadgeText(1000)).toBe("99+");
  });

  it("handles zero / non-invasive input types", () => {
    expect(unreadBadgeText(0)).toBe("0");
    expect(unreadBadgeText(undefined)).toBe("");
  });
});