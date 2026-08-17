/**
 * Full-IANA timezone picker for the settings preferences row (mirror of web's
 * TimezoneRow select). Bottom-sheet modal with a search filter, the current
 * value and the device zone pinned to the top, a "Follow system" option to
 * clear the account preference, and GMT-offset labels. Heavier than the
 * autopilot schedule picker by design: settings own the full account tz, so a
 * user needing a non-curated zone must not be stuck with the ~19 curated ones.
 */
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import {
  browserTimezone,
  cityLabel,
  timezoneOptions,
  tzOffset,
} from "@/lib/timezone";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";

type Row =
  | { key: string; kind: "system" }
  | { key: string; kind: "tz"; tz: string; pinned?: "current" | "device" };

interface Props {
  visible: boolean;
  /** The stored account preference (user.timezone); null while following system. */
  value: string | null;
  onSelect: (tz: string | null) => void;
  onClose: () => void;
}

export function SettingsTimezonePicker({
  visible,
  value,
  onSelect,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [query, setQuery] = useState("");

  const deviceTz = browserTimezone() ?? "UTC";
  const effective = value ?? deviceTz;

  const all = useMemo(() => timezoneOptions(effective), [effective]);

  // GMT offsets are stable per zone for a session and each lookup cold-builds
  // an Intl.DateTimeFormat, so compute them once per options set instead of on
  // every search keystroke (the filter would otherwise pay ~400 lookups per
  // keypress on the JS thread).
  const offsets = useMemo(() => {
    const map = new Map<string, string>();
    for (const tz of all) map.set(tz, tzOffset(tz));
    return map;
  }, [all]);

  const labelOf = (tz: string) => {
    if (!tz) return tz;
    if (tz === "UTC") return "UTC";
    const offset = offsets.get(tz);
    return offset ? `${offset} ${tz}` : tz;
  };

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const systemRow: Row = { key: "__system__", kind: "system" };

    if (q) {
      const matches = all.filter((tz) => {
        const haystack =
          `${tz} ${cityLabel(tz)} ${offsets.get(tz) ?? ""}`.toLowerCase();
        return haystack.includes(q);
      });
      return [
        systemRow,
        ...matches.map((tz): Row => ({ key: `z:${tz}`, kind: "tz", tz })),
      ];
    }

    // While following system (value null) the device zone is already shown in
    // the Follow-system row's subtitle, so skip the redundant pinned row.
    const pinnedTzs =
      value === null ? [] : Array.from(new Set([effective, deviceTz]));
    const pinned = pinnedTzs.map(
      (tz, i): Row => ({
        key: `p:${tz}`,
        kind: "tz",
        tz,
        pinned: i === 0 ? "current" : "device",
      }),
    );
    const rest = all.filter((tz) => !pinnedTzs.includes(tz));
    return [
      systemRow,
      ...pinned,
      ...rest.map((tz): Row => ({ key: `z:${tz}`, kind: "tz", tz })),
    ];
  }, [all, effective, deviceTz, query]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="bg-popover rounded-t-2xl max-h-[80%]">
            <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
              <Text className="text-base font-semibold text-foreground">
                {t("settings.timezoneTitle")}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color={theme.mutedForeground} />
              </Pressable>
            </View>
            <Text className="px-4 pt-2 text-xs text-muted-foreground">
              {t("settings.timezoneHint")}
            </Text>
            <View className="border-b border-border px-4 py-2">
              <View className="flex-row items-center gap-2 rounded-md border border-border bg-background px-3">
                <Ionicons name="search" size={14} color={theme.mutedForeground} />
                <TextInput
                  className="flex-1 py-2 text-sm text-foreground"
                  placeholder={t("settings.timezoneSearchPlaceholder")}
                  placeholderTextColor={theme.mutedForeground}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            </View>
            <FlatList
              data={rows}
              keyExtractor={(row) => row.key}
              className="max-h-96"
              contentContainerClassName="pb-4"
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                if (item.kind === "system") {
                  const selected = value === null;
                  return (
                    <Pressable
                      onPress={() => onSelect(null)}
                      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
                    >
                      <Ionicons
                        name="phone-portrait-outline"
                        size={16}
                        color={selected ? theme.primary : theme.mutedForeground}
                      />
                      <View className="flex-1">
                        <Text
                          className={cn(
                            "text-base text-foreground",
                            selected && "font-medium",
                          )}
                        >
                          {t("settings.languageSystem")}
                        </Text>
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          {labelOf(deviceTz)}
                        </Text>
                      </View>
                      {selected ? (
                        <Ionicons name="checkmark" size={18} color={theme.primary} />
                      ) : null}
                    </Pressable>
                  );
                }
                const selected = item.tz === value;
                return (
                  <View>
                    {item.pinned ? (
                      <Text className="px-4 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
                        {t(
                          item.pinned === "current"
                            ? "settings.timezoneCurrent"
                            : "settings.timezoneDevice",
                        )}
                      </Text>
                    ) : null}
                    <Pressable
                      onPress={() => onSelect(item.tz)}
                      className={cn(
                        "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                        selected && "bg-secondary/60",
                      )}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={16}
                        color={selected ? theme.primary : theme.mutedForeground}
                      />
                      <Text
                        className={cn(
                          "flex-1 text-base text-foreground",
                          selected && "font-medium",
                        )}
                        numberOfLines={1}
                      >
                        {labelOf(item.tz)}
                      </Text>
                      {selected ? (
                        <Ionicons name="checkmark" size={18} color={theme.primary} />
                      ) : null}
                    </Pressable>
                  </View>
                );
              }}
              ListEmptyComponent={
                query ? (
                  <View className="px-3 py-8 items-center">
                    <Text className="text-sm text-muted-foreground text-center">
                      {t("settings.timezoneEmpty")}
                    </Text>
                  </View>
                ) : null
              }
            />
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}