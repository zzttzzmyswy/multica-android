/**
 * The `t` + catalog bundle every sentence in `lib/wakeup-presentation.ts`
 * needs, built once per component that draws one.
 *
 * Extracted from `components/issue/wakeups-section.tsx` (iteration 266,
 * MYS-2300) when run rows became a second read surface: a wakeup run's row
 * names the rule's condition, and that sentence must be the SAME sentence the
 * section above it shows for the same rule. Two bundles assembled separately
 * would be two chances to leave out `statusLabel` — and a condition mentioning
 * a status would then print the raw key `in_review` in one place and
 * "In Review" in the other.
 *
 * Every line these sentences draw is an ASSERTION about a rule read back from
 * the server, which is why `actorName` is the three-state resolver and not a
 * string: an unread directory has to retreat the sentence rather than fill its
 * argument with a placeholder (MYS-2228, `lib/actor-name-state.ts`).
 * `lib/actor-sentence-wiring.test.ts` pins that choice.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { labelListOptions } from "@/data/queries/labels";
import { propertyCatalogOptions } from "@/data/queries/properties";
import { useStatusLabel } from "@/lib/status-options";
import { useTranslation } from "@/lib/i18n/react";
import type { WakeupTextDeps } from "@/lib/wakeup-presentation";

/**
 * Build the bundle.
 *
 * `catalogs` gates the two workspace catalog reads (labels, properties). Pass
 * `false` on any surface that cannot reach a condition mentioning one of them:
 * the wakeup section only draws rules it already has, and a run row only builds
 * a condition sentence when the run is wakeup-triggered. Since `useRunWakeup`
 * mounts per ROW, an ungated pair here would put two query observers behind
 * every run — 3,600 of them on an issue with 1,800 runs — for data most rows
 * never read.
 *
 * The hook itself is always called (Rules of Hooks); the flag only flips
 * `enabled` on the queries inside it, so a row that becomes a wakeup run on the
 * next poll starts reading the catalogs then.
 */
export function useWakeupText(catalogs = true): WakeupTextDeps {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const { resolveActorName } = useActorLookup();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // Both are cached workspace catalogs the issue page already loads, so on a
  // warm cache these cost nothing. `enabled` keeps an un-catalogued surface
  // from firing them at all.
  const labels = useQuery({ ...labelListOptions(wsId), enabled: catalogs && !!wsId });
  const properties = useQuery({
    ...propertyCatalogOptions(wsId),
    enabled: catalogs && !!wsId,
  });

  return useMemo<WakeupTextDeps>(
    () => ({
      t,
      statusLabel,
      // ASSERT: every line this bundle draws is a rule read back from the
      // server. An unread directory must retreat to a sentence that names
      // nobody rather than print a fallback name inside the template (MYS-2228).
      actorName: (type, id) => resolveActorName(type, id),
      labelName: (id) => labels.data?.find((label) => label.id === id)?.name,
      property: (id) =>
        properties.data?.find((definition) => definition.id === id),
    }),
    [t, statusLabel, resolveActorName, labels.data, properties.data],
  );
}
