import { describe, expect, it } from "vitest";
import {
  detectLinks,
  findCodeRanges,
  findMarkdownLinkRanges,
  isInsideCode,
  rangesOverlap,
  shouldAutoLink,
} from "./linkify";

/**
 * The detection primitives the identifier pass depends on. These are a mirror
 * of `packages/ui/markdown/linkify.ts`, and the identifier pass trusts them to
 * answer "is this span inside something that is not prose?" — so each skip the
 * identifier suite relies on is pinned HERE, at the primitive, as well as
 * end-to-end there.
 */
describe("findCodeRanges / isInsideCode", () => {
  it("covers fenced blocks, display math, inline math and inline code", () => {
    const cases: Array<[string, string]> = [
      ["```\ncode\n```", "fenced"],
      ["$$x = 1$$", "display math"],
      ["$x$", "inline math"],
      ["`code`", "inline code"],
    ];
    for (const [text, label] of cases) {
      // The payload inside each construct must fall in a code range — that is
      // the property the identifier pass relies on to leave it alone.
      const payload = text.indexOf("code") >= 0 ? "code" : "x";
      const at = text.indexOf(payload);
      expect(isInsideCode(at, findCodeRanges(text)), label).toBe(true);
    }
  });

  it("does not mark plain prose as code", () => {
    const text = "just some ordinary prose";
    expect(isInsideCode(3, findCodeRanges(text))).toBe(false);
  });

  it("does not mark a payload OUTSIDE the construct as code", () => {
    // Half-open ranges matter here: the char right after a closing backtick is
    // prose again, and an off-by-one would leave an identifier unlinked.
    const text = "`code` MYS-1";
    expect(isInsideCode(text.indexOf("MYS-1"), findCodeRanges(text))).toBe(false);
  });
});

describe("findMarkdownLinkRanges", () => {
  it("covers an inline link's label and destination", () => {
    const text = "see [label](https://example.com/a) here";
    const ranges = findMarkdownLinkRanges(text);
    const labelAt = text.indexOf("label");
    const hrefAt = text.indexOf("https");
    expect(ranges.some((r) => labelAt >= r.start && labelAt < r.end)).toBe(true);
    expect(ranges.some((r) => hrefAt >= r.start && hrefAt < r.end)).toBe(true);
  });

  it("covers an image", () => {
    const text = "![alt](https://example.com/a.png)";
    const ranges = findMarkdownLinkRanges(text);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0]!.start).toBe(0);
  });

  it("covers a reference link", () => {
    const text = "[label][ref]";
    expect(findMarkdownLinkRanges(text).length).toBeGreaterThan(0);
  });

  it("ignores an escaped bracket", () => {
    expect(findMarkdownLinkRanges("\\[not a link](x)")).toEqual([]);
  });
});

describe("detectLinks", () => {
  it("detects an http URL", () => {
    const links = detectLinks("see https://example.com/a/b now");
    expect(links.map((l) => l.type)).toContain("url");
  });

  it("detects an email", () => {
    const links = detectLinks("mail me@example.com please");
    expect(links.map((l) => l.type)).toContain("email");
  });

  it("detects an absolute file path", () => {
    const links = detectLinks("open /etc/hosts.conf now");
    expect(links.map((l) => l.type)).toContain("file");
  });

  it("ends a URL at CJK punctuation rather than swallowing the sentence", () => {
    // The mobile-specific boundary correction inherited from web: linkify-it
    // breaks on ASCII punctuation only, so without this a CJK full stop after a
    // URL drags the rest of the sentence into the link — and, for the
    // identifier pass, would hide a following identifier inside a URL.
    const links = detectLinks("见 https://example.com/a。之后 MYS-1");
    const url = links.find((l) => l.type === "url");
    expect(url?.text).toBe("https://example.com/a");
  });

  it("trims a trailing markdown delimiter run from a URL", () => {
    const links = detectLinks("**https://example.com/a**");
    const url = links.find((l) => l.type === "url");
    expect(url?.text).toBe("https://example.com/a");
  });

  it("does not treat a bare filename as a URL", () => {
    // `shouldAutoLink`'s policy: only http(s)/www/email auto-link, so a
    // scheme-less domain-shaped token stays prose. This is what keeps a
    // filenames-are-not-links distinction inside the identifier pass too.
    const links = detectLinks("read plan.md first");
    expect(links.filter((l) => l.type === "url")).toEqual([]);
  });

  it("returns nothing for prose with no links", () => {
    expect(detectLinks("plain prose only")).toEqual([]);
  });
});

describe("shouldAutoLink", () => {
  it("accepts http(s), www and email", () => {
    expect(shouldAutoLink("https://example.com")).toBe(true);
    expect(shouldAutoLink("http://example.com")).toBe(true);
    expect(shouldAutoLink("www.example.com")).toBe(true);
    expect(shouldAutoLink("a@b.com")).toBe(true);
  });

  it("rejects everything else, so a filename is never a website", () => {
    expect(shouldAutoLink("plan.md")).toBe(false);
    expect(shouldAutoLink("example.com")).toBe(false);
    expect(shouldAutoLink("javascript:alert(1)")).toBe(false);
  });
});

describe("rangesOverlap", () => {
  it("is half-open — touching ranges do not overlap", () => {
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 5, end: 9 })).toBe(false);
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 4, end: 9 })).toBe(true);
  });
});
