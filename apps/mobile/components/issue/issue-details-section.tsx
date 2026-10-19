/**
 * Issue "Details" block (iteration 259, MYS-2245) — who filed the issue, when
 * it was filed, and when it last moved. Mirrors web's collapsible
 * `detail.section_details` block
 * (`packages/views/issues/components/issue-detail.tsx:2337-2360`).
 *
 * Placement follows web: it sits at the very bottom of the sidebar, after the
 * execution log and the metadata bag, because these values never change once
 * the issue exists while everything above them is what a reader actually comes
 * to check. It renders unconditionally — unlike `IssueMetadataSection`, there
 * is always something to say (an issue always has a creator and two
 * timestamps), so the block is not gated on a non-empty check.
 *
 * Unlike web this block is NOT collapsible. Web needs the fold because its
 * sidebar is a tall desktop column shared with the execution log; on a phone
 * the block is three short rows at the end of a scroll, and a collapsed
 * default would hide exactly the facts this round exists to surface.
 *
 * The creator's name is an ASSERTION and obeys the 254–257 rule: while the
 * member/agent directory is unread the row draws a load mark rather than
 * 「Unknown」 (see `lib/issue-details-facts.ts`, which owns that decision).
 */
import { View } from "react-native";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorLookup } from "@/data/use-actor-name";
import { formatDateOnlyShort } from "@/lib/autopilot-format";
import { creatorLine } from "@/lib/issue-details-facts";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  issue: Issue;
}

export function IssueDetailsSection({ issue }: Props) {
  const { t } = useTranslation();
  const { getName, resolvedBy } = useActorLookup();

  const creator = creatorLine(issue, { readiness: resolvedBy, getName });

  return (
    <View className="border-t border-border px-4 py-3">
      <Text className="text-caption uppercase tracking-wider text-muted-foreground font-medium">
        {t("issue.details.sectionTitle")}
      </Text>
      <View className="mt-1.5 gap-1">
        <DetailRow label={t("issue.details.createdBy")}>
          {/* The avatar is drawn from `creator_type`/`creator_id` alone — a
              local read of the issue payload — so it is correct before any
              directory answers. Only the NAME waits. */}
          <ActorAvatar
            type={issue.creator_type}
            id={issue.creator_id}
            size={18}
          />
          {creator.kind === "name" ? (
            <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
              {creator.text}
            </Text>
          ) : (
            // A load mark, not 「Unknown」: the directory has not answered, so
            // the client cannot say who this is (MYS-2215's rule). A fixed-width
            // bar reads as "loading"; an empty string would read as "no creator".
            <View
              className="h-3 w-24 rounded bg-muted"
              accessibilityLabel={t("issue.details.creatorLoading")}
            />
          )}
        </DetailRow>
        <DetailRow label={t("issue.details.created")}>
          <Text className="flex-1 text-body text-muted-foreground">
            {formatDateOnlyShort(issue.created_at)}
          </Text>
        </DetailRow>
        <DetailRow label={t("issue.details.updated")}>
          <Text className="flex-1 text-body text-muted-foreground">
            {formatDateOnlyShort(issue.updated_at)}
          </Text>
        </DetailRow>
      </View>
    </View>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-20 text-caption text-muted-foreground">{label}</Text>
      <View className="flex-1 flex-row items-center gap-1.5 min-w-0">
        {children}
      </View>
    </View>
  );
}
