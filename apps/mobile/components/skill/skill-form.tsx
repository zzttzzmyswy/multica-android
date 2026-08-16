/**
 * Shared skill create/edit form. Rendered from two surfaces:
 *   - more/skills/new            → create mode (no `skill` prop)
 *   - more/skills/[id] edit sheet → edit mode via the `skill` prop; delete
 *     lives here and is gated by `canDelete` (the detail page passes the
 *     canEdit result so a non-admin owner of someone else's skill never
 *     sees the destructive row).
 *
 * Fields follow web `packages/views/skills/components/create-skill-dialog.tsx`
 * manual-form semantics: name (required), description (optional, multi-line).
 * The server owns the authoritative validation; the form gates submission on
 * a non-empty trimmed name.
 *
 * Submit behaviour diverges from LabelForm (which posts from a header-right
 * button): this form renders its own primary button at the bottom — the
 * mobile editing surface is a bottom sheet here, which has no Stack header
 * to host an action.
 */
import { useCallback, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Skill } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { TextField } from "@/components/ui/text-field";
import {
  useCreateSkill,
  useDeleteSkill,
  useUpdateSkill,
} from "@/data/mutations/skills";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

function FieldError({ text }: { text: string }) {
  return <Text className="text-xs text-destructive">{text}</Text>;
}

export function SkillForm({
  skill,
  canDelete,
  onDone,
}: {
  /** Present → edit mode; absent → create mode. */
  skill?: Skill | null;
  /** Edit-surface gate: when false the destructive delete row is hidden so a
   *  skill the user cannot touch never offers a delete affordance here. */
  canDelete?: boolean;
  /** Called after a successful save/delete (edit sheet closes itself); the
   *  create route falls back to router.back(). */
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const destructive = THEME[colorScheme].destructive;
  const editing = !!skill;

  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreateSkill();
  const update = useUpdateSkill();
  const remove = useDeleteSkill();

  const nameMissing = name.trim().length === 0;
  const isSubmitting = create.isPending || update.isPending || remove.isPending;

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (nameMissing) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    // Trimmed description even when empty — an omitted description field is
    // "keep unchanged" on the server, so an explicit empty string is what
    // clears it.
    const body = { name: name.trim(), description: description.trim() };
    try {
      if (editing && skill) {
        await update.mutateAsync({ id: skill.id, ...body });
      } else {
        await create.mutateAsync(body);
      }
      if (onDone) onDone();
      else router.back();
    } catch (err) {
      Alert.alert(
        editing ? t("skills.saveFailed") : t("skills.createdFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  }, [
    isSubmitting,
    nameMissing,
    editing,
    skill,
    name,
    description,
    update,
    create,
    onDone,
    t,
  ]);

  const handleDelete = useCallback(() => {
    if (!skill || remove.isPending) return;
    Alert.alert(t("skills.deleteTitle"), t("skills.deleteMessage", { name: skill.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("skills.delete"),
        style: "destructive",
        onPress: () => {
          remove.mutate(skill.id, {
            onSuccess: () => {
              if (onDone) onDone();
              else router.back();
            },
            onError: (err) =>
              Alert.alert(
                t("skills.deleteFailed"),
                err instanceof Error ? err.message : t("common.unknownError"),
              ),
          });
        },
      },
    ]);
  }, [skill, remove, onDone, t]);

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={keyboardBehavior}
      keyboardVerticalOffset={keyboardBehavior === "padding" ? 24 : 0}
    >
      <View className="px-4 pt-4 gap-5">
        {/* Name */}
        <View className="gap-1.5">
          <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("skills.form.name")}
          </Text>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={t("skills.form.namePlaceholder")}
            invalid={showErrors && nameMissing}
            editable={!isSubmitting}
            maxLength={120}
            autoFocus={!editing}
          />
          {showErrors && nameMissing ? (
            <FieldError text={t("skills.form.nameRequired")} />
          ) : null}
        </View>

        {/* Description */}
        <View className="gap-1.5">
          <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("skills.form.description")}
          </Text>
          <AutosizeTextArea
            value={description}
            onChangeText={setDescription}
            placeholder={t("skills.form.descriptionPlaceholder")}
            editable={!isSubmitting}
            className="border border-border rounded-md px-3 py-2 min-h-[72px]"
          />
        </View>

        {/* Actions */}
        <Button onPress={() => void handleSubmit()} disabled={isSubmitting}>
          <Text>
            {isSubmitting
              ? t("skills.form.saving")
              : editing
                ? t("skills.form.save")
                : t("skills.form.create")}
          </Text>
        </Button>

        {editing && skill && canDelete ? (
          <Pressable
            onPress={handleDelete}
            disabled={remove.isPending}
            className="flex-row items-center justify-center gap-2 rounded-md border border-destructive/40 px-3 py-3 active:bg-destructive/10"
            accessibilityLabel={t("skills.delete")}
          >
            <Ionicons name="trash-outline" size={17} color={destructive} />
            <Text className="text-sm font-medium text-destructive">
              {t("skills.delete")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}