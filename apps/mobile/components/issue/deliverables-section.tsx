/**
 * "Deliverables" in the issue header block — the files this issue's comments
 * delivered, as a whole (MUL-7649). Mirrors web's
 * `packages/views/issues/components/deliverables/deliverables-section.tsx`.
 *
 * Why this exists on the phone: web sums the same timeline into this section
 * and offers a "View all N deliverables" entry, so a reader on web can see
 * everything an issue produced. Mobile had no entry point at all, which meant
 * a phone user could not tell that an issue had delivered anything.
 *
 * Renders nothing until a comment delivers a file — an always-present empty
 * section would be a permanent no-op row on the vast majority of issues.
 *
 * Deliberate divergences from web, each noted at its site:
 *   - The section is a flat block inside the scrolling header (mobile has no
 *     sidebar), so it sits beside `PullRequestList` rather than in a rail.
 *   - Tapping a file opens the SAME exits the comment list already uses: the
 *     image lightbox for images, the download-and-open flow for everything
 *     else. No new preview surface is built here — web routes through its
 *     page-wide viewer, and mobile's equivalent is these two.
 *   - The overview is a bottom sheet rather than a full-window dialog; a phone
 *     has no `G` key and no window chrome to cover.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TimelineEntry } from "@multica/core/types";
import type { DeliverableFile } from "@multica/core/attachments/deliverables";
import { Text } from "@/components/ui/text";
import { DeliverableThumbnail } from "./deliverable-thumbnail";
import { DeliverablesOverviewSheet } from "./deliverables-overview-sheet";
import { useOpenDeliverable } from "@/lib/use-open-deliverable";
import {
  deliverableIconName,
  deliverableSize,
  deliverableTypeLabel,
  selectRecentDeliverables,
} from "@/lib/deliverables";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import type { DownloadSource } from "@/lib/download-store";

interface Props {
  files: readonly DeliverableFile[];
  /** The issue's identifier ("MYS-568"), for the overview's title. */
  identifier: string;
  /** The issue's timeline, so the overview's groups can name their author. */
  entries?: readonly TimelineEntry[];
  /** Where these files live, recorded into the download manager. */
  source?: DownloadSource;
}

export function DeliverablesSection({
  files,
  identifier,
  entries,
  source,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [open, setOpen] = useState(true);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const openFile = useOpenDeliverable(source);
  // The sheet is mounted unconditionally rather than only while `open`: it owns
  // its own `visible` gate, and mounting it inside the collapse branch would
  // unmount an open sheet the moment the reader collapsed the section.

  if (files.length === 0) return null;

  const { images, others } = selectRecentDeliverables(files);

  return (
    <View className="border-t border-border px-4 pt-2 pb-2">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t("deliverables.sectionTitle")}, ${files.length}`}
        className="flex-row items-center gap-1.5 py-1 active:opacity-70"
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={12}
          color={theme.mutedForeground}
        />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("deliverables.sectionTitle")}
        </Text>
        {/* The total, never the number of rows below: the grid and the file
            rows are capped, so anything that counted what is rendered would
            understate the issue's output. */}
        <Text className="text-xs tabular-nums text-muted-foreground">
          {files.length}
        </Text>
      </Pressable>

      {open ? (
        <View className="pt-1">
          {images.length > 0 ? (
            <View className="mb-1.5 flex-row gap-1.5">
              {images.map((file) => (
                <Pressable
                  key={file.key}
                  onPress={() => openFile(file.latest)}
                  accessibilityRole="button"
                  accessibilityLabel={versionedName(file, t)}
                  className="overflow-hidden rounded-md border border-border active:opacity-80"
                  style={{ flexBasis: "31.5%", flexGrow: 0, aspectRatio: 4 / 3 }}
                >
                  <DeliverableThumbnail
                    attachment={file.latest}
                    showTypeLabel={false}
                  />
                  {versionBadge(file, t)}
                </Pressable>
              ))}
            </View>
          ) : null}

          {others.map((file) => (
            <DeliverableRow
              key={file.key}
              file={file}
              onPress={() => openFile(file.latest)}
            />
          ))}

          <Pressable
            onPress={() => setOverviewOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("deliverables.viewAll", { count: files.length })}
            className="mt-1 flex-row items-center gap-2 py-1 active:opacity-70"
          >
            <Ionicons name="grid-outline" size={14} color={theme.mutedForeground} />
            <Text className="text-xs text-muted-foreground">
              {t("deliverables.viewAll", { count: files.length })}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <DeliverablesOverviewSheet
        visible={overviewOpen}
        onClose={() => setOverviewOpen(false)}
        identifier={identifier}
        files={files}
        entries={entries}
        source={source}
      />
    </View>
  );
}

/** `report.md, version 2` — the accessible name carrying what the badge
 *  shows visually as `v2`. Web's `versionedName`. */
function versionedName(
  file: DeliverableFile,
  t: (id: string, params?: Record<string, string | number>) => string,
): string {
  return file.versions.length > 1
    ? t("deliverables.nameWithVersion", {
        name: file.latest.filename,
        version: file.versions.length,
      })
    : file.latest.filename;
}

/** `v2` beside a file uploaded more than once. Decorative — the row's own
 *  accessible name carries the version in words. */
function versionBadge(
  file: DeliverableFile,
  t: (id: string, params?: Record<string, string | number>) => string,
) {
  if (file.versions.length < 2) return null;
  return (
    <View className="absolute right-1 bottom-1 rounded-sm bg-black/60 px-1">
      <Text className="text-[10px] font-medium tabular-nums text-white">
        {t("deliverables.versionShort", { version: file.versions.length })}
      </Text>
    </View>
  );
}

function DeliverableRow({
  file,
  onPress,
}: {
  file: DeliverableFile;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { latest } = file;
  const size = deliverableSize(latest);
  // The extension stands in when it is more specific than the glyph — a `.csv`
  // and a `.zip` share no glyph but both read as "other" without it.
  const kindLabel = deliverableTypeLabel(latest.filename);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={versionedName(file, t)}
      className="flex-row items-center gap-2 py-1 active:opacity-70"
    >
      <Ionicons
        name={deliverableIconName(latest.content_type, latest.filename)}
        size={14}
        color={theme.mutedForeground}
      />
      <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
        {latest.filename}
      </Text>
      {kindLabel ? (
        <Text className="text-[10px] text-muted-foreground">{kindLabel}</Text>
      ) : null}
      {file.versions.length > 1 ? (
        <View className="rounded-sm bg-secondary px-1">
          <Text className="text-[10px] font-medium tabular-nums text-muted-foreground">
            {t("deliverables.versionShort", { version: file.versions.length })}
          </Text>
        </View>
      ) : null}
      {size ? (
        <Text className="text-[10px] tabular-nums text-muted-foreground">
          {size}
        </Text>
      ) : null}
    </Pressable>
  );
}
