/**
 * The run's diagnostics, behind the transcript header's ⓘ — the mobile port of
 * web's `PopoverContent` body (`agent-transcript-dialog.tsx:744-830`).
 *
 * Web parks these in a hover/tap popover because they are tier-2 facts: a
 * reader wants the runtime, the workdir, or the persisted error only when
 * debugging *this* run. A phone has no popover anchored to a small icon, so the
 * same list renders as a bottom-sheet `Modal` — the pattern this repo already
 * uses for the per-run usage breakdown (`usage-breakdown-dialog.tsx`) and the
 * attribution sheet.
 *
 * The row list itself comes from `buildRunDetailRows` / `buildUsageDetailRows`
 * in `lib/run-transcript-details.ts`, so the order, the conditional rows and
 * the em-dash rules are unit-tested without the native chain.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { RunDetailRow } from "@/lib/run-transcript-details";

export function RunDetailsPanel({
  visible,
  onClose,
  detailRows,
  usageRows,
}: {
  visible: boolean;
  onClose: () => void;
  /** Runtime / workdir / timestamps / reason, in web's order. */
  detailRows: readonly RunDetailRow[];
  /**
   * The usage split, or `null` when no usage was recorded. `null` omits the
   * block *and its separator* — a divider with nothing under it would read as
   * a truncated list (web guards the same way).
   */
  usageRows: readonly RunDetailRow[] | null;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        {/* Stop the tap from falling through to the backdrop and closing the
            sheet while the user is reading it. */}
        <Pressable
          className="max-h-[75%] rounded-t-2xl bg-background"
          onPress={() => {}}
        >
          <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
            <Text className="flex-1 text-base font-semibold text-foreground">
              {t("runs.transcript.runInfo")}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.close")}
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView contentContainerClassName="px-4 py-3 gap-2">
            {detailRows.map((row) => (
              <DetailRow key={row.labelKey} row={row} />
            ))}

            {usageRows ? (
              <>
                <View className="my-1 h-px bg-border" />
                {usageRows.map((row) => (
                  <DetailRow key={row.labelKey} row={row} />
                ))}
              </>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * One label/value pair. `mono` marks the workspace-relative path and the branch
 * ref, which are machine strings the reader may want to compare character by
 * character (web renders those in a mono face too).
 *
 * The value breaks mid-token rather than wrapping at whitespace: a workdir and a
 * branch ref have no spaces, so word wrapping alone would push them off-screen
 * (web uses `break-all` for the same reason). `selectable` keeps the one thing a
 * phone can usefully do with a path — copy it — available.
 */
function DetailRow({ row }: { row: RunDetailRow }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-start gap-3">
      <Text className="w-20 shrink-0 text-xs text-muted-foreground">
        {t(row.labelKey)}
      </Text>
      <Text
        className={cn(
          "flex-1 text-xs text-foreground break-all",
          row.mono && "font-mono",
        )}
        selectable
      >
        {row.value}
      </Text>
    </View>
  );
}
