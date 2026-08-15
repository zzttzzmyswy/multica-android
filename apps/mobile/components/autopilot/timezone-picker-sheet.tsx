/**
 * Timezone picker sheet for the autopilot schedule form. Curated IANA list
 * (mirror of web's COMMON_TIMEZONES fallback) with the current device zone
 * and the currently selected value pinned to the top, so the common choices
 * are one tap away without depending on `Intl.supportedValuesOf` (which
 * some runtimes lack). The full IANA zone list is rejected in favour of a
 * curated one on purpose: an unbounded tzdata dump scrolls past usefulness
 * on a phone, and the schedule editor needs a deliberately small list.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { COMMON_TIMEZONES, browserTimezone } from "@/lib/autopilot-trigger-form";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";

interface Props {
  visible: boolean;
  value: string;
  onPick: (tz: string) => void;
  onClose: () => void;
}

function cityLabel(tz: string): string {
  if (tz === "UTC") return "UTC";
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

export function TimezonePickerSheet({
  visible,
  value,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const deviceTz = browserTimezone();
  const zones = Array.from(
    new Set(
      [value, deviceTz, ...COMMON_TIMEZONES].filter(
        (z): z is string => typeof z === "string" && z.length > 0,
      ),
    ),
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("autopilots.trigger.timezone")}
                </Text>
              </View>
              <ScrollView className="max-h-96">
                {zones.map((tz) => {
                  const selected = tz === value;
                  return (
                    <Pressable
                      key={tz}
                      onPress={() => {
                        onPick(tz);
                        onClose();
                      }}
                      className={cn(
                        "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                        selected && "bg-secondary/60",
                      )}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={16}
                        color={selected ? "#0ea5e9" : undefined}
                      />
                      <Text
                        className={cn(
                          "flex-1 text-sm text-foreground",
                          selected && "font-medium",
                        )}
                      >
                        {cityLabel(tz)}
                      </Text>
                      <Text className="text-xs text-muted-foreground font-mono">
                        {tz}
                      </Text>
                      {selected ? (
                        <Ionicons name="checkmark" size={16} color="#0ea5e9" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}