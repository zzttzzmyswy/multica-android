/**
 * Regression tests for how GFM tables route through the mobile markdown
 * splitter, plus the parser-level delimiter contract they depend on.
 *
 * These lock in the behavior behind two backlog bugs (59d5122e "tables
 * clipped, need horizontal scroll" and dd5ea713 "tables show raw instead
 * of rendering"):
 *
 *   1. A well-formed GFM table (header + delimiter + body rows) is kept as
 *      ONE narrative prose segment verbatim. `splitMarkdown` intentionally
 *      does NOT carve tables out of the prose stream — it hands them to
 *      `EnrichedMarkdownText`, the native md4c renderer, which draws each
 *      one as its own horizontally-scrollable `TableContainerView`. This is
 *      what makes every table (issue description, issue comment, chat
 *      bubble) scrollable on Android. If a future refactor splits tables
 *      into a non-prose segment or re-serialises them, these tests catch it.
 *
 *   2. GFM requires the delimiter row (`|---|---|`) before the data rows. A
 *      block of `| a | b |` lines with no delimiter is not a table in GFM —
 *      it is a paragraph, and it renders as literal `| ... |` text on BOTH
 *      web (remark-gfm) and mobile (md4c). The "show as raw markdown"
 *      reports (dd5ea713) trace back to message source content that omits
 *      the delimiter, not to a mobile renderer defect. Asserting that
 *      contract here documents the root cause so nobody tries to "fix" the
 *      client by ballooning delimiter-less pipes into tables (which would
 *      diverge from web and mis-render genuine prose that uses `|`).
 */
import { describe, expect, it } from "vitest";
import { splitMarkdown } from "./split-markdown";
import { preprocessMobileMarkdown } from "./preprocess";

// Runs the exact mobile pipeline: preprocess (HTML strip, mention/file-card
// rewrites) → marked.lexer → segment split.
function segments(input: string) {
  return splitMarkdown(preprocessMobileMarkdown(input));
}

describe("splitMarkdown — GFM tables route through prose to the native table renderer", () => {
  it("keeps a well-formed multi-column table as a single prose segment, verbatim", () => {
    const table =
      "| issue | 类型 | 内容 |\n|---|---|---|\n| MYS-274 | Bug | 输入框被键盘遮盖 |\n| MYS-277 | Bug | 表格显示不全需左右滑动 |";
    const out = segments(table);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("prose");
    // splitMarkdown trims leading/trailing whitespace of the prose buffer.
    const content = (out[0] as { content: string }).content;
    expect(content).toContain("|---|---|---|");
    expect(content).toContain("| MYS-274 | Bug | 输入框被键盘遮盖 |");
    expect(content).toContain("| MYS-277 | Bug | 表格显示不全需左右滑动 |");
  });

  it("keeps a table sandwiched between prose paragraphs without re-serialising it", () => {
    const md =
      "Multica 安卓项目当前 backlog 待办（8 个）：\n\n" +
      "| issue | 类型 | 内容 |\n|---|---|---|\n| MYS-280 | Bug | 表格未渲染显示原文 |\n\n" +
      "全部指派给 Multica 安卓开发 agent。";
    const out = segments(md);
    const prose = out.filter((s) => s.type === "prose");
    const joined = prose.map((s) => (s as { content: string }).content).join("\n");
    expect(joined).toContain("|---|---|---|");
    expect(joined).toContain("| MYS-280 | Bug | 表格未渲染显示原文 |");
    expect(joined).toContain("Multica 安卓项目当前 backlog 待办");
    expect(joined).toContain("全部指派给 Multica 安卓开发 agent");
  });

  it("does not confuse a table with a fenced code block or an image", () => {
    const md =
      "```\n| not | a | table | inside code\n```\n\n" +
      "| h1 | h2 |\n|---|---|\n| a | b |";
    const out = segments(md);
    // Code fence is its own `code` segment; the real table stays prose.
    expect(out.some((s) => s.type === "code")).toBe(true);
    const prose = out
      .filter((s) => s.type === "prose")
      .map((s) => (s as { content: string }).content)
      .join("\n");
    expect(prose).toContain("|---|---|");
  });
});

describe("GFM delimiter contract behind the raw-render reports (dd5ea713)", () => {
  it("requires a delimiter row for a pipe block to become a table", () => {
    // Header + delimiter → marked produces a `table` token → prose segment
    // that md4c renders as a table.
    const withDelim = segments("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(withDelim).toHaveLength(1);

    // Delimiter absent → not a table; the `| ... |` lines are paragraph text
    // and stay raw (same on web via remark-gfm).
    const withoutDelim = segments("| MYS-270 | 需求 | 聊天 issue 跑马灯滚动实现 |\n| MYS-276 | 需求 | 聊天/issue 跳转底部按钮 |");
    expect(withoutDelim).toHaveLength(1);
    const content = (withoutDelim[0] as { content: string }).content;
    expect(content).toContain("| MYS-270 | 需求 | 聊天 issue 跑马灯滚动实现 |");
    // It must NOT look like a table (no delimiter).
    expect(content).not.toContain("---");
  });

  it("a header row alone (no delimiter) is also not a table", () => {
    const md = "| 名称 | 类型 | 说明 |\n| 值1 | 值2 | 值3 |";
    const out = segments(md);
    expect(out).toHaveLength(1);
    const content = (out[0] as { content: string }).content;
    expect(content).toContain("| 名称 | 类型 | 说明 |");
    expect(content).not.toContain("---");
  });
});
describe("splitMarkdown — block math ($$) carves out of prose for KaTeX rendering", () => {
  it("carves a standalone $$ block paragraph into a math segment", () => {
    const out = segments("前文\n\n$$\nE=mc^2\n$$\n\n后文");
    expect(out.map((s) => s.type)).toEqual(["prose", "math", "prose"]);
    const math = out[1] as { type: "math"; code: string };
    expect(math.code).toBe("E=mc^2");
  });

  it("carves a single-line $$...$$ paragraph", () => {
    const out = segments("$$E=mc^2$$");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("math");
  });

  it("keeps mixed prose+math paragraphs as prose (md4c inline math handles them)", () => {
    const out = segments("文字 **加粗** 与 $$\nE=mc^2\n$$ 混排");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("prose");
  });

  it("keeps dollar amounts literal — money is not math", () => {
    const out = segments("金额 $100 与 $120 对比");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("prose");
  });

  it("upgrades a ```math fence to a math segment (KaTeX beyond web's fence map)", () => {
    // Web renders a ```math fence as plain highlighted source
    // (isRichFenceLanguage only knows mermaid/html), but web renders $$/\( math
    // through remark-math + rehype-katex. The mobile renderer has no KaTeX in
    // md4c prose, so the splitter promotes the fence to a dedicated math
    // segment rendered by MathBlock — superset of web's fence map, still
    // whole-token exact (```mathlib stays code).
    const out = segments("```math\n\\frac{a}{b}\n```");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("math");
    expect((out[0] as { code: string }).code).toBe("\\frac{a}{b}");
  });

  it("keeps a ```mathlib fence as a plain code segment (whole-token exact)", () => {
    const out = segments("```mathlib\n\\frac{a}{b}\n```");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("code");
    expect((out[0] as { code: string }).code).toBe("\\frac{a}{b}");
    expect((out[0] as { lang: string }).lang).toBe("mathlib");
  });
});
