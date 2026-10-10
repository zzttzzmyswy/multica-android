/**
 * Edit project title / description / icon. Modal presentation, configured
 * in `[workspace]/_layout.tsx`. Save button in the header runs an
 * optimistic `useUpdateProject`; the modal dismisses on success.
 *
 * Cancel/dismiss flow: header Cancel + iOS drag-down gesture both check
 * dirty state and pop an Alert if there are unsaved edits.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import {
  MIN_BODY_INPUT_HEIGHT_PX,
  MOBILE_PLACEHOLDER_COLOR,
} from "@/components/ui/input-tokens";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import { projectDetailOptions } from "@/data/queries/projects";
import { useUpdateProject } from "@/data/mutations/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { recordRead } from "@/lib/catalog-read";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";

export default function EditProject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const detail = useQuery(projectDetailOptions(wsId, id));
  // "Failed to save" — this screen writes a whole form, so its failure line is
  // the save-specific one rather than the attribute-picker generic.
  const update = useUpdateProject(id, "editProject.failedTitle");

  // `getProject` falls back to EMPTY_PROJECT when the payload shape drifts, and
  // that sentinel carries an empty id — the project detail page treats it as
  // "missing" for the same reason. Resolve through `recordRead` so a *failed*
  // read is told apart from a settled miss: the old code branched on
  // `!detail.data` alone, so a failure left the page on 「加载中…」 forever,
  // with no error and no retry — the only way out was to kill the app
  // (MYS-1910).
  const record = detail.data && detail.data.id !== "" ? detail.data : null;
  const read = recordRead(record, [detail]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [seeded, setSeeded] = useState(false);

  // Seed local state once the record resolves. Effect (not
  // setState-in-render) so we don't accidentally retrigger on every parent
  // re-render — the `seeded` guard makes it idempotent. Seeding from `record`
  // rather than the raw payload keeps the EMPTY_PROJECT sentinel out of the
  // form: seeding from it would mark the page `seeded` with blank fields.
  useEffect(() => {
    if (!record || seeded) return;
    setTitle(record.title);
    setDescription(record.description ?? "");
    setIcon(record.icon ?? "");
    setSeeded(true);
  }, [record, seeded]);

  const dirty = useMemo(() => {
    if (!record) return false;
    return (
      title.trim() !== record.title ||
      description.trim() !== (record.description ?? "") ||
      icon.trim() !== (record.icon ?? "")
    );
  }, [record, title, description, icon]);

  const canSave =
    seeded && !!record && title.trim().length > 0 && dirty && !update.isPending;

  const onCancel = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(
      t("issue.discardTitle"),
      t("issue.discardProjectMessage"),
      [
        { text: t("issue.cancelEditing"), style: "cancel" },
        {
          text: t("issue.discard"),
          style: "destructive",
          onPress: () => router.back(),
        },
      ],
    );
  }, [dirty, t]);

  const onSave = useCallback(() => {
    if (!canSave) return;
    const patch = {
      title: title.trim(),
      description: description.trim() || null,
      icon: icon.trim() || null,
    };
    // Failure title rides on the hook so the MutationCache outlet still fires
    // if this screen has already popped by the time the request rejects.
    update.mutate(patch, { onSuccess: () => router.back() });
  }, [canSave, title, description, icon, update]);

  const headerLeft = useCallback(() => {
    return (
      <Pressable onPress={onCancel} className="px-1 py-1">
        <Text className="text-title-sm text-brand">{t("editProject.cancel")}</Text>
      </Pressable>
    );
  }, [onCancel, t]);

  const headerRight = useCallback(() => {
    return (
      <Pressable
        onPress={onSave}
        disabled={!canSave}
        className={canSave ? "px-1 py-1" : "px-1 py-1 opacity-40"}
      >
        <Text className="text-title-sm text-brand font-semibold">
          {update.isPending ? t("editProject.saving") : t("editProject.save")}
        </Text>
      </Pressable>
    );
  }, [canSave, onSave, update.isPending, t]);

  return (
    <>
      <Stack.Screen options={{ headerLeft, headerRight }} />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-6 gap-4"
          keyboardShouldPersistTaps="handled"
        >
          {!read.isResolved ? (
            <CatalogStatus
              state={read.state}
              onRetry={read.retry}
              errorMessage={`${t("project.loadError")}${
                detail.error instanceof Error ? detail.error.message : ""
              }`}
            />
          ) : !record ? (
            <CatalogStatus
              state="empty"
              onRetry={read.retry}
              emptyMessage={t("project.notFound")}
            />
          ) : (
            <>
              <Field label={t("editProject.icon")}>
                <TextInput
                  value={icon}
                  onChangeText={(v) => {
                    // Cap at two characters — emoji are usually 1-2 UTF-16
                    // code units. Prevents the user typing a full sentence
                    // by accident.
                    setIcon(v.slice(0, 4));
                  }}
                  placeholder="📦"
                  placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                  className="text-display-sm text-foreground bg-secondary/50 rounded-md px-3 py-2 self-start min-w-[60px] text-center"
                  maxLength={4}
                />
              </Field>

              <Field label={t("editProject.title")}>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t("newProject.titlePlaceholder")}
                  placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                  className="text-title-sm text-foreground bg-secondary/50 rounded-md px-3 py-2"
                  autoFocus={!record.title}
                  returnKeyType="next"
                />
              </Field>

              <Field label={t("editProject.description")}>
                <AutosizeTextArea
                  value={description}
                  onChangeText={setDescription}
                  placeholder={t("newProject.descriptionPlaceholder")}
                  className="bg-secondary/50 rounded-md px-3 py-2"
                  minHeight={MIN_BODY_INPUT_HEIGHT_PX}
                />
              </Field>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-caption uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      {children}
    </View>
  );
}

