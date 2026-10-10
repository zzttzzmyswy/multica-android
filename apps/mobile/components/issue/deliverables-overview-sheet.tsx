/**
 * The issue's full deliverables list, as a bottom sheet — web's
 * `DeliverablesOverview` (`deliverables-overview.tsx`), which is a full-window
 * dialog there.
 *
 * A sheet rather than a dialog because a phone has no window chrome to cover
 * and no `G` key to return with; the sheet shell is the app's existing drill-in
 * container (`PickerSheet`), so this reads as the same kind of surface as the
 * thread navigator and the usage breakdown.
 *
 * What it must NOT do is disagree with the section that opened it:
 *   - files show their LATEST version only, so the count here always equals the
 *     sidebar's badge (both read the same `files` array);
 *   - the groups are the comments that posted them, in page order, so the reader
 *     can see which run produced what;
 *   - the filter chips partition the list through the shared
 *     `deliverableCategory`, the same call the sidebar's image/file split makes.
 *
 * Version switching lives here rather than on the tile: web puts a version
 * dropdown in its viewer's title bar, and mobile's viewer (`react-native-
 * image-viewing`) has no such slot. The tile shows `vN`, and tapping the badge
 * opens this sheet's version picker — the same information reachable one tap
 * away instead of inside the viewer.
 */
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Attachment, TimelineEntry } from "@multica/core/types";
import type { DeliverableFile } from "@multica/core/attachments/deliverables";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { DeliverableThumbnail } from "./deliverable-thumbnail";
import { useOpenDeliverable } from "@/lib/use-open-deliverable";
import {
  DELIVERABLE_CATEGORIES,
  deliverableCategoryCounts,
  deliverableIconName,
  deliverableSize,
  deliverableTypeLabel,
  groupDeliverablesByComment,
  type DeliverableCategory,
} from "@/lib/deliverables";
import { formatBytes } from "@/lib/format-bytes";
import { useTranslation } from "@/lib/i18n/react";
import { useActorLookup } from "@/data/use-actor-name";
import { useTimeAgo } from "@/lib/time-ago";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import type { DownloadSource } from "@/lib/download-store";

type Filter = "all" | DeliverableCategory;

/** The actor union core's timeline types carry — `actor_type` is a bare
 *  `string` there, while `ActorAvatar` and `useActorLookup` take this closed
 *  set. Same narrowing `thread-nav-sheet.tsx` and `comment-card.tsx` do. */
type ActorType = "member" | "agent" | "squad" | "system" | null | undefined;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The issue identifier ("MYS-568"), for the title. */
  identifier: string;
  files: readonly DeliverableFile[];
  /** The issue's timeline, for the group headers' author and timestamp. */
  entries?: readonly TimelineEntry[];
  source?: DownloadSource;
}

export function DeliverablesOverviewSheet({
  visible,
  onClose,
  identifier,
  files,
  entries,
  source,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { getName } = useActorLookup();
  const timeAgo = useTimeAgo();
  const openFile = useOpenDeliverable(source);
  const [filter, setFilter] = useState<Filter>("all");
  // The file whose versions the picker is showing, or null.
  const [versionOf, setVersionOf] = useState<DeliverableFile | null>(null);

  // Each opening starts clean. Web resets the panel on open for the same
  // reason: a filter carried over from last time reads as an empty list.
  useEffect(() => {
    if (!visible) {
      setFilter("all");
      setVersionOf(null);
    }
  }, [visible]);

  const counts = useMemo(() => deliverableCategoryCounts(files), [files]);
  const commentById = useMemo(() => {
    const map = new Map<string, TimelineEntry>();
    for (const entry of entries ?? []) {
      if (entry.type === "comment") map.set(entry.id, entry);
    }
    return map;
  }, [entries]);

  const groups = useMemo(
    () =>
      groupDeliverablesByComment(
        files,
        filter,
        (commentId) => commentById.get(commentId)?.created_at,
      ),
    [files, filter, commentById],
  );

  const totalBytes = files.reduce((sum, f) => sum + Math.max(0, f.latest.size_bytes), 0);
  const summary =
    totalBytes > 0
      ? t("deliverables.overviewSummaryWithSize", {
          count: files.length,
          size: formatBytes(totalBytes),
        })
      : t("deliverables.overviewSummary", { count: files.length });

  const filterLabel: Record<DeliverableCategory, string> = {
    image: t("deliverables.filterImage"),
    document: t("deliverables.filterDocument"),
    video: t("deliverables.filterVideo"),
    other: t("deliverables.filterMisc"),
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="absolute inset-0" onPress={onClose} />
        <View className="max-h-[85%] rounded-t-2xl bg-popover">
          <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
            <View className="min-w-0 flex-1">
              <Text className="text-title-sm font-semibold text-foreground" numberOfLines={1}>
                {t("deliverables.overviewTitle", { identifier })}
              </Text>
              <Text className="text-caption tabular-nums text-muted-foreground">
                {summary}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("deliverables.overviewClose")}
              className="p-1"
            >
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>

          {/* The filter row scrolls sideways: five chips with their counts do
              not fit a phone's width, and wrapping them would push the list
              down on every open. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 px-4 py-2"
          >
            <FilterChip
              label={t("deliverables.filterAll")}
              count={files.length}
              active={filter === "all"}
              onPress={() => setFilter("all")}
            />
            {DELIVERABLE_CATEGORIES.map((category) => (
              <FilterChip
                key={category}
                label={filterLabel[category]}
                count={counts[category]}
                active={filter === category}
                onPress={() => setFilter(category)}
              />
            ))}
          </ScrollView>

          <ScrollView
            className="flex-1"
            contentContainerClassName="px-4 pb-8"
            showsVerticalScrollIndicator={false}
          >
            {groups.length === 0 ? (
              // The same sentence web shows for a filter with no matches. It is
              // only reachable here after the reader picked a chip: the section
              // that opens this sheet renders nothing at all when the issue
              // delivered nothing, so there is no "empty issue" reading of it.
              <Text className="pt-16 text-center text-body text-muted-foreground">
                {t("deliverables.overviewEmpty")}
              </Text>
            ) : (
              groups.map((group) => {
                const comment = commentById.get(group.commentId);
                const first = group.files[0]!.latest;
                // The comment names its author; without it (a timeline entry the
                // client has not loaded) the uploader stands in — web's fallback.
                const actorType = (comment?.actor_type ??
                  first.uploader_type) as ActorType;
                const actorId = comment?.actor_id ?? first.uploader_id;
                const at = comment?.created_at ?? first.created_at;
                // `useActorLookup`'s three lists are member / agent / squad, and
                // its `getName` has no `system` arm — the string "system" falls
                // through to its squad fallback and would print "Squad" for a
                // platform-generated comment. comment-card.tsx narrows the same
                // way, for the same reason.
                const name = getName(
                  actorType as "member" | "agent" | "squad" | null | undefined,
                  actorId,
                );
                return (
                  <View key={group.commentId} className="pt-3">
                    <View className="mb-2 flex-row items-center gap-2">
                      <ActorAvatar type={actorType} id={actorId} size={24} />
                      <Text className="flex-1 text-body font-medium" numberOfLines={1}>
                        {t("deliverables.groupCommentBy", {
                          name,
                        })}
                      </Text>
                      <Text className="text-caption text-muted-foreground">
                        {timeAgo(at)}
                      </Text>
                    </View>
                    {group.files.map((file) => (
                      <FileTile
                        key={file.key}
                        file={file}
                        onOpen={() => {
                          onClose();
                          openFile(file.latest);
                        }}
                        onPickVersion={() => setVersionOf(file)}
                      />
                    ))}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>

      <VersionPickerSheet
        file={versionOf}
        onClose={() => setVersionOf(null)}
        onOpen={(attachment) => {
          setVersionOf(null);
          // Close the overview first: it covers the screen, so opening the file
          // underneath it would leave the reader looking at the list they just
          // tapped (web closes before opening for the same reason).
          onClose();
          openFile(attachment);
        }}
      />
    </Modal>
  );
}

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} ${count}`}
      className={`flex-row items-center gap-1 rounded-full border px-3 py-1 active:opacity-70 ${
        active ? "border-foreground bg-secondary" : "border-border"
      }`}
    >
      <Text className="text-caption text-foreground">{label}</Text>
      <Text className="text-caption tabular-nums text-muted-foreground">{count}</Text>
    </Pressable>
  );
}

/** One deliverable in the sheet: its face, its name, and its version badge. */
function FileTile({
  file,
  onOpen,
  onPickVersion,
}: {
  file: DeliverableFile;
  onOpen: () => void;
  onPickVersion: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { latest } = file;
  const size = deliverableSize(latest);
  const kindLabel = deliverableTypeLabel(latest.filename);
  const multiVersion = file.versions.length > 1;

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={
        multiVersion
          ? t("deliverables.nameWithVersion", {
              name: latest.filename,
              version: file.versions.length,
            })
          : latest.filename
      }
      className="mb-3 flex-row items-center gap-3 rounded-lg border border-border p-2 active:opacity-80"
    >
      <View className="h-12 w-12 overflow-hidden rounded-md">
        <DeliverableThumbnail attachment={latest} showTypeLabel={false} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-body text-foreground" numberOfLines={1}>
          {latest.filename}
        </Text>
        <Text className="text-caption tabular-nums text-muted-foreground">
          {[kindLabel, size].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {multiVersion ? (
        <Pressable
          onPress={onPickVersion}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("deliverables.versionLabel", {
            version: file.versions.length,
            total: file.versions.length,
          })}
          className="flex-row items-center gap-0.5 rounded-sm bg-secondary px-1.5 py-0.5 active:opacity-70"
        >
          <Text className="text-micro font-medium tabular-nums text-muted-foreground">
            {t("deliverables.versionOf", {
              version: file.versions.length,
              total: file.versions.length,
            })}
          </Text>
          <Ionicons name="chevron-down" size={10} color={theme.mutedForeground} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * Pick a version of one file — newest first, like every version picker people
 * know. Web's `VersionSwitcher` lists the same three facts per version (its
 * `vN`, its upload time, its size) and marks the one being shown.
 */
function VersionPickerSheet({
  file,
  onClose,
  onOpen,
}: {
  file: DeliverableFile | null;
  onClose: () => void;
  /** The chosen version, as the record — the caller opens it and closes both
   *  sheets, so the picker itself needs no id lookup. */
  onOpen: (attachment: Attachment) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const timeAgo = useTimeAgo();
  const visible = file !== null;
  const versions = file ? [...file.versions].reverse() : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="absolute inset-0" onPress={onClose} />
        <View className="max-h-[60%] rounded-t-2xl bg-popover">
          <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
            <Text className="flex-1 text-title-sm font-semibold text-foreground" numberOfLines={1}>
              {file?.latest.filename}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("deliverables.overviewClose")}
              className="p-1"
            >
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="py-1">
            {versions.map((attachment, index) => {
              const version = versions.length - index;
              const current = version === versions.length;
              const size = deliverableSize(attachment);
              return (
                <Pressable
                  key={attachment.id}
                  onPress={() => onOpen(attachment)}
                  accessibilityRole="button"
                  accessibilityLabel={t("deliverables.versionLabel", {
                    version,
                    total: versions.length,
                  })}
                  accessibilityState={{ selected: current }}
                  className="flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary/50"
                >
                  <Text className="w-8 text-body font-medium tabular-nums text-foreground">
                    {t("deliverables.versionShort", { version })}
                  </Text>
                  <Text className="flex-1 text-caption tabular-nums text-muted-foreground">
                    {[timeAgo(attachment.created_at), size]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  {current ? (
                    <Ionicons name="checkmark" size={16} color={theme.foreground} />
                  ) : (
                    <Ionicons
                      name={deliverableIconName(
                        attachment.content_type,
                        attachment.filename,
                      )}
                      size={16}
                      color={theme.mutedForeground}
                    />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
