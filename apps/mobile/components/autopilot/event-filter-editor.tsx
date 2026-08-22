/**
 * Event-filter editor for webhook triggers — mobile mirror of web
 * `packages/views/autopilots/components/webhook-event-filter-section.tsx`:
 * a free-text "event" input + comma-separated "actions" input, with the
 * assembled `{event, actions?}` filters shown as removable chips.
 *
 * Fully controlled — the parent owns the filters array and ships it to the
 * create/update mutation (web's `WebhookEventFilterSection` contract). The
 * add button is disabled until the event field is non-blank (web disables on
 * `!newEvent.trim()`).
 */
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { WebhookEventFilter } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import {
  buildEventFilter,
  canAddFilter,
} from "@/lib/autopilot-event-filter";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Props {
  filters: WebhookEventFilter[];
  onChange: (next: WebhookEventFilter[]) => void;
  editable: boolean;
}

export function EventFilterEditor({ filters, onChange, editable }: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [event, setEvent] = useState("");
  const [actions, setActions] = useState("");

  const add = () => {
    const next = buildEventFilter(event, actions);
    if (!next) return;
    onChange([...filters, next]);
    setEvent("");
    setActions("");
  };

  const removeFilter = (idx: number) => {
    onChange(filters.filter((_, i) => i !== idx));
  };

  const canAdd = canAddFilter(event);

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name="funnel-outline" size={13} color={theme.mutedForeground} />
        <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("autopilots.eventFilter.label")}
        </Text>
      </View>

      {filters.length > 0 ? (
        <View className="gap-1">
          {filters.map((f, idx) => (
            <View
              key={idx}
              className="flex-row items-center gap-2 rounded-md border border-border bg-secondary/60 px-2.5 py-1.5"
            >
              <Text className="text-xs font-medium text-foreground font-mono">
                {f.event}
              </Text>
              {f.actions && f.actions.length > 0 ? (
                <Text className="text-xs text-muted-foreground">
                  : {f.actions.join(", ")}
                </Text>
              ) : null}
              {editable ? (
                <Pressable
                  onPress={() => removeFilter(idx)}
                  hitSlop={8}
                  accessibilityLabel={t("autopilots.eventFilter.remove")}
                  className="ml-auto p-0.5"
                >
                  <Ionicons name="close" size={14} color={theme.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {editable ? (
        <View className="flex-row items-center gap-2">
          <TextInput
            value={event}
            onChangeText={setEvent}
            onSubmitEditing={add}
            placeholder={t("autopilots.eventFilter.eventPlaceholder")}
            placeholderTextColor={theme.mutedForeground}
            editable={editable}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground"
          />
          <TextInput
            value={actions}
            onChangeText={setActions}
            onSubmitEditing={add}
            placeholder={t("autopilots.eventFilter.actionsPlaceholder")}
            placeholderTextColor={theme.mutedForeground}
            editable={editable}
            autoCapitalize="none"
            autoCorrect={false}
            className="w-32 rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground"
          />
          <Pressable
            onPress={add}
            disabled={!canAdd}
            accessibilityLabel={t("autopilots.eventFilter.add")}
            className={cn(
              "items-center justify-center rounded-md border border-border px-2.5 py-2",
              canAdd ? "bg-secondary/70" : "opacity-40",
            )}
          >
            <Ionicons name="add" size={15} color={theme.foreground} />
          </Pressable>
        </View>
      ) : null}

      <Text className="text-[11px] leading-tight text-muted-foreground/80">
        {t("autopilots.eventFilter.hint")}
      </Text>
    </View>
  );
}