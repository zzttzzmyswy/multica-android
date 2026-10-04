/**
 * Property-catalog status painter — a thin alias over the generic
 * `CatalogStatus` (MYS-1907).
 *
 * This started as its own component in MYS-1892, when the custom-property
 * catalog was the only directory known to collapse "loading" / "failed" /
 * "genuinely none" into one sentence. The same collapse turned out to live in
 * every other workspace directory too, so the implementation moved to
 * `components/catalog/catalog-status.tsx` and this file keeps the
 * property-flavoured name the five property surfaces already import.
 *
 * Two independent implementations of one truth is how the second half of a
 * bug family survives — the next reader has to notice there are two and
 * decide which one is authoritative. There is one.
 *
 * The error copy is still NOT defaulted to `properties.loadError`: that key
 * ends in a colon because the management page appends `error.message` after
 * it (`more/properties.tsx`), and a bare colon here would dangle.
 */
export { CatalogStatus as PropertyCatalogStatus } from "@/components/catalog/catalog-status";
