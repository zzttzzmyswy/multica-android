/**
 * Block-math paragraph detection for the mobile markdown pipeline.
 *
 * Web upgrades `$$...$$` to KaTeX (remark-math with
 * `singleDollarTextMath: false` — a lone `$` is NEVER math on web, and
 * mobile's md4c `latexMath` flag mirrors that by keeping single-dollar
 * spans as KaTeX-rendered inline spans only where md4c already tokenises
 * them). Block math, though, arrives at the splitter as a PARAGRAPH token
 * whose whole body is one `$$` fence — enriched's native md4c span parser
 * does not promote it to the AndroidMath block renderer. The splitter
 * needs to recognise that shape and hand the expression to a dedicated
 * segment so the renderer can draw it as a block equation.
 */
const BLOCK_MATH_RE = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$$/;

export function isStandaloneBlockMath(paragraphRaw: string): boolean {
  return BLOCK_MATH_RE.test(paragraphRaw.trim());
}

export function blockMathExpression(paragraphRaw: string): string {
  const match = paragraphRaw.trim().match(BLOCK_MATH_RE);
  return match?.[1]?.trim() ?? "";
}
