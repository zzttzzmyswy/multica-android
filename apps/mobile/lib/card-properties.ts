/**
 * Which CUSTOM properties a board card shows, and what each chip reads.
 *
 * The second half of web's card display settings: `cardProperties`
 * (issue-filter-slice.ts) gates the eight built-in fields, while
 * `cardPropertyIds` names the workspace's own definitions to render. Web
 * resolves the two independently on its board card
 * (packages/views/issues/components/board-card.tsx:64-72) and this module is
 * that resolution, kept pure so the drop rules are unit-testable.
 *
 * Three things make a configured id produce no chip, all mirroring web:
 *   - the definition is not in the catalog handed in (deleted — web's
 *     `workspaceProperties.find` returns undefined and the `.filter(p => !!p)`
 *     drops it);
 *   - the issue carries no value for it (web's
 *     `.filter(p => issue.properties?.[p.id] !== undefined)`);
 *   - the value cannot be rendered — a select / multi_select whose option was
 *     deleted from the definition (mobile's `formatPropertyValue`, same
 *     semantics as web's `CustomPropertyValueDisplay`). Without this third
 *     pass a deleted option would paint a raw UUID.
 *
 * The catalog is the caller's choice: mobile's board card passes the ACTIVE
 * definitions, which is what web's board card queries
 * (`propertyListOptions(cardWsId)`, includeArchived defaulting to false) —
 * see the call site for why archived definitions render no chip in either
 * client.
 */
import type {
  IssueProperty,
  IssuePropertyValues,
} from "@multica/core/types";
import { formatPropertyValue, type PropertyValueDisplay } from "./issue-properties";

/**
 * How many custom-property chips a phone-height card draws.
 *
 * **Intentional mobile divergence.** Web's board card maps the whole
 * `cardPropertyIds` array with no cap (board-card.tsx:69-72) and lets the card
 * grow. Mobile's card is 272pt wide and its module contract is density — the
 * label row on the same card caps at three for exactly this reason — so the
 * overflow folds into a "+N" count. The SET is identical to web's; only how
 * many are painted at once differs.
 */
export const CARD_PROPERTY_CHIP_LIMIT = 3;

export interface CardPropertyEntry {
  property: IssueProperty;
  /** Always a renderable display — `null` results were already dropped. */
  display: PropertyValueDisplay;
}

/**
 * Resolve `cardPropertyIds` against the workspace catalog and this issue's
 * values, in toggle order (web renders the array in order, and
 * `toggleCardPropertyId` appends).
 */
export function resolveCardPropertyEntries(
  cardPropertyIds: readonly string[],
  catalog: readonly IssueProperty[],
  values: IssuePropertyValues,
): CardPropertyEntry[] {
  const entries: CardPropertyEntry[] = [];
  for (const id of cardPropertyIds) {
    const property = catalog.find((p) => p.id === id);
    if (!property) continue;
    const value = values[id];
    if (value === undefined) continue;
    const display = formatPropertyValue(property, value);
    if (display === null) continue;
    entries.push({ property, display });
  }
  return entries;
}

/** First `limit` entries plus a count of what was folded away. */
export function limitCardPropertyEntries(
  entries: readonly CardPropertyEntry[],
  limit: number = CARD_PROPERTY_CHIP_LIMIT,
): { shown: CardPropertyEntry[]; rest: number } {
  return {
    shown: entries.slice(0, limit),
    rest: Math.max(0, entries.length - limit),
  };
}

/** One card chip's rendered content: the value text plus an optional swatch
 *  color the surface paints as a dot. */
export interface CardPropertyChip {
  text: string;
  /** Present for select / multi_select — the option's own color. */
  color?: string;
  /** Entries folded away on a multi_select / multi_actor chip, for a "+N"
   *  suffix. */
  rest?: number;
}

/**
 * Resolves one actor reference to its display name. Callers that can render
 * actor chips MUST pass this: without it an actor chip would print the
 * `member:<uuid>` reference, which is the exact defect these branches exist
 * to remove.
 */
export type ActorNameResolver = (
  type: "member" | "agent" | "squad" | null | undefined,
  id: string | null | undefined,
) => string;

/**
 * Fold a resolved display into the single chip a phone-height card can draw.
 *
 * **Intentional mobile divergence from web.** Web's `CustomPropertyValueDisplay`
 * paints one chip PER multi_select option (custom-property-picker.tsx:456-472);
 * a 272pt card cannot, so mobile shows the first option plus a "+N" count — the
 * same fold the label row on this card already uses. Every other kind maps 1:1
 * onto its web rendering, including the checkbox Yes/No wording web takes from
 * the same locale keys.
 *
 * `t` is the caller's translator: this module stays free of the i18n runtime so
 * the mapping is unit-testable, and `formatPropertyValue` has already resolved
 * the type-specific shapes.
 */
export function cardPropertyChip(
  display: PropertyValueDisplay,
  t: (key: string) => string,
  /** Names actor references. Required, not optional: an actor chip with no
   *  resolver would print `member:<uuid>`, which is the defect these branches
   *  exist to remove — so the compiler should refuse the call site. */
  getName: ActorNameResolver,
): CardPropertyChip {
  switch (display.kind) {
    case "option":
      return { text: display.option.name, color: display.option.color };
    case "options":
      return {
        text: display.options[0].name,
        color: display.options[0].color,
        ...(display.options.length > 1 ? { rest: display.options.length - 1 } : {}),
      };
    case "checkbox":
      return { text: t(display.value ? "properties.value.true" : "properties.value.false") };
    case "date":
      return { text: display.text };
    case "actors": {
      // Fold like multi_select: a card chip is one line. The names come from
      // the member directory, never from the raw `member:<uuid>` reference.
      const name = (i: number) =>
        getName(display.refs[i].kind, display.refs[i].id);
      return {
        text: name(0),
        ...(display.refs.length > 1 ? { rest: display.refs.length - 1 } : {}),
      };
    }
    case "unknownActors":
      // Not "empty": the field holds a value this build cannot read, and a
      // blank chip would misreport that as unset.
      return { text: t("properties.value.unknown") };
    default:
      return { text: display.text };
  }
}
