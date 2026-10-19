/**
 * New project modal. Mirrors `new-issue.tsx` shape — vertical form, header
 * Cancel / Create buttons. Title is required; everything else has a default
 * (status=planned, priority=none, no lead, no description, no icon).
 *
 * Lead, start date and due date ARE exposed here, matching web's
 * create-project dialog, which offers all three as pills
 * (`packages/views/modals/create-project.tsx:538-650` for the lead combobox —
 * members and agents grouped, searchable, with an explicit "no lead" row —
 * and `:637-655` for the two date pickers). An earlier revision of this file
 * asserted the opposite and cited web as its authority; that claim did not
 * survive reading `create-project.tsx`, and believing it made every
 * phone-created project need a second trip into the detail screen to set an
 * owner or a schedule.
 *
 * Status / priority / lead / start date / due date cross-route through
 * `useNewProjectDraftStore` so the formSheet picker routes can read/write
 * them — same pattern as new-issue.tsx + new-issue-picker/*
 * (see new-project-draft-store.ts).
 *
 * On success: dismiss modal → navigate to the new project's detail page so
 * the user can immediately attach issues / resources and configure properties.
 */
import { useCallback, useState } from "react";
import {
  Alert,
  InteractionManager,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { Text } from "@/components/ui/text";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import {
  MIN_BODY_INPUT_HEIGHT_PX,
  MOBILE_PLACEHOLDER_COLOR,
} from "@/components/ui/input-tokens";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ProjectPriorityIcon } from "@/components/ui/project-priority-icon";
import {
  projectPriorityLabel,
  projectStatusLabel,
} from "@/lib/project-status";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { actorNameText } from "@/lib/actor-name-state";
import { useActorLookup } from "@/data/use-actor-name";
import { ISSUE_DATE_SHORT, formatIssueDate } from "@/lib/format-date";
import { useCreateProject } from "@/data/mutations/projects";
import { useNewProjectDraftStore } from "@/data/stores/new-project-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { keyboardBehavior } from "@/lib/keyboard";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";

/**
 * Typed map of new-project picker route pathnames. Keeps `router.push` calls
 * compile-checked rather than depending on free-form template strings —
 * same approach as `create-form-attribute-row.tsx`.
 */
type NewProjectPickerField =
  | "status"
  | "priority"
  | "lead"
  | "start-date"
  | "due-date";
const NEW_PROJECT_PICKER_PATHNAMES = {
  status: "/[workspace]/new-project-picker/status",
  priority: "/[workspace]/new-project-picker/priority",
  lead: "/[workspace]/new-project-picker/lead",
  "start-date": "/[workspace]/new-project-picker/start-date",
  "due-date": "/[workspace]/new-project-picker/due-date",
} as const satisfies Record<NewProjectPickerField, string>;

export default function NewProject() {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const create = useCreateProject();
  const { t } = useTranslation();
  const intlLocale = useIntlLocale();
  const { resolveActorName } = useActorLookup();

  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const status = useNewProjectDraftStore((s) => s.status);
  const priority = useNewProjectDraftStore((s) => s.priority);
  const lead = useNewProjectDraftStore((s) => s.lead);
  const startDate = useNewProjectDraftStore((s) => s.startDate);
  const dueDate = useNewProjectDraftStore((s) => s.dueDate);
  const resetDraft = useNewProjectDraftStore((s) => s.reset);

  const dirty =
    title.length > 0 ||
    icon.length > 0 ||
    description.length > 0 ||
    status !== "planned" ||
    priority !== "none" ||
    lead !== null ||
    startDate !== null ||
    dueDate !== null;

  const canCreate = title.trim().length > 0 && !create.isPending;

  const openPicker = useCallback(
    (field: NewProjectPickerField) => {
      if (!wsSlug) return;
      router.push({
        pathname: NEW_PROJECT_PICKER_PATHNAMES[field],
        params: { workspace: wsSlug },
      });
    },
    [wsSlug],
  );

  const onCancel = useCallback(() => {
    if (!dirty) {
      resetDraft();
      router.back();
      return;
    }
    Alert.alert(
      t("newProject.discardTitle"),
      t("newProject.discardMessage"),
      [
        { text: t("newProject.keepEditing"), style: "cancel" },
        {
          text: t("newProject.discard"),
          style: "destructive",
          onPress: () => {
            resetDraft();
            router.back();
          },
        },
      ],
    );
  }, [dirty, resetDraft, t]);

  const onCreate = useCallback(() => {
    if (!canCreate) return;
    create.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        icon: icon.trim() || undefined,
        status,
        priority,
        // Lead is a PAIR — the server needs `lead_type` to resolve `lead_id`.
        // Omitted entirely (not sent as null) when unset, which is what
        // `CreateProjectRequest`'s optional fields mean.
        ...(lead ? { lead_type: lead.type, lead_id: lead.id } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
      },
      {
        onSuccess: (project) => {
          resetDraft();
          router.back();
          // Wait for the modal dismiss animation to finish before pushing
          // the detail screen. `InteractionManager` resolves once iOS
          // says all in-flight animations / interactions are done — more
          // robust than a hard-coded `setTimeout(150)` if iOS timing
          // changes or the device is under load.
          InteractionManager.runAfterInteractions(() => {
            if (wsSlug) router.push(`/${wsSlug}/project/${project.id}`);
          });
        },
        onError: (err) => {
          Alert.alert(
            t("newProject.failedTitle"),
            err instanceof Error ? err.message : t("newIssue.unknownError"),
          );
        },
      },
    );
  }, [
    canCreate,
    create,
    title,
    description,
    icon,
    status,
    priority,
    // The create-time lead and schedule. Leaving these out would send a
    // payload built from the values captured on the first render — i.e. no
    // lead and no dates, which is exactly the bug this iteration fixes.
    lead,
    startDate,
    dueDate,
    wsSlug,
    resetDraft,
    t,
  ]);

  const headerLeft = useCallback(() => {
    return (
      <Pressable onPress={onCancel} className="px-1 py-1">
        <Text className="text-title-sm text-brand">{t("newProject.cancel")}</Text>
      </Pressable>
    );
  }, [onCancel, t]);

  const headerRight = useCallback(() => {
    return (
      <Pressable
        onPress={onCreate}
        disabled={!canCreate}
        className={canCreate ? "px-1 py-1" : "px-1 py-1 opacity-40"}
      >
        <Text className="text-title-sm text-brand font-semibold">
          {create.isPending ? t("newProject.creating") : t("newProject.create")}
        </Text>
      </Pressable>
    );
  }, [canCreate, onCreate, create.isPending, t]);

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
          <Field label={t("newProject.icon")}>
            <TextInput
              value={icon}
              onChangeText={(v) => setIcon(v.slice(0, 4))}
              placeholder="📦"
              placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
              className="text-display-sm text-foreground bg-secondary/50 rounded-md px-3 py-2 self-start min-w-[60px] text-center"
              maxLength={4}
            />
          </Field>

          <Field label={t("newProject.title")}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t("newProject.titlePlaceholder")}
              placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
              className="text-title-sm text-foreground bg-secondary/50 rounded-md px-3 py-2"
              autoFocus
              returnKeyType="next"
            />
          </Field>

          <Field label={t("newProject.description")}>
            <AutosizeTextArea
              value={description}
              onChangeText={setDescription}
              placeholder={t("newProject.descriptionPlaceholder")}
              className="bg-secondary/50 rounded-md px-3 py-2"
              minHeight={MIN_BODY_INPUT_HEIGHT_PX}
            />
          </Field>

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Field label={t("newProject.status")}>
                <Pressable
                  onPress={() => openPicker("status")}
                  className="flex-row items-center gap-2 bg-secondary/50 rounded-md px-3 py-2.5"
                >
                  <ProjectStatusIcon status={status} size={16} />
                  <Text className="text-body text-foreground flex-1">
                    {projectStatusLabel(status)}
                  </Text>
                </Pressable>
              </Field>
            </View>
            <View className="flex-1">
              <Field label={t("newProject.priority")}>
                <Pressable
                  onPress={() => openPicker("priority")}
                  className="flex-row items-center gap-2 bg-secondary/50 rounded-md px-3 py-2.5"
                >
                  <ProjectPriorityIcon priority={priority} size={16} />
                  <Text className="text-body text-foreground flex-1">
                    {projectPriorityLabel(priority)}
                  </Text>
                </Pressable>
              </Field>
            </View>
          </View>

          {/* Lead — web's create-project lead combobox (`:538-650`), reduced to
              a row that opens the same picker body the detail screen uses. The
              label reads the resolved actor name when the directory can name
              it; while the directory is unread it shows the neutral
              "no lead" wording rather than asserting a name it cannot verify
              (the 254-257 read-readiness rule). An actor the user just picked
              in THIS session is always nameable — the picker only offers rows
              it read — so the common path shows the real name. */}
          <Field label={t("newProject.lead")}>
            <Pressable
              onPress={() => openPicker("lead")}
              className="flex-row items-center gap-2 bg-secondary/50 rounded-md px-3 py-2.5"
            >
              {lead ? (
                <ActorAvatar type={lead.type} id={lead.id} size={20} />
              ) : (
                <Ionicons
                  name="person-outline"
                  size={16}
                  color={MOBILE_PLACEHOLDER_COLOR}
                />
              )}
              <Text
                className="text-body text-foreground flex-1"
                numberOfLines={1}
              >
                {lead
                  ? actorNameText(resolveActorName(lead.type, lead.id)) ||
                    t("newProject.leadPicked")
                  : t("newProject.noLead")}
              </Text>
            </Pressable>
          </Field>

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Field label={t("newProject.startDate")}>
                <Pressable
                  onPress={() => openPicker("start-date")}
                  className="flex-row items-center gap-2 bg-secondary/50 rounded-md px-3 py-2.5"
                >
                  <Ionicons
                    name="calendar-outline"
                    size={16}
                    color={MOBILE_PLACEHOLDER_COLOR}
                  />
                  <Text
                    className={
                      startDate
                        ? "text-body text-foreground flex-1"
                        : "text-body text-muted-foreground flex-1"
                    }
                    numberOfLines={1}
                  >
                    {startDate
                      ? formatIssueDate(startDate, ISSUE_DATE_SHORT, intlLocale)
                      : t("newProject.noStartDate")}
                  </Text>
                </Pressable>
              </Field>
            </View>
            <View className="flex-1">
              <Field label={t("newProject.dueDate")}>
                <Pressable
                  onPress={() => openPicker("due-date")}
                  className="flex-row items-center gap-2 bg-secondary/50 rounded-md px-3 py-2.5"
                >
                  <Ionicons
                    name="calendar-outline"
                    size={16}
                    color={MOBILE_PLACEHOLDER_COLOR}
                  />
                  <Text
                    className={
                      dueDate
                        ? "text-body text-foreground flex-1"
                        : "text-body text-muted-foreground flex-1"
                    }
                    numberOfLines={1}
                  >
                    {dueDate
                      ? formatIssueDate(dueDate, ISSUE_DATE_SHORT, intlLocale)
                      : t("newProject.noDueDate")}
                  </Text>
                </Pressable>
              </Field>
            </View>
          </View>
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
