/**
 * Description block. Renders markdown via the standalone mobile markdown
 * renderer at apps/mobile/lib/markdown/. Empty / null descriptions show
 * a muted "No description." placeholder rather than collapsing the block,
 * so the layout above the timeline stays stable when the user adds a
 * description later.
 *
 * Attachments are fetched per-issue so markdown can resolve `mc://file/<id>`
 * image URIs into real `download_url` HTTPS endpoints — without this the
 * iOS image loader doesn't understand the mc: scheme and the image fails.
 * TanStack Query dedupes the request across this component and CommentCard
 * (both call `issueAttachmentsOptions(wsId, issueId)`), so only one
 * network roundtrip fires per issue.
 *
 * ## Reporting segment geometry (MYS-2112)
 *
 * An in-page find hit deep inside a long description has to land on the segment
 * that holds it rather than on the description's top, which needs each
 * segment's rectangle. `Markdown` measures them; this component forwards them
 * unchanged.
 *
 * Forwarded in `Markdown`'s own coordinates, NOT in the timeline's — the caller
 * already measures where this block sits (`measuredHeaderTopsRef.current
 * .description`, the same ref the existing description landing uses and the same
 * `onLayout`), so adding a second measurement here would be two sources for one
 * number. The wrapper View has no `paddingTop`, so the block's origin and
 * `Markdown`'s origin inside it are the same point and the forward is exact.
 */
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Markdown, type MarkdownSegmentLayout } from "@/lib/markdown";
import { issueAttachmentsOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export function IssueDescription({
  issueId,
  description,
  onSegmentLayout,
}: {
  issueId: string;
  description: string | null;
  /**
   * Reports each rendered segment's rectangle, relative to this block's top.
   * Omitted by every surface that does not need it — with no callback `Markdown`
   * adds no wrapper and this component is unchanged from before MYS-2112.
   */
  onSegmentLayout?: (report: MarkdownSegmentLayout) => void;
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: attachments } = useQuery(
    issueAttachmentsOptions(wsId, issueId),
  );

  if (!description || description.trim().length === 0) {
    return (
      <View className="px-4 pb-4">
        <Text className="text-body text-muted-foreground italic">
          {t("issue.noDescription")}
        </Text>
      </View>
    );
  }
  return (
    <View className="px-4 pb-4">
      <Markdown
        content={description}
        attachments={attachments}
        onSegmentLayout={onSegmentLayout}
      />
    </View>
  );
}
