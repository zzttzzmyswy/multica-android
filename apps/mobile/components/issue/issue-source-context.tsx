/**
 * Source-context surfaces (MYS-2137): the strip above a comment-born issue's
 * title that says where it came from, and whether the source has moved on.
 *
 * The counterpart to `issue-duplicates.tsx`, and deliberately built the same
 * way — the RULES are not re-derived here. `sourceContextBanner` and
 * `sourceContextTarget` come from `@/lib/source-context`, so this component,
 * the author-side confirm surface and the tests cannot disagree about what a
 * banner means or where its link goes.
 *
 * What differs from web, and why:
 *
 *  - Web renders a full collapsed/expanded panel (`data-slot:
 *    "source-context-summary"` plus a content view with the frozen issue body
 *    and every comment in the thread). A phone cannot afford that above the
 *    title: the strip has to say "this came from MYS-2138's comment" and get
 *    out of the way, so mobile collapses it to ONE line that navigates.
 *  - Web's panel names each change reason inline. Mobile keeps the reasons in
 *    the banner's accessibility label and shows the count, because four
 *    reason chips plus an identifier plus a title do not fit one phone line.
 *    The reader still learns that something moved before they tap.
 *  - `unknown` ("we could not check the source") is a distinct state here, as
 *    in web, and it draws in neutral styling rather than the warning colour —
 *    a check that could not run is not a change.
 *
 * Reads `issue.source_context` straight off the payload — the server resolves
 * it into the issue itself (probed 2026-10-13), so the strip is correct on
 * first paint with no request of its own. An issue that was not opened from a
 * comment renders nothing.
 */
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { countLabelKey } from "@/lib/actor-profile";
import {
  changeReasonLabelKey,
  sourceContextBanner,
  sourceContextIdentifier,
  sourceContextTarget,
} from "@/lib/source-context";

export function IssueSourceContextBanner({ issue }: { issue: Issue }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  // Same test the tests and the author side use. A local `if
  // (!issue.source_context)` would draw a strip for a payload whose snapshot
  // parsed to nothing, which reads as "from (blank)".
  const banner = sourceContextBanner(issue);
  if (!banner) return null;

  const identifier = sourceContextIdentifier(issue.source_context);
  const target = sourceContextTarget(issue.source_context);
  const reasonLabels = (
    banner.kind === "changed" ? banner.reasons : []
  ).flatMap((reason) => {
    const key = changeReasonLabelKey(reason);
    return key ? [t(key)] : [];
  });

  // Colour by state: a deleted source is destructive, a stale snapshot warns,
  // and the two "nothing is wrong" states — unchanged and could-not-check —
  // stay neutral. `unavailable` deliberately does NOT warn; see the module doc.
  const tone =
    banner.kind === "deleted"
      ? { text: "text-destructive", border: "border-destructive/40", icon: theme.destructive }
      : banner.kind === "changed"
        ? { text: "text-warning", border: "border-warning/40", icon: theme.warning }
        : { text: "text-muted-foreground", border: "border-border", icon: theme.mutedForeground };

  const iconName =
    banner.kind === "deleted"
      ? "alert-circle-outline"
      : banner.kind === "changed"
        ? "time-outline"
        : banner.kind === "unknown"
          ? "help-circle-outline"
          : "git-branch-outline";

  const lead =
    banner.kind === "deleted"
      ? t("sourceContext.sourceDeleted", { identifier })
      : banner.kind === "changed"
        ? t("sourceContext.sourceChanged", { identifier })
        : banner.kind === "unknown"
          ? t("sourceContext.sourceUnchecked", { identifier })
          : t("sourceContext.createdFrom", { identifier });

  // One label for the whole strip, because for a screen reader the value is the
  // sentence, not the four pieces of punctuation that draw it.
  const accessibilityLabel =
    banner.kind === "changed"
      ? `${lead}. ${t("sourceContext.changeSentence", { content: reasonLabels.join("、") })}`
      : lead;

  const body = (
    <>
      <Ionicons name={iconName} size={14} color={tone.icon} />
      <Text className={`shrink-0 text-caption font-medium ${tone.text}`}>{lead}</Text>
      {/* What changed, as a count. A phone line cannot hold every reason name
          alongside the identifier and the action; the count still tells the
          reader that tapping is worth it, and the label above spells them out
          for assistive tech. */}
      {banner.kind === "changed" ? (
        <Text className="shrink-0 text-caption text-muted-foreground">
          {t(countLabelKey("sourceContext.changeCount", reasonLabels.length), {
            count: reasonLabels.length,
          })}
        </Text>
      ) : null}
      {target ? (
        <Ionicons name="arrow-forward" size={14} color={theme.mutedForeground} />
      ) : null}
    </>
  );

  // No target means there is nowhere to go (a deleted source, or a snapshot
  // with no anchor) — so the strip is a `View` and not a `Pressable`. A button
  // that silently does nothing is worse than a strip that does not claim to be
  // one.
  if (!target) {
    return (
      <View
        className={`mx-4 mt-3 flex-row items-center gap-1.5 rounded-md border bg-secondary/40 px-3 py-2 ${tone.border}`}
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => {
        if (!wsSlug) return;
        // `highlight` + `h` is the issue route's existing comment deep-link
        // (see `[workspace]/issue/[id].tsx`): `highlight` is the target comment
        // id and `h` is a per-tap nonce so re-tapping the SAME source re-fires
        // the scroll-and-flash. The inbox row uses the identical pair, so a
        // source link behaves exactly like an inbox link once it lands.
        router.push(
          `/${wsSlug}/issue/${target.issueId}?highlight=${target.anchorCommentId}&h=${Date.now()}`,
        );
      }}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      className={`mx-4 mt-3 flex-row items-center gap-1.5 rounded-md border bg-secondary/40 px-3 py-2 active:opacity-60 ${tone.border}`}
    >
      {body}
    </Pressable>
  );
}
