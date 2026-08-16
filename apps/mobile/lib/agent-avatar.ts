/**
 * Emoji avatar helpers + suggestion set for the agent-create avatar picker.
 * Mirrors web verbatim: `packages/ui/lib/avatar-emoji.ts` (format/parse) and
 * `AVATAR_EMOJI_SUGGESTIONS`, kept in sync with the server's own set
 * (`agentEmojiAvatars` in server/internal/handler/agent_avatar.go) so the
 * suggestions read as the product's family of faces. Mobile copies rather
 * than imports (apps/mobile/CLAUDE.md "What mobile may import").
 */

const AVATAR_EMOJI_PREFIX = "emoji:";

/** The same one-click set web offers. */
export const AVATAR_EMOJI_SUGGESTIONS = [
  "🐙", "🦊", "🦉", "🐝", "🐼", "🐸", "🐯", "🦁",
  "🐨", "🐵", "🐧", "🐳", "🦋", "🌞", "🌙", "⭐",
  "🔥", "⚡", "🍀", "🌈", "🚀", "🤖", "👾", "🧠",
];

export function parseAvatarEmoji(value?: string | null): string | null {
  if (!value?.startsWith(AVATAR_EMOJI_PREFIX)) return null;
  const emoji = value.slice(AVATAR_EMOJI_PREFIX.length).trim();
  return emoji || null;
}

/** Builds the `avatar_url` value for an emoji avatar — same shape web
 *  persists, same `emoji:` prefix the server recognises. */
export function formatAvatarEmoji(emoji: string): string {
  return AVATAR_EMOJI_PREFIX + emoji.trim();
}