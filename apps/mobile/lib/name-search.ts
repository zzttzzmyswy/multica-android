/**
 * The name predicate every directory picker searches with: case-insensitive
 * substring match, plus pinyin for Chinese names.
 *
 * This is web's exact search shape, repeated at 20-odd call sites across
 * `packages/views/` — `name.toLowerCase().includes(q) || matchesPinyin(name, q)`.
 * Mobile already owned `matchesPinyin` (`lib/pinyin-match.ts`, a 1:1 port) but
 * only wired it into three non-picker surfaces (global search, subscriber
 * picker, agents filter). Every picker body kept the bare `includes` half, so
 * the same directory answered the same query differently on the phone: with a
 * member named 「李云龙」, web's assignee picker finds him for `lyl` and
 * mobile's returned an empty list — an absence claim made from data that had
 * already arrived, the same defect class as MYS-1907 / MYS-1924.
 *
 * One function rather than a repeated inline expression so the arms can't
 * drift apart per call site, and so the wiring ratchet in
 * `lib/picker-name-search-wiring.test.ts` has a single token to assert on.
 *
 * The `matchesPinyin` arm is inert for a name with no Chinese characters (it
 * returns false up front), so a purely Latin name can never be pulled in by
 * pinyin — no false positives from this OR.
 */
import { matchesPinyin } from "./pinyin-match";

/**
 * Whether `name` matches the picker's search `query`. An empty (or
 * whitespace-only) query matches everything, which is what the call sites'
 * `!q ||` guards meant and what a search box with no input must do.
 */
export function matchesNameOrPinyin(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q) || matchesPinyin(name, q);
}
