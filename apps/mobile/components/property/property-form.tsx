/**
 * Shared property create/edit form (MYS-334). Pushed from two routes:
 *   - more/properties/new  → create mode (no `property` prop)
 *   - more/properties/[id] → edit mode (`property` prop); archive/restore
 *     lives here
 *
 * Mirrors web's editor (`packages/views/settings/components/
 * properties-tab.tsx` PropertyEditorDialog): name (required, ≤32 chars),
 * type (locked on edit — server-enforced), description (optional), and a
 * config-only options list for select / multi_select (name + color swatch,
 * ≥1 non-empty option). Option colors come from the same preset catalog web
 * uses (see lib/issue-properties.ts PROPERTY_OPTION_COLOR_PRESETS).
 *
 * Payload shapes:
 *   create → POST /api/properties  { name, type, description, icon, config? }
 *   update → PATCH /api/properties/{id} { name, description, config? }
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
import type {
  IssueProperty,
  IssuePropertyType,
} from "@multica/core/types";
import { ISSUE_PROPERTY_TYPES } from "@multica/core/types";
import {
  useCreateProperty,
  useUpdateProperty,
} from "@/data/mutations/properties";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { TextField } from "@/components/ui/text-field";
import {
  DEFAULT_PROPERTY_OPTION_COLOR,
  isKnownPropertyType,
  PROPERTY_OPTION_COLOR_PRESETS,
  propertyTypeIcon,
  propertyTypeLabelKey,
} from "@/lib/issue-properties";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MAX_NAME_LENGTH = 32;

type OptionDraft = {
  id?: string;
  name: string;
  color: string;
};

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

function propertyHasOptions(type: string): boolean {
  return type === "select" || type === "multi_select";
}

interface PropertyFormProps {
  property?: IssueProperty | null;
}

const EMPTY_OPTION = { name: "", color: "" };

export function PropertyForm({ property }: PropertyFormProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const editing = !!property;

  const [name, setName] = useState(property?.name ?? "");
  const [type, setType] = useState<IssuePropertyType>(
    property && isKnownPropertyType(property.type)
      ? (property.type as IssuePropertyType)
      : "text",
  );
  const [description, setDescription] = useState(property?.description ?? "");
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    property?.config?.options?.length
      ? property.config.options.map((o) => ({
          id: o.id,
          name: o.name,
          color: o.color,
        }))
      : [{ name: "", color: DEFAULT_PROPERTY_OPTION_COLOR }],
  );
  // Which option row has its color palette expanded (null = none).
  const [colorRowOpen, setColorRowOpen] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const showOptions = propertyHasOptions(type);
  const validOptions = options.filter((o) => o.name.trim().length > 0);
  const nameMissing = name.trim().length === 0;
  const optionsMissing = showOptions && validOptions.length === 0;
  const isSubmitting = create.isPending || update.isPending;

  const setOption = (index: number, patch: Partial<OptionDraft>) => {
    setOptions((current) =>
      current.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    );
  };

  const changeType = (next: IssuePropertyType) => {
    setType(next);
    setColorRowOpen(null);
    if (!propertyHasOptions(next)) {
      setOptions([]);
    } else if (options.length === 0) {
      setOptions([{ ...EMPTY_OPTION, color: DEFAULT_PROPERTY_OPTION_COLOR }]);
    }
  };

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    let invalid = nameMissing;
    if (showOptions) invalid = invalid || optionsMissing;
    if (invalid) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const config = showOptions
      ? {
          options: validOptions.map((o) => ({
            // Server assigns ids to new rows; kept-existing ids survive.
            id: o.id ?? "",
            name: o.name.trim(),
            color: o.color,
          })),
        }
      : undefined;
    const common = {
      name: name.trim(),
      description: description.trim(),
      icon: property?.icon ?? "",
      ...(config ? { config } : {}),
    };
    try {
      if (editing && property) {
        await update.mutateAsync({ id: property.id, ...common });
      } else {
        // Type is immovable on edit (server-enforced); only create carries it.
        await create.mutateAsync({ ...common, type });
      }
      router.back();
    } catch (err) {
      Alert.alert(
        editing ? t("properties.saveFailed") : t("properties.createdFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  }, [
    isSubmitting,
    nameMissing,
    showOptions,
    optionsMissing,
    validOptions,
    editing,
    property,
    name,
    description,
    type,
    update,
    create,
    t,
  ]);

  const handleArchiveToggle = useCallback(() => {
    if (!property) return;
    const archived = property.archived;
    Alert.alert(
      archived ? t("properties.restoreTitle") : t("properties.archiveTitle"),
      archived
        ? t("properties.restoreMessage", { name: property.name })
        : t("properties.archiveMessage", { name: property.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: archived ? t("properties.restore") : t("properties.archive"),
          style: archived ? "default" : "destructive",
          onPress: () => {
            update.mutate(
              { id: property.id, archived: !archived },
              {
                onSuccess: () => router.back(),
                onError: (err) =>
                  Alert.alert(
                    t("properties.saveFailed"),
                    err instanceof Error ? err.message : t("common.unknownError"),
                  ),
              },
            );
          },
        },
      ],
    );
  }, [property, update, t]);

  const headerRight = useCallback(
    () => (
      <Button size="sm" disabled={isSubmitting} onPress={() => void handleSubmit()}>
        <Text>
          {isSubmitting
            ? t("properties.form.saving")
            : editing
              ? t("properties.form.save")
              : t("properties.form.create")}
        </Text>
      </Button>
    ),
    [isSubmitting, editing, handleSubmit, t],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: editing ? t("properties.editProperty") : t("properties.newProperty"),
          headerRight,
        }}
      />
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
            <FieldLabel icon="text-outline" text={t("properties.form.name")} />
            <TextField
              value={name}
              onChangeText={setName}
              placeholder={t("properties.form.namePlaceholder")}
              invalid={showErrors && nameMissing}
              editable={!isSubmitting}
              maxLength={MAX_NAME_LENGTH}
              autoFocus
            />
            {showErrors && nameMissing ? (
              <FieldError text={t("properties.form.nameRequired")} />
            ) : null}
          </View>

          {/* Type — locked once created (server-enforced; mirrors web). */}
          <View className="gap-1.5">
            <FieldLabel icon="options-outline" text={t("properties.form.type")} />
            {editing ? (
              <View className="flex-row items-center gap-2 rounded-md border border-border px-3 py-2.5">
                <Ionicons
                  name={propertyTypeIcon(property?.type)}
                  size={16}
                  color={THEME[colorScheme].mutedForeground}
                />
                <Text className="text-sm text-muted-foreground">
                  {t(propertyTypeLabelKey(property?.type))}
                </Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-2 pt-0.5">
                {ISSUE_PROPERTY_TYPES.map((item) => {
                  const selected = item === type;
                  return (
                    <Pressable
                      key={item}
                      onPress={() => changeType(item)}
                      disabled={isSubmitting}
                      accessibilityState={{ selected }}
                      className={cn(
                        "flex-row items-center gap-1.5 rounded-full border px-3 py-1.5",
                        selected
                          ? "border-foreground bg-secondary"
                          : "border-border active:bg-secondary",
                      )}
                    >
                      <Ionicons
                        name={propertyTypeIcon(item)}
                        size={13}
                        color={
                          selected
                            ? THEME[colorScheme].foreground
                            : THEME[colorScheme].mutedForeground
                        }
                      />
                      <Text
                        className={cn(
                          "text-xs font-medium",
                          selected ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {t(propertyTypeLabelKey(item))}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Description */}
          <View className="gap-1.5">
            <FieldLabel
              icon="document-text-outline"
              text={t("properties.form.description")}
            />
            <AutosizeTextArea
              value={description}
              onChangeText={setDescription}
              placeholder={t("properties.form.descriptionPlaceholder")}
              editable={!isSubmitting}
              className="border border-border rounded-md px-3 py-2 min-h-[72px]"
            />
          </View>

          {/* Options — only for select / multi_select */}
          {showOptions ? (
            <View className="gap-1.5">
              <FieldLabel icon="color-palette-outline" text={t("properties.form.options")} />
              <View className="gap-2">
                {options.map((option, index) => (
                  <View key={option.id ?? `new-${index}`} className="gap-1.5">
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        onPress={() =>
                          setColorRowOpen(colorRowOpen === index ? null : index)
                        }
                        disabled={isSubmitting}
                        accessibilityLabel={option.color}
                        className={cn(
                          "size-7 shrink-0 rounded-full border items-center justify-center",
                          colorRowOpen === index
                            ? "border-foreground scale-110"
                            : "border-foreground/15",
                        )}
                        style={{ backgroundColor: option.color }}
                      >
                        {colorRowOpen === index ? (
                          <Ionicons name="close" size={12} color="#ffffff" />
                        ) : null}
                      </Pressable>
                      <TextField
                        value={option.name}
                        onChangeText={(text) => setOption(index, { name: text })}
                        placeholder={t("properties.form.optionNamePlaceholder")}
                        editable={!isSubmitting}
                        maxLength={MAX_NAME_LENGTH}
                        className="h-9 flex-1"
                      />
                      <Pressable
                        onPress={() => {
                          setOptions((current) =>
                            current.filter((_, i) => i !== index),
                          );
                        }}
                        disabled={isSubmitting || options.length <= 1}
                        accessibilityLabel={t("properties.form.removeOption")}
                        className="size-8 items-center justify-center rounded-md active:bg-secondary"
                      >
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={THEME[colorScheme].mutedForeground}
                        />
                      </Pressable>
                    </View>
                    {colorRowOpen === index ? (
                      <View className="flex-row flex-wrap gap-2 pl-9">
                        {PROPERTY_OPTION_COLOR_PRESETS.map((preset) => {
                          const selected = preset === option.color;
                          return (
                            <Pressable
                              key={preset}
                              onPress={() => {
                                setOption(index, { color: preset });
                                setColorRowOpen(null);
                              }}
                              accessibilityLabel={preset}
                              accessibilityState={{ selected }}
                              className={cn(
                                "size-7 rounded-full border items-center justify-center",
                                selected
                                  ? "border-foreground scale-110"
                                  : "border-foreground/15",
                              )}
                              style={{ backgroundColor: preset }}
                            >
                              {selected ? (
                                <Ionicons name="checkmark" size={13} color="#ffffff" />
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
              <Pressable
                onPress={() => {
                  setOptions((current) => [
                    ...current,
                    {
                      name: "",
                      color:
                        PROPERTY_OPTION_COLOR_PRESETS[
                          current.length % PROPERTY_OPTION_COLOR_PRESETS.length
                        ] ?? DEFAULT_PROPERTY_OPTION_COLOR,
                    },
                  ]);
                }}
                disabled={isSubmitting}
                className="flex-row items-center gap-1.5 self-start rounded-md px-2 py-1.5 active:bg-secondary"
                accessibilityLabel={t("properties.form.addOption")}
              >
                <Ionicons name="add" size={15} color={THEME[colorScheme].primary} />
                <Text className="text-sm text-primary">{t("properties.form.addOption")}</Text>
              </Pressable>
              {showErrors && optionsMissing ? (
                <FieldError text={t("properties.form.optionsRequired")} />
              ) : null}
            </View>
          ) : null}

          {/* Archive / restore (edit mode only) */}
          {editing && property ? (
            <Pressable
              onPress={handleArchiveToggle}
              disabled={isSubmitting}
              className={cn(
                "mt-6 flex-row items-center justify-center gap-2 rounded-md border px-3 py-3 active:bg-destructive/10",
                property.archived ? "border-border" : "border-destructive/40",
              )}
              accessibilityLabel={
                property.archived ? t("properties.restore") : t("properties.archive")
              }
            >
              <Ionicons
                name={property.archived ? "archive-outline" : "archive"}
                size={17}
                color={
                  property.archived
                    ? THEME[colorScheme].foreground
                    : THEME[colorScheme].destructive
                }
              />
              <Text
                className={cn(
                  "text-sm font-medium",
                  property.archived ? "text-foreground" : "text-destructive",
                )}
              >
                {property.archived
                  ? t("properties.restore")
                  : t("properties.archive")}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}