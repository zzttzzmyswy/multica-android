/**
 * Search over a custom property's option list — the mobile half of web's
 * `custom-property-picker.tsx` (`packages/views/issues/components/pickers/`).
 *
 * Web mounts its search input at `searchable={options.length > 7}` on BOTH the
 * `select` (`:175`) and `multi_select` (`:211`) branches, and the query is
 * applied by `PropertyPicker` itself (`property-picker.tsx:89-101`). Mobile's
 * `PropertyValueBody` rendered the full `FlatList` in both cases, so a
 * workspace with ten-plus options on a property meant blind-scrolling a sheet
 * that only shows five rows.
 *
 * Four decisions live here rather than in the component, because each one is
 * easy to get subtly wrong and invisible when you do:
 *
 * 1. **The threshold is `> 7`, not `>= 7`.** Seven options fit the sheet
 *    without scrolling on the smallest supported height; at or below it a
 *    search row is pure noise that steals a row from the options themselves.
 *    Web picked 7, and a different number here would make the same property
 *    grow a search box on the phone and not on the web.
 *
 * 2. **The option list is read from the property, not passed in.** A signature
 *    taking `(options, query)` for the *threshold* would let one branch pass
 *    the unfiltered set and another the filtered one, so the two shapes could
 *    disagree about when the field appears. `shouldSearchPropertyOptions`
 *    therefore takes the definition and reads `config.options` through
 *    `propertyOptions`, the same accessor the body renders from.
 *
 * 3. **Matching is `matchesNameOrPinyin`,** the predicate every other mobile
 *    picker uses (`lib/name-search.ts`) — case-insensitive substring plus
 *    pinyin, so an option named 「后端」 is reachable by `hd`. Web's
 *    `toLowerCase().includes` half is a strict subset of this; using the
 *    project's own helper means the option picker answers a Chinese query the
 *    same way the assignee picker does, instead of being the one directory
 *    that cannot.
 *
 * 4. **An empty query is not an empty result.** `""` and whitespace-only both
 *    return every option — trimming before the emptiness check is what stops a
 *    stray space from a keyboard's autocomplete from blanking the list.
 *
 * Callers must render the empty case: `hasNoPropertyOptionMatch` is a real
 * "nothing matched this query" and the body says so, since a blank sheet reads
 * as "this property has no options".
 */
import type { IssueProperty, IssuePropertyOption } from "@multica/core/types";
import { propertyOptions } from "./issue-properties";
import { matchesNameOrPinyin } from "./name-search";

/**
 * Option count above which the picker grows a search input. Mirrors web's
 * literal `options.length > 7` on both the select and multi_select branches.
 */
export const PROPERTY_OPTION_SEARCH_THRESHOLD = 7;

/**
 * Whether this property's option list is long enough to be worth a search
 * field. Reads the definition rather than a passed-in count — see rule 2 in
 * the module doc.
 */
export function shouldSearchPropertyOptions(property: IssueProperty): boolean {
  return propertyOptions(property).length > PROPERTY_OPTION_SEARCH_THRESHOLD;
}

/**
 * The options a query selects, in their original order.
 *
 * Order is preserved deliberately: the definition's own ordering is what the
 * user arranged in settings, and re-sorting by match quality would make the
 * list jump under their finger as they type. Matching runs against `name`
 * only — option ids are opaque (`opt-0`…), and matching them would surface
 * rows whose visible text has nothing to do with what was typed.
 */
export function filterPropertyOptions(
  options: readonly IssuePropertyOption[],
  query: string,
): IssuePropertyOption[] {
  return options.filter((option) => matchesNameOrPinyin(option.name, query));
}

/**
 * Whether a filtered result count means "the query matched nothing".
 *
 * Takes the COUNT the body already has rather than re-running the filter: the
 * body renders from the filtered array, so deriving the empty case from
 * anything else would let the message and the list disagree. The caller pairs
 * it with a non-empty query — a definition with zero options is a different
 * sentence (nothing has been defined yet), and must not be told to the user as
 * "your search found nothing".
 */
export function hasNoPropertyOptionMatch(matchedCount: number): boolean {
  return matchedCount === 0;
}
