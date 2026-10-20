/**
 * The persisted-payload reader for the "create another" preference, kept in
 * its own module so it can be tested without pulling in `expo-file-system`
 * and React Native (the store next to it imports both).
 *
 * The rule is deliberately strict: only a literal `true` turns the preference
 * on. The value round-trips through a JSON file that a previous app version,
 * a manual edit or a partial write could have left in any shape, and the safe
 * failure direction is "close after creating" — a form that stays open when
 * the user did not ask it to is a much louder bug than one that closes.
 */
export function normalizeKeepOpen(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as { keepOpen?: unknown }).keepOpen === true;
}
