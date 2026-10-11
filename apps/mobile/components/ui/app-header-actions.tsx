/**
 * Header utility buttons shared across primary tabs (Inbox / My Issues).
 * Provides two global actions on the right: search and create-issue.
 *
 * These two tabs draw their own in-body `<Header>`, so the navigator's default
 * `headerRight` (the search entry every push screen gets — see
 * `components/ui/header-search-button.tsx`) does not reach them; this is where
 * they compose the same entry instead. Only the create-issue button is
 * specific to this component now — the search half is the shared
 * `HeaderSearchButton`, so there is exactly one implementation of that action
 * in the app.
 *
 * The workspace menu (global nav, workspace switcher, settings) is reached
 * via the "More" tab in the bottom bar.
 *
 * Tab-specific actions (e.g. My Issues filter) MUST NOT live here — they
 * mix scope levels with global actions and would clutter the strip.
 *
 * The create button carries the unsaved-draft dot (web's `DraftDot` on the
 * sidebar's "New issue" row): an unsent draft survives dismissing the form,
 * so without a marker the only way to learn one is waiting is to open the
 * form. Tapping the button is exactly the action the dot advertises, which
 * is why the marker belongs on it rather than somewhere passive.
 */
import { View } from "react-native";
import { router } from "expo-router";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderSearchButton } from "@/components/ui/header-search-button";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useNewIssueDraftStore, draftHasContent } from "@/data/stores/new-issue-draft-store";
import { useTranslation } from "@/lib/i18n/react";

export function HeaderActions() {
  const { t } = useTranslation();
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  // Derived in the selector, so it re-renders on any draft change and only
  // when the ANSWER flips — a method selector (`hasDraft()`) would never
  // re-render, because the method itself is stable.
  const hasDraft = useNewIssueDraftStore((s) => draftHasContent(s));

  const onCreate = () => {
    if (slug) router.push(`/${slug}/new-issue`);
  };

  return (
    <>
      <HeaderSearchButton />
      <View>
        <IconButton
          name="add"
          iconSize={24}
          onPress={onCreate}
          // The dot is decorative and hidden below, so the waiting draft has
          // to reach assistive tech through this label instead — otherwise the
          // only signal that work is saved is a coloured pixel.
          accessibilityLabel={
            hasDraft ? t("a11y.newIssueWithDraft") : t("a11y.newIssue")
          }
        />
        {hasDraft ? (
          <View
            className="absolute right-1 top-1 size-2 rounded-full bg-brand"
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
      </View>
    </>
  );
}
