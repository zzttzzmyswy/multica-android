/**
 * Shared label create/edit form. Pushed from two routes:
 *   - more/labels/new     → create mode (no `label` prop)
 *   - more/labels/[id]    → edit mode (`label` prop); delete lives here
 *
 * Fields follow the web editor (`packages/views/settings/components/
 * labels-tab.tsx`): name (required, ≤32 chars — server-enforced), color
 * (preset swatches, default `LABEL_COLOR_PRESETS[6]`), description
 * (optional). The color palette is copied verbatim from web's
 * COLOR_PICKER_PRESETS so both clients offer the same catalog.
 *
 * Delete uses a native Alert.confirm before calling useDeleteLabel — the
 * server already treats deletion as destructive (drops every issue/agent/
 * skill assignment atomically), so the confirm copy says so.
 */
import { useCallback, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Label } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { TextField } from "@/components/ui/text-field";
import {
  useCreateLabel,
  useDeleteLabel,
  useUpdateLabel,
} from "@/data/mutations/labels";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Mirrors web `COLOR_PICKER_PRESETS` (packages/views/common/color-picker.tsx)
// so mobile reuses the same catalog. Default for new labels is index 6 —
// the same default the web editor uses.
export const LABEL_COLOR_PRESETS = [
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
] as const;

export const DEFAULT_LABEL_COLOR = LABEL_COLOR_PRESETS[6];

const MAX_NAME_LENGTH = 32;

function FieldLabel({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons
        name={icon}
        size={13}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {text}
      </Text>
    </View>
  );
}

function FieldError({ text }: { text: string }) {
  return <Text className="text-xs text-destructive">{text}</Text>;
}

export function LabelForm({ label }: { label?: Label | null }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const editing = !!label;
  const [name, setName] = useState(label?.name ?? "");
  const [description, setDescription] = useState(label?.description ?? "");
  const [color, setColor] = useState(label?.color ?? DEFAULT_LABEL_COLOR);
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreateLabel();
  const update = useUpdateLabel();
  const remove = useDeleteLabel();

  const nameMissing = name.trim().length === 0;
  const isSubmitting = create.isPending || update.isPending || remove.isPending;

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (nameMissing) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    // Send the trimmed description even when empty — the server treats an
    // omitted description field as "keep unchanged", so an explicit empty
    // string is what clears it (mirrors web's editor payload).
    const body = {
      name: name.trim(),
      description: description.trim(),
      color,
    };
    try {
      if (editing && label) {
        await update.mutateAsync({ id: label.id, ...body });
      } else {
        await create.mutateAsync(body);
      }
      router.back();
    } catch (err) {
      Alert.alert(
        editing ? t("labels.saveFailed") : t("labels.createdFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  }, [
    isSubmitting,
    nameMissing,
    editing,
    label,
    name,
    description,
    color,
    update,
    create,
    t,
  ]);

  const handleDelete = useCallback(() => {
    if (!label || remove.isPending) return;
    Alert.alert(t("labels.deleteTitle"), t("labels.deleteMessage", {
      name: label.name,
      count: label.usage_count ?? 0,
    }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("labels.delete"),
        style: "destructive",
        onPress: () => {
          remove.mutate(label.id, {
            onSuccess: () => router.back(),
            onError: (err) =>
              Alert.alert(
                t("labels.deleteFailed"),
                err instanceof Error ? err.message : t("common.unknownError"),
              ),
          });
        },
      },
    ]);
  }, [label, remove, t]);

  const headerRight = useCallback(
    () => (
      <Button size="sm" disabled={isSubmitting} onPress={() => void handleSubmit()}>
        <Text>
          {isSubmitting
            ? t("labels.form.saving")
            : editing
              ? t("labels.form.save")
              : t("labels.form.create")}
        </Text>
      </Button>
    ),
    [isSubmitting, editing, handleSubmit, t],
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-10 gap-5"
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View className="gap-1.5">
            <FieldLabel icon="pricetag-outline" text={t("labels.form.name")} />
            <TextField
              value={name}
              onChangeText={setName}
              placeholder={t("labels.form.namePlaceholder")}
              invalid={showErrors && nameMissing}
              editable={!isSubmitting}
              maxLength={MAX_NAME_LENGTH}
              autoFocus
            />
            {showErrors && nameMissing ? (
              <FieldError text={t("labels.form.nameRequired")} />
            ) : null}
          </View>

          {/* Color */}
          <View className="gap-1.5">
            <FieldLabel icon="color-palette-outline" text={t("labels.form.color")} />
            <View className="flex-row flex-wrap gap-3 pt-1">
              {LABEL_COLOR_PRESETS.map((preset) => {
                const selected = preset === color;
                return (
                  <Pressable
                    key={preset}
                    onPress={() => setColor(preset)}
                    disabled={isSubmitting}
                    accessibilityLabel={preset}
                    accessibilityState={{ selected }}
                    className={cn(
                      "size-9 rounded-full items-center justify-center border",
                      selected
                        ? "border-foreground scale-110"
                        : "border-foreground/15",
                    )}
                    style={{ backgroundColor: preset }}
                  />
                );
              })}
            </View>
            <Text className="text-xs text-muted-foreground/70">{color}</Text>
          </View>

          {/* Description */}
          <View className="gap-1.5">
            <FieldLabel
              icon="document-text-outline"
              text={t("labels.form.description")}
            />
            <AutosizeTextArea
              value={description}
              onChangeText={setDescription}
              placeholder={t("labels.form.descriptionPlaceholder")}
              editable={!isSubmitting}
              className="border border-border rounded-md px-3 py-2 min-h-[72px]"
            />
          </View>

          {/* Delete (edit mode only) */}
          {editing && label ? (
            <Pressable
              onPress={handleDelete}
              disabled={remove.isPending}
              className="mt-6 flex-row items-center justify-center gap-2 rounded-md border border-destructive/40 px-3 py-3 active:bg-destructive/10"
              accessibilityLabel={t("labels.delete")}
            >
              <Ionicons name="trash-outline" size={17} color={THEME[colorScheme].destructive} />
              <Text className="text-sm font-medium text-destructive">
                {t("labels.delete")}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}