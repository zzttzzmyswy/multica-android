import { describe, expect, it } from "vitest";
import { matchesNameOrPinyin } from "./name-search";

/**
 * The shared picker search predicate. Every expectation below is behaviour
 * web's pickers already have (`name.toLowerCase().includes(q) || matchesPinyin(name, q)`
 * — packages/views/issues/components/pickers/assignee-picker.tsx:132), and
 * that mobile's pickers did not, so this file doubles as the parity spec.
 */
describe("matchesNameOrPinyin", () => {
  describe("latin names", () => {
    it("matches a case-insensitive substring", () => {
      expect(matchesNameOrPinyin("Alice Chen", "alice")).toBe(true);
      expect(matchesNameOrPinyin("Alice Chen", "CHEN")).toBe(true);
      expect(matchesNameOrPinyin("Alice Chen", "ice ch")).toBe(true);
    });

    it("does not match an unrelated query", () => {
      expect(matchesNameOrPinyin("Alice Chen", "bob")).toBe(false);
    });

    it("does not pull a latin name in through the pinyin arm", () => {
      // `matchesPinyin` returns false for a name with no Han characters, so
      // "ali" must match "Alice" by substring only — never as an initialism.
      expect(matchesNameOrPinyin("Alice", "ali")).toBe(true);
      expect(matchesNameOrPinyin("Alice", "alc")).toBe(false);
    });
  });

  describe("chinese names", () => {
    it("matches full pinyin", () => {
      expect(matchesNameOrPinyin("李云龙", "liyunlong")).toBe(true);
    });

    it("matches pinyin initials", () => {
      expect(matchesNameOrPinyin("李云龙", "lyl")).toBe(true);
    });

    it("matches a pinyin prefix and hybrid input", () => {
      expect(matchesNameOrPinyin("李云龙", "liyu")).toBe(true);
      expect(matchesNameOrPinyin("李云龙", "liyunl")).toBe(true);
    });

    it("matches the characters themselves", () => {
      expect(matchesNameOrPinyin("李云龙", "云龙")).toBe(true);
    });

    it("does not match an unrelated query", () => {
      expect(matchesNameOrPinyin("李云龙", "zhangsan")).toBe(false);
    });
  });

  describe("empty query", () => {
    it("matches everything, including an empty name", () => {
      expect(matchesNameOrPinyin("Alice", "")).toBe(true);
      expect(matchesNameOrPinyin("李云龙", "")).toBe(true);
      expect(matchesNameOrPinyin("", "")).toBe(true);
    });

    it("treats a whitespace-only query as empty", () => {
      expect(matchesNameOrPinyin("Alice", "   ")).toBe(true);
    });
  });

  it("trims the query before matching", () => {
    expect(matchesNameOrPinyin("Alice Chen", "  alice  ")).toBe(true);
    expect(matchesNameOrPinyin("李云龙", " lyl ")).toBe(true);
  });
});
