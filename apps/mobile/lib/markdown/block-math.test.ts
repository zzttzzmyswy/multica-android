import { describe, expect, it } from "vitest";
import { isStandaloneBlockMath, blockMathExpression } from "./block-math";

describe("isStandaloneBlockMath — paragraph token whose whole body is a $$ block", () => {
  it("accepts the canonical fenced form", () => {
    expect(isStandaloneBlockMath("$$\nE=mc^2\n$$")).toBe(true);
  });

  it("accepts the single-line form", () => {
    expect(isStandaloneBlockMath("$$E=mc^2$$")).toBe(true);
  });

  it("accepts a multi-line body and leading/trailing blank lines", () => {
    expect(isStandaloneBlockMath("$$\nx = 1\ny = 2\n$$")).toBe(true);
    expect(isStandaloneBlockMath("\n$$a+b$$\n")).toBe(true);
  });

  it("rejects prose that merely contains a $$ block or dollar amounts", () => {
    expect(isStandaloneBlockMath("文字与$$E=mc^2$$混排")).toBe(false);
    expect(isStandaloneBlockMath("金额 $100 与 $120 对比")).toBe(false);
    expect(isStandaloneBlockMath("只有开头 $$ 没有结束")).toBe(false);
  });

  it("extracts the raw expression", () => {
    expect(blockMathExpression("$$\nE=mc^2\n$$")).toBe("E=mc^2");
    expect(blockMathExpression("$$E=mc^2$$")).toBe("E=mc^2");
  });
});
