/**
 * Custom runtime profiles management (iteration-82, A2.3) — mobile mirror of
 * web `packages/views/runtimes/components/runtime-profiles-dialog.tsx`.
 *
 * Three surfaces swap inside one full-screen modal:
 *   - browse: the user's custom profiles as editable cards, built-in
 *     protocol families as a collapsed read-only reference section.
 *   - create (2-step): family → details. The family picker is a grid of
 *     chips; the details form validates the pasted command line live and
 *     shows field-level errors (mirroring web's parseCommandLine guards).
 *   - edit (single step): family fixed + locked hint.
 *
 * Delete runs through the server's 409 bounded-agents refusal: the message
 * the server sent is shown verbatim when agents still reference the profile.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { RuntimeProfile, RuntimeProtocolFamily } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ApiError } from "@/data/api";
import {
  runtimeProfileListOptions,
} from "@/data/queries/runtime-profiles";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useCreateRuntimeProfile, useUpdateRuntimeProfile, useDeleteRuntimeProfile } from "@/data/mutations/runtime-profiles";
import { parseRuntimeProfileBoundConflict } from "@/lib/runtime-profile-conflict";
import {
  buildRuntimeCatalog,
  formatCommandLine,
  parseCommandLine,
  PROTOCOL_FAMILIES,
  validateProfileForm,
  type ProfileFormErrorField,
  type ProfileFormValues,
  type RuntimeCatalogEntry,
} from "@/lib/runtime-profile-catalog";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type DialogState =
  | { surface: "browse" }
  | { surface: "form"; mode: "create"; step: "family" | "details" }
  | { surface: "form"; mode: "edit"; profile: RuntimeProfile };

interface Props {
  intent?: "manage" | "create";
  onClose: () => void;
  /** Called with the created profile so callers can navigate to it. */
  onProfileCreated?: (profile: RuntimeProfile) => void;
}

export function RuntimeProfilesDialog({
  intent = "manage",
  onClose,
  onProfileCreated,
}: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: profiles = [], isLoading } = useQuery(
    runtimeProfileListOptions(wsId),
  );

  const [state, setState] = useState<DialogState>(() =>
    intent === "create"
      ? { surface: "form", mode: "create", step: "family" }
      : { surface: "browse" },
  );
  const [draftFamily, setDraftFamily] = useState<RuntimeProtocolFamily>(
    PROTOCOL_FAMILIES[0] ?? "claude",
  );

  const catalog = useMemo(
    () => buildRuntimeCatalog(profiles),
    [profiles],
  );

  const openCreate = () =>
    setState({ surface: "form", mode: "create", step: "family" });

  const handlePickFamily = (family: RuntimeProtocolFamily) => {
    setDraftFamily(family);
    setState({ surface: "form", mode: "create", step: "details" });
  };

  const handleBack = () => {
    if (state.surface === "form" && state.mode === "create" && state.step === "details") {
      setState({ surface: "form", mode: "create", step: "family" });
    } else {
      setState({ surface: "browse" });
    }
  };

  const handleCancel = () => {
    if (intent !== "manage") {
      onClose();
    } else {
      setState({ surface: "browse" });
    }
  };

  const handleSaved = (profile: RuntimeProfile) => {
    if (state.surface === "form" && state.mode === "create") {
      onProfileCreated?.(profile);
    }
    if (intent !== "manage") {
      onClose();
      return;
    }
    setState({ surface: "browse" });
  };

  const title =
    state.surface === "form"
      ? state.mode === "create"
        ? t("runtimes.profiles.form.createTitle")
        : t("runtimes.profiles.form.editTitle")
      : t("runtimes.profiles.dialogTitle");

  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background">
        {/* Header */}
        <View className="border-b border-border px-4 py-3 flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons name="server-outline" size={16} color={muted} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              {title}
            </Text>
          </View>
          <Pressable
            onPress={handleCancel}
            accessibilityLabel={t("runtimes.profiles.deleteDialog.cancel")}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={muted} />
          </Pressable>
        </View>

        {state.surface === "form" ? (
          <ProfileFormView
            mode={state.mode}
            step={state.mode === "create" ? state.step : "details"}
            family={
              state.mode === "edit" ? state.profile.protocol_family : draftFamily
            }
            profile={state.mode === "edit" ? state.profile : null}
            onPickFamily={handlePickFamily}
            onBack={handleBack}
            onCancel={handleCancel}
            onSaved={handleSaved}
          />
        ) : (
          <BrowseView
            catalog={catalog}
            loading={isLoading}
            onAddNew={openCreate}
            onEdit={(profile) =>
              setState({ surface: "form", mode: "edit", profile })
            }
          />
        )}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Browse — custom cards + collapsible built-ins.
// ---------------------------------------------------------------------------

function BrowseView({
  catalog,
  loading,
  onAddNew,
  onEdit,
}: {
  catalog: ReturnType<typeof buildRuntimeCatalog>;
  loading: boolean;
  onAddNew: () => void;
  onEdit: (profile: RuntimeProfile) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const [builtinsOpen, setBuiltinsOpen] = useState(false);
  const hasCustom = catalog.customs.length > 0;

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-4 py-4 gap-4"
    >
      {loading ? (
        <View className="items-center py-12">
          <ActivityIndicator />
        </View>
      ) : (
        <>
          {/* Custom profiles */}
          <View className="gap-2">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("runtimes.profiles.customSectionTitle", {
                count: String(catalog.customs.length),
              })}
            </Text>
            {hasCustom ? (
              catalog.customs.map((entry) =>
                entry.kind === "custom" ? (
                  <CustomCard
                    key={entry.id}
                    entry={entry}
                    onEdit={() => onEdit(entry.profile)}
                  />
                ) : null,
              )
            ) : (
              <View className="items-center rounded-md border border-border bg-secondary/30 px-4 py-6 gap-2">
                <Ionicons name="server-outline" size={22} color={muted} />
                <Text className="text-sm font-medium text-foreground">
                  {t("runtimes.profiles.emptyTitle")}
                </Text>
                <Text className="text-xs text-muted-foreground text-center leading-4">
                  {t("runtimes.profiles.emptyDescription")}
                </Text>
                <Button size="sm" variant="outline" onPress={onAddNew}>
                  <Text>{t("runtimes.profiles.addNew")}</Text>
                </Button>
              </View>
            )}
            {hasCustom ? (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onPress={onAddNew}
              >
                <Ionicons name="add" size={14} color={muted} style={{ marginRight: 4 }} />
                <Text>{t("runtimes.profiles.addNew")}</Text>
              </Button>
            ) : null}
          </View>

          {/* Built-in reference */}
          <View className="rounded-lg border border-border overflow-hidden">
            <Pressable
              onPress={() => setBuiltinsOpen((v) => !v)}
              className="flex-row items-center justify-between gap-2 bg-secondary/30 px-3 py-2.5"
            >
              <View className="flex-1">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("runtimes.profiles.builtinSectionTitle", {
                    count: String(catalog.builtins.length),
                  })}
                </Text>
                <Text className="text-[11px] text-muted-foreground mt-0.5">
                  {t("runtimes.profiles.builtinSectionHint")}
                </Text>
              </View>
              <Ionicons
                name={builtinsOpen ? "chevron-down" : "chevron-forward"}
                size={14}
                color={muted}
              />
            </Pressable>
            {builtinsOpen ? (
              <View className="divide-y divide-border">
                {catalog.builtins.map((entry) => (
                  <View
                    key={entry.id}
                    className="flex-row items-center gap-2 px-3 py-2"
                  >
                    <FamilyBadge family={entry.protocolFamily} />
                    <Text className="flex-1 text-xs text-foreground capitalize">
                      {entry.protocolFamily}
                    </Text>
                    <Text className="text-[10px] text-muted-foreground">
                      {t("runtimes.profiles.badgeBuiltin")}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function CustomCard({
  entry,
  onEdit,
}: {
  entry: Extract<RuntimeCatalogEntry, { kind: "custom" }>;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;
  const profile = entry.profile;
  const commandLine = formatCommandLine(
    profile.command_name,
    profile.fixed_args,
  );
  const deleteProfile = useDeleteRuntimeProfile();

  const onDelete = () => {
    if (deleteProfile.isPending) return;
    const runDelete = () =>
      deleteProfile.mutate(profile.id, {
        onSuccess: () => Alert.alert(t("runtimes.profiles.deleteDialog.deleted")),
        onError: (err) => {
          // A 409 means agents are still bound — show the server's own
          // message verbatim (parseRuntimeProfileBoundConflict).
          const conflict = parseRuntimeProfileBoundConflict(err);
          Alert.alert(
            t("runtimes.profiles.deleteDialog.title"),
            conflict?.message ?? t("runtimes.profiles.deleteDialog.errorGeneric"),
          );
        },
      });
    Alert.alert(
      t("runtimes.profiles.deleteDialog.title"),
      t("runtimes.profiles.deleteDialog.description", {
        name: profile.display_name,
      }),
      [
        { text: t("runtimes.profiles.deleteDialog.cancel"), style: "cancel" },
        {
          text: t("runtimes.profiles.deleteDialog.confirm"),
          style: "destructive",
          onPress: runDelete,
        },
      ],
    );
  };

  return (
    <View className="rounded-lg border border-border px-3 py-2.5 gap-1.5">
      <View className="flex-row items-center gap-2">
        <FamilyBadge family={profile.protocol_family} />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1.5 flex-wrap">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {profile.display_name}
            </Text>
            {!profile.enabled ? (
              <View className="px-1.5 py-px rounded-full bg-warning/10">
                <Text className="text-[10px] text-warning font-medium">
                  {t("runtimes.profiles.badgeDisabled")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="text-[11px] text-muted-foreground capitalize">
            {profile.protocol_family}
          </Text>
        </View>
        <View className="flex-row items-center gap-1 shrink-0">
          <Pressable onPress={onEdit} hitSlop={8} accessibilityLabel={t("runtimes.profiles.edit")}>
            <Ionicons name="pencil-outline" size={15} color={muted} />
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={8} disabled={deleteProfile.isPending} accessibilityLabel={t("runtimes.profiles.delete")}>
            <Ionicons name="trash-outline" size={15} color={theme.destructive} />
          </Pressable>
        </View>
      </View>
      <Text className="font-mono text-[11px] text-foreground" numberOfLines={2}>
        {commandLine}
      </Text>
      {profile.description ? (
        <Text className="text-[11px] text-muted-foreground" numberOfLines={2}>
          {profile.description}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form.
// ---------------------------------------------------------------------------

function ProfileFormView({
  mode,
  step,
  family,
  profile,
  onPickFamily,
  onBack,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  step: "family" | "details";
  family: RuntimeProtocolFamily;
  profile: RuntimeProfile | null;
  onPickFamily: (family: RuntimeProtocolFamily) => void;
  onBack: () => void;
  onCancel: () => void;
  onSaved: (profile: RuntimeProfile) => void;
}) {
  const { t } = useTranslation();

  if (mode === "create" && step === "family") {
    return (
      <>
        <ScrollView className="flex-1" contentContainerClassName="px-4 py-4 gap-3">
          <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("runtimes.profiles.form.stepProgress", { current: "1", total: "2" })}
          </Text>
          <Text className="text-base font-semibold text-foreground">
            {t("runtimes.profiles.form.stepFamilyLabel")}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {t("runtimes.profiles.form.stepFamilyHint")}
          </Text>
          <View className="flex-row flex-wrap gap-2 pt-1">
            {PROTOCOL_FAMILIES.map((option) => (
              <Pressable
                key={option}
                onPress={() => onPickFamily(option)}
                className={cn(
                  "flex-row items-center gap-2 rounded-lg border bg-background px-3 py-2",
                )}
              >
                <FamilyBadge family={option} />
                <Text className="text-xs text-foreground capitalize">{option}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <View className="flex-row justify-end gap-2 border-t border-border px-4 py-3 bg-muted/30">
          <Button variant="outline" size="sm" onPress={onCancel}>
            <Text>{t("runtimes.profiles.form.cancel")}</Text>
          </Button>
        </View>
      </>
    );
  }

  return (
    <ProfileDetailsForm
      mode={mode}
      family={family}
      profile={profile}
      onBack={onBack}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  );
}

function ProfileDetailsForm({
  mode,
  family,
  profile,
  onBack,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  family: RuntimeProtocolFamily;
  profile: RuntimeProfile | null;
  onBack: () => void;
  onCancel: () => void;
  onSaved: (profile: RuntimeProfile) => void;
}) {
  const { t } = useTranslation();
  const createProfile = useCreateRuntimeProfile();
  const updateProfile = useUpdateRuntimeProfile();

  const [values, setValues] = useState<ProfileFormValues>({
    displayName: profile?.display_name ?? "",
    commandLine: profile
      ? formatCommandLine(profile.command_name, profile.fixed_args)
      : "",
    description: profile?.description ?? "",
  });
  const [errors, setErrors] = useState<ProfileFormErrorField[]>([]);
  const [duplicateName, setDuplicateName] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submitting = createProfile.isPending || updateProfile.isPending;

  const parsedCommand = useMemo(
    () => parseCommandLine(values.commandLine),
    [values.commandLine],
  );

  const handleSubmit = () => {
    if (submitting) return;
    setFormError(null);
    setDuplicateName(false);
    const validationErrors = validateProfileForm(values);
    if (!validationErrors.includes("commandLine") && !parsedCommand.ok) {
      validationErrors.push("commandLine");
    }
    setErrors(validationErrors);
    if (validationErrors.length > 0 || !parsedCommand.ok) return;

    const description = values.description.trim();
    const commandName = parsedCommand.commandName;
    const fixedArgs = parsedCommand.fixedArgs;

    if (mode === "create") {
      createProfile.mutate(
        {
          display_name: values.displayName.trim(),
          protocol_family: family,
          command_name: commandName,
          fixed_args: fixedArgs,
          description: description ? description : undefined,
        },
        {
          onSuccess: (created) => {
            Alert.alert(t("runtimes.profiles.created"));
            onSaved(created);
          },
          onError: (err) => {
            if (err instanceof ApiError && err.status === 409) {
              setDuplicateName(true);
              return;
            }
            setFormError(
              err instanceof Error && err.message
                ? err.message
                : t("runtimes.profiles.saveFailed"),
            );
          },
        },
      );
      return;
    }

    if (!profile) return;
    updateProfile.mutate(
      {
        profileId: profile.id,
        patch: {
          display_name: values.displayName.trim(),
          command_name: commandName,
          fixed_args: fixedArgs,
          description: description ? description : null,
        },
      },
      {
        onSuccess: (updated) => {
          Alert.alert(t("runtimes.profiles.updated"));
          onSaved(updated);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setDuplicateName(true);
            return;
          }
          setFormError(
            err instanceof Error && err.message
              ? err.message
              : t("runtimes.profiles.saveFailed"),
          );
        },
      },
    );
  };

  const commandError =
    errors.includes("commandLine") && !values.commandLine.trim()
      ? t("runtimes.profiles.form.errorCommandRequired")
      : errors.includes("commandLine") && !parsedCommand.ok
        ? parseErrorMessage(parsedCommand.error, t)
        : null;

  return (
    <>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="px-4 py-4 gap-4 pb-24"
      >
        {mode === "create" ? (
          <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("runtimes.profiles.form.stepProgress", { current: "2", total: "2" })}
          </Text>
        ) : null}

        {/* Family (locked) */}
        <View className="gap-1.5">
          <Text className="text-xs text-muted-foreground">
            {t("runtimes.profiles.form.familyLabel")}
          </Text>
          <View className="flex-row items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2">
            <FamilyBadge family={family} />
            <Text className="text-sm text-foreground capitalize">{family}</Text>
          </View>
          <Text className="text-[11px] text-muted-foreground">
            {t("runtimes.profiles.form.familyLockedHint")}
          </Text>
        </View>

        {/* Display name */}
        <View className="gap-1.5">
          <Text className="text-xs text-muted-foreground">
            {t("runtimes.profiles.form.displayNameLabel")}
          </Text>
          <TextField
            value={values.displayName}
            onChangeText={(value) =>
              setValues((prev) => ({ ...prev, displayName: value }))
            }
            placeholder={t("runtimes.profiles.form.displayNamePlaceholder")}
            autoCapitalize="words"
            maxLength={80}
          />
          {duplicateName ? (
            <Text className="text-xs text-destructive">
              {t("runtimes.profiles.duplicateName")}
            </Text>
          ) : errors.includes("displayName") ? (
            <Text className="text-xs text-destructive">
              {t("runtimes.profiles.form.errorDisplayNameRequired")}
            </Text>
          ) : null}
        </View>

        {/* Command line */}
        <View className="gap-1.5">
          <Text className="text-xs text-muted-foreground">
            {t("runtimes.profiles.form.commandLabel")}
          </Text>
          <TextField
            value={values.commandLine}
            onChangeText={(value) =>
              setValues((prev) => ({ ...prev, commandLine: value }))
            }
            placeholder={t("runtimes.profiles.form.commandPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          {commandError ? (
            <Text className="text-xs text-destructive">{commandError}</Text>
          ) : parsedCommand.ok ? (
            <Text className="font-mono text-[11px] text-muted-foreground">
              {t("runtimes.profiles.form.commandPreviewExecutable")} {parsedCommand.commandName}
              {parsedCommand.fixedArgs.length > 0
                ? `  ${t("runtimes.profiles.form.commandPreviewArgs")} ${parsedCommand.fixedArgs.join(" ")}`
                : ""}
            </Text>
          ) : null}
        </View>

        {/* Description */}
        <View className="gap-1.5">
          <Text className="text-xs text-muted-foreground">
            {t("runtimes.profiles.form.descriptionLabel")}
          </Text>
          <TextField
            value={values.description}
            onChangeText={(value) =>
              setValues((prev) => ({ ...prev, description: value }))
            }
            placeholder={t("runtimes.profiles.form.descriptionPlaceholder")}
            multiline
            maxLength={500}
          />
        </View>

        {formError ? (
          <Text className="text-xs text-destructive">{formError}</Text>
        ) : null}
      </ScrollView>

      <View className="flex-row justify-between gap-2 border-t border-border px-4 py-3 bg-muted/30">
        <Button variant="ghost" size="sm" onPress={onBack}>
          <Ionicons name="chevron-back" size={14} color="inherit" style={{ marginRight: 4 }} />
          <Text>{t("runtimes.profiles.form.back")}</Text>
        </Button>
        <View className="flex-row gap-2">
          <Button variant="outline" size="sm" onPress={onCancel}>
            <Text>{t("runtimes.profiles.form.cancel")}</Text>
          </Button>
          <Button size="sm" onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : null}
            <Text>
              {mode === "create"
                ? submitting
                  ? t("runtimes.profiles.form.creating")
                  : t("runtimes.profiles.form.create")
                : submitting
                  ? t("runtimes.profiles.form.saving")
                  : t("runtimes.profiles.form.save")}
            </Text>
          </Button>
        </View>
      </View>
    </>
  );
}

function parseErrorMessage(
  error: "empty" | "unclosed_quote" | "trailing_escape" | "shell_syntax" | "shell_expansion",
  t: (key: string) => string,
): string | null {
  switch (error) {
    case "unclosed_quote":
      return t("runtimes.profiles.form.errorUnclosedQuote");
    case "trailing_escape":
      return t("runtimes.profiles.form.errorTrailingEscape");
    case "shell_expansion":
      return t("runtimes.profiles.form.errorShellExpansion");
    case "shell_syntax":
      return t("runtimes.profiles.form.errorShellSyntax");
    case "empty":
      return t("runtimes.profiles.form.errorCommandRequired");
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Small shared bits.
// ---------------------------------------------------------------------------

function FamilyBadge({ family }: { family: string }) {
  return (
    <View className="size-6 rounded-md bg-secondary items-center justify-center shrink-0">
      <Text className="text-[10px] font-semibold text-muted-foreground capitalize">
        {family.slice(0, 3)}
      </Text>
    </View>
  );
}