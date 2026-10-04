/**
 * Issue metadata (G26) — the sidebar row that opens the issue's raw
 * `metadata` bag, mirroring web's `detail.section_metadata`
 * (packages/views/issues/components/issue-detail.tsx:2371-2393).
 *
 * Why this exists: `metadata` is the KV bag agents write pipeline state into
 * (PR number, `pipeline_status`, `waiting_on`). Web is the only place a human
 * can read it back, so without this row the values an agent wrote are
 * write-only from a phone.
 *
 * Read-only by design — web has no write path either (the bag is the agents'
 * channel), so no editor is built here.
 *
 * Two rendering choices follow web literally:
 *   - the row renders ONLY when the bag has keys. An empty `{}` would be a
 *     permanent no-op row on every issue that never used metadata.
 *   - the JSON is `JSON.stringify(metadata, null, 2)` in a mono block, not a
 *     prettified key/value list. The payload shape is agent-defined and
 *     arbitrary; a renderer that guessed at it would drop or mangle values.
 *
 * Unlike web's centered `Dialog`, this is a bottom-sheet Modal — the same
 * shell `UsageBreakdownDialog` uses, because the payload can be long and a
 * phone's centered dialog has no room for it.
 */
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueMetadata } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  /** The issue's `metadata` bag. `undefined`/`null`/`{}` all hide the row. */
  metadata: IssueMetadata | null | undefined;
}

export function IssueMetadataSection({ metadata }: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [open, setOpen] = useState(false);

  const count = Object.keys(metadata ?? {}).length;

  if (count === 0) return null;

  return (
    <View className="border-t border-border px-4 py-2">
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t("issue.metadata.sectionTitle")}, ${t(
          "issue.metadata.count",
          { count },
        )}`}
        className="flex-row items-center gap-1 py-1 active:opacity-70"
      >
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("issue.metadata.sectionTitle")}
        </Text>
        {/* Web prints the key count next to the heading (`· N`), which is the
            only signal that the bag is worth opening. */}
        <Text className="text-xs tabular-nums text-muted-foreground">
          · {count}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <Pressable className="absolute inset-0" onPress={() => setOpen(false)} />
          <View className="max-h-[80%] rounded-t-2xl bg-popover">
            <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
              <Text className="flex-1 text-base font-semibold text-foreground">
                {t("issue.metadata.sectionTitle")}
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t("a11y.close")}
                hitSlop={8}
                className="p-1"
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={theme.mutedForeground}
                />
              </Pressable>
            </View>
            {/* Web wraps this in `overflow-auto` so a long line scrolls
                sideways; the phone convention in this app is to WRAP instead
                (see `transcript-entry.tsx`'s PlainBlock, which renders agent
                tool input the same way). Wrapping keeps the JSON copyable and
                avoids nesting two ScrollViews, which is the layout most likely
                to fight the sheet's own gesture handling. */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerClassName="p-4"
            >
              <Text
                selectable
                className="font-mono text-xs leading-5 text-foreground"
              >
                {JSON.stringify(metadata ?? {}, null, 2)}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
