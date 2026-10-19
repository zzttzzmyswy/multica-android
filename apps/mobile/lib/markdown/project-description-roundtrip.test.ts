import { describe, expect, it } from "vitest";
import { splitMarkdown } from "./split-markdown";

/**
 * The project description round-trip (iteration 260).
 *
 * The edit screen now writes a markdown body and the detail screen renders it
 * through the same pipeline issue descriptions use. The failure this guards is
 * silent and lossy: if the renderer mangles a construct the editor can produce
 * (or a web `ContentEditor` already stored), the user sees something different
 * from what they saved, and a later mobile save writes the mangled form back —
 * the original is gone with no error anywhere.
 *
 * These tests pin the *shape* of the pipeline for the constructs a project
 * description actually carries: headings, bullets, checkboxes, quotes, fenced
 * code, links and emphasis. They assert the source text survives into the
 * segmented representation, which is what the renderer draws.
 */
/** Reassemble the full text of a body from its segments.
 *
 *  `splitMarkdown` returns a discriminated union, and only `prose` carries a
 *  `content` field — a fenced block arrives as `{type:"code", code}` (and an
 *  image as `{type:"image", uri}`). A helper that read `content` alone would
 *  silently drop every code block, which is exactly the kind of blindness
 *  these tests exist to prevent. */
function joined(markdown: string): string {
  return splitMarkdown(markdown)
    .map((segment) => {
      switch (segment.type) {
        case "prose":
          return segment.content;
        case "code":
          return segment.code;
        case "math":
          return segment.code;
        case "image":
          return segment.uri;
      }
    })
    .join("\n");
}

describe("project description markdown round-trip", () => {
  it("keeps markdown headings as markdown, not stripped text", () => {
    const source = "## Goals\n\nShip the thing.";
    expect(joined(source)).toContain("## Goals");
  });

  it("keeps bullet and checkbox markers", () => {
    const source = "- one\n- two\n\n- [ ] todo\n- [x] done";
    const kept = joined(source);
    expect(kept).toContain("- one");
    expect(kept).toContain("- [ ] todo");
    expect(kept).toContain("- [x] done");
  });

  it("keeps blockquote markers", () => {
    expect(joined("> quoted context")).toContain("> quoted context");
  });

  it("keeps a fenced code block as its own code segment with its language", () => {
    // The fence markers are consumed by the lexer by design — the renderer
    // draws a code block from `{lang, code}`, not by re-parsing the fence.
    // What must NOT happen is the block being swallowed into prose.
    const source = "```ts\nconst a = 1;\n```";
    const segments = splitMarkdown(source);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: "code", lang: "ts", code: "const a = 1;" });
  });

  it("keeps link syntax so the renderer can draw a link", () => {
    const source = "[the spec](https://example.com/spec)";
    expect(joined(source)).toContain("https://example.com/spec");
  });

  it("keeps emphasis markers", () => {
    const source = "This is **important** and _subtle_.";
    const kept = joined(source);
    expect(kept).toContain("**important**");
    expect(kept).toContain("_subtle_");
  });

  it("preserves a description that is already plain text", () => {
    // The overwhelmingly common case: someone typed prose with no markdown.
    // Turning it into segments must not invent or drop characters.
    const source = "A plain sentence with no markup at all.";
    expect(joined(source)).toBe(source);
  });

  it("splits a long mixed body without losing any of it", () => {
    const source = [
      "## Overview",
      "",
      "Some **bold** prose and a [link](https://example.com).",
      "",
      "- first",
      "- second",
      "",
      "```sh",
      "npm run build",
      "```",
      "",
      "> a closing note",
    ].join("\n");
    const kept = joined(source);
    for (const needle of [
      "## Overview",
      "**bold**",
      "https://example.com",
      "- first",
      "npm run build",
      "> a closing note",
    ]) {
      expect(kept).toContain(needle);
    }
  });
});
