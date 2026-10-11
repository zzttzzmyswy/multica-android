/**
 * The one search affordance the phone puts in a header — shared by every
 * screen that reaches the workspace search panel.
 *
 * Why a shared component rather than a per-screen button: before this round
 * only two screens mounted a search entry (`components/ui/app-header-actions.tsx`,
 * imported by the Inbox and My Issues tabs), while web hangs its
 * `SearchTrigger` + `SearchCommand` on one shared dashboard layout so every
 * route under it is covered. 113 workspace screens could not reach search
 * here; two could. The fix is to stop hand-rolling the entry per screen.
 *
 * Two wiring levels mount this, and the reason there are two is React
 * Navigation's own option merge, not a preference:
 *   - `app/(app)/[workspace]/_layout.tsx` sets it as the navigator's DEFAULT
 *     `headerRight`, which is what covers the ~67 push screens that declare
 *     no `headerRight` of their own.
 *   - Screens that DO declare one get their options merged key-by-key
 *     (`Object.assign` over `[screenOptions, group options, screen.options,
 *     setOptions]` — @react-navigation/core `useDescriptors.js`), so their
 *     `headerRight` REPLACES the default wholesale and the search entry would
 *     silently vanish. Those screens compose this component next to their own
 *     action instead. Composing one shared node is what keeps that from being
 *     a per-screen reimplementation.
 *
 * `issueId` is how the panel learns which issue it was opened from. Web parses
 * it out of the pathname (`/{slug}/issues/{id}`) because its palette is a
 * portal rendered over the live route; mobile's panel is its own modal route,
 * whose pathname is just `/search` — so the fact travels as a route param.
 * It gates four issue-scoped commands (see `lib/search-commands.ts`).
 */
import { router } from "expo-router";
import { View } from "react-native";
import { IconButton } from "@/components/ui/icon-button";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { searchPath } from "@/lib/search-route";

export function HeaderSearchButton({ issueId }: { issueId?: string | null }) {
  const { t } = useTranslation();
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  return (
    <IconButton
      name="search"
      onPress={() => {
        if (slug) router.push(searchPath(slug, issueId));
      }}
      accessibilityLabel={t("a11y.search")}
    />
  );
}

/**
 * A screen's own header actions with the search entry prepended — for the
 * screens whose `headerRight` replaces the navigator default (see the file
 * header).
 *
 * `children` is optional on purpose. Several screens return `null` from their
 * own `headerRight` when the viewer lacks a management permission (the `+` on
 * MCP servers / properties / quick actions). Search is NOT permission-gated —
 * web shows its `SearchTrigger` to every member — so those screens pass no
 * children and still offer search, rather than the permission check silently
 * taking the entry away with the button it was only meant to hide.
 *
 * Search leads the group so that on the issue page it is not adjacent to the
 * in-page "find" magnifier: the two are different actions (global search vs
 * web's Cmd/Ctrl+F over this document) and carry distinct accessibility
 * labels, but side-by-side identical glyphs would still read as one control.
 */
export function HeaderSearchGroup({ children }: { children?: React.ReactNode }) {
  return (
    <View className="flex-row items-center gap-2">
      <HeaderSearchButton />
      {children}
    </View>
  );
}
