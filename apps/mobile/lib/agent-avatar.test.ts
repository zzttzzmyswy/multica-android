import { describe, expect, it } from "vitest";
import {
  AVATAR_EMOJI_SUGGESTIONS,
  formatAvatarEmoji,
  parseAvatarEmoji,
} from "./agent-avatar";

describe("parseAvatarEmoji", () => {
  it("returns the emoji for an emoji: avatar_url", () => {
    expect(parseAvatarEmoji("emoji:🚀")).toBe("🚀");
  });

  it("returns null for urls / falsy input", () => {
    expect(parseAvatarEmoji(null)).toBeNull();
    expect(parseAvatarEmoji("")).toBeNull();
    expect(parseAvatarEmoji("https://example.com/a.png")).toBeNull();
    expect(parseAvatarEmoji("plain")).toBeNull();
  });
});

describe("formatAvatarEmoji", () => {
  it("round-trips through parseAvatarEmoji with the emoji: prefix", () => {
    const value = formatAvatarEmoji("🦊");
    expect(value).toBe("emoji:🦊");
    expect(parseAvatarEmoji(value)).toBe("🦊");
  });
});

describe("AVATAR_EMOJI_SUGGESTIONS", () => {
  it("is non-empty and matches web's 24-face set", () => {
    expect(AVATAR_EMOJI_SUGGESTIONS).toContain("🤖");
    expect(AVATAR_EMOJI_SUGGESTIONS).toHaveLength(24);
  });
});