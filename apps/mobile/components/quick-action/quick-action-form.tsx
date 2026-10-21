/**
 * Shared quick-action create/edit form (iteration-52). Pushed from two routes:
 *   - more/settings/quick-actions/new  → create mode (no `action` prop)
 *   - more/settings/quick-actions/[id] → edit mode (`action` prop); the
 *       archive/restore and delete rows live here
 *
 * Mirrors web QuickActionDialog (quick-actions-tab.tsx): name (required, ≤32
 * chars), visibility (Team / Just me cards — the choice that constrains the
 * rest: a public action may only bind a target everyone can invoke), target
 * (agent or squad picker), and the prompt with a live template-token warning
 * (`findQuickActionTemplateToken`, same value the server rejects with). Save
 * is gated exactly like web (non-empty name + prompt + target, no template
 * token).
 *
 * Payload shapes:
 *   create → POST   /api/quick-actions  { name, assignee_type, assignee_id,
 *                                          prompt, visibility }
 *   update → PATCH  /api/quick-actions/{id}  { name, assignee_type,
 *                                          assignee_id, prompt, visibility }
 */
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  findQuickActionTemplateToken,
  type QuickAction,
  type QuickActionVisibility,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Separator } from "@/components/ui/separator";
import {
  useCreateQuickAction,
  useUpdateQuickAction,
  useDeleteQuickAction,
} from "@/data/mutations/quick-actions";
import { useActorLookup } from "@/data/use-actor-name";
import { selectedActorLabel } from "@/lib/actor-name-state";
import {
  quickActionCanSave,
  quickActionTargetPayload,
} from "@/lib/quick-action-target";
import {
  AgentSquadPickerModal,
  type QuickActionAssignee,
} from "@/components/quick-action/agent-squad-picker-modal";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

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
      <Text className="text-caption font-medium text-muted-foreground uppercase tracking-wide">
        {text}
      </Text>
    </View>
  );
}

function FieldError({ text }: { text: string }) {
  return <Text className="text-caption text-destructive">{text}</Text>;
}

export function QuickActionForm({ action }: { action?: QuickAction | null }) {
  const isEdit = !!action;
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const [name, setName] = useState(action?.name ?? "");
  const [visibility, setVisibility] = useState<QuickActionVisibility>(
    action?.visibility === "private" ? "private" : "public",
  );
  const [assignee, setAssignee] = useState<QuickActionAssignee>(
    action?.assignee_id
      ? {
          type:
            action.assignee_type === "squad" ? "squad" : "agent",
          id: action.assignee_id,
        }
      : null,
  );
  const [prompt, setPrompt] = useState(action?.prompt ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { resolveActorName } = useActorLookup();

  const create = useCreateQuickAction();
  const update = useUpdateQuickAction();
  const remove = useDeleteQuickAction();

  const templateToken = useMemo(
    () => findQuickActionTemplateToken(prompt),
    [prompt],
  );
  const canSave = quickActionCanSave({ name, prompt, templateToken });

  const archived = action?.status === "archived";

  const dialogTitle = isEdit
    ? t("quickActions.editTitle")
    : t("quickActions.createTitle");

  // Both mutations carry their own write-failure title, and the MutationCache
  // outlet reports it — including after this dialog has closed. A `catch` that
  // raises its own Alert would be a second dialog for one failure, so the catch
  // exists only to keep the form open and re-enable Save.
  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const target = quickActionTargetPayload(assignee);
    try {
      if (isEdit && action) {
        await update.mutateAsync({
          id: action.id,
          name: name.trim(),
          ...target,
          prompt,
          visibility,
        });
      } else {
        await create.mutateAsync({
          name: name.trim(),
          ...target,
          prompt,
          visibility,
        });
      }
      router.back();
    } catch {
      // Reported by the hook's write-failure title.
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!action) return;
    try {
      await update.mutateAsync({
        id: action.id,
        status: archived ? "active" : "archived",
      });
      router.back();
    } catch {
      // Reported by the hook's write-failure title.
    }
  };

  const confirmDelete = () => {
    if (!action) return;
    Alert.alert(
      t("quickActions.deleteTitle"),
      t("quickActions.deleteDescription"),
      [
        { text: t("quickActions.cancel"), style: "cancel" },
        {
          text: t("quickActions.delete"),
          style: "destructive",
          onPress: () => {
            remove.mutate(action.id, { onSuccess: () => router.back() });
          },
        },
      ],
    );
  };

  const assigneeRowLabel = () => {
    // "No target" is a choice, not an empty field: the author picked it in the
    // picker, and it saves as `assignee_type: ""`. Printing the "select…"
    // placeholder here would tell them the opposite — that nothing has been
    // decided yet — and they would go looking for the setting they just made.
    if (!assignee) return t("quickActions.noTarget");
    // ECHO: this row shows the form's OWN field — the value it was seeded
    // with, or the one the user just picked in the sheet it opens. A skeleton
    // here would read as "the target was lost", and the create/run action is
    // gated on this value, so the reader needs to see that it is set
    // (MYS-2227).
    return selectedActorLabel({
      state: resolveActorName(assignee.type, assignee.id),
      type: assignee.type,
      fallback: t("filter.assignee"),
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: dialogTitle,
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-4 py-4 gap-5"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1.5">
          <FieldLabel icon="pricetag" text={t("quickActions.fieldName")} />
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={t("quickActions.fieldNamePlaceholder")}
            maxLength={MAX_NAME_LENGTH}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            editable={!saving}
          />
        </View>

        <View className="gap-1.5">
          <FieldLabel icon="people" text={t("quickActions.fieldVisibility")} />
          <View className="flex-row gap-2">
            {(["public", "private"] as const).map((option) => {
              const selected = visibility === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setVisibility(option)}
                  disabled={saving}
                  className={cn(
                    "flex-1 items-start gap-1.5 rounded-lg border px-3 py-2.5",
                    selected
                      ? "border-primary bg-accent/60"
                      : "border-border bg-background",
                  )}
                >
                  <Ionicons
                    name={option === "public" ? "globe-outline" : "lock-closed-outline"}
                    size={14}
                    color={theme.mutedForeground}
                  />
                  <Text className="text-body font-medium text-foreground">
                    {option === "public"
                      ? t("quickActions.visibilityPublic")
                      : t("quickActions.visibilityPrivate")}
                  </Text>
                  <Text className="text-caption text-muted-foreground">
                    {option === "public"
                      ? t("quickActions.visibilityPublicHint")
                      : t("quickActions.visibilityPrivateHint")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-1.5">
          <FieldLabel icon="git-branch-outline" text={t("quickActions.fieldTarget")} />
          <Pressable
            onPress={() => setPickerOpen(true)}
            disabled={saving}
            className="flex-row items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5"
          >
            {assignee ? (
              <ActorAvatar type={assignee.type} id={assignee.id} size={28} showPresence={assignee.type === "agent"} />
            ) : (
              <View className="size-7 rounded-full bg-secondary items-center justify-center">
                <Ionicons name="person" size={15} color={theme.mutedForeground} />
              </View>
            )}
            <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
              {assigneeRowLabel()}
            </Text>
            <Ionicons name="chevron-down" size={14} color={theme.mutedForeground} />
          </Pressable>
          {/* Web's three-way branch, no-target first
              (`quick-actions-tab.tsx`): with no target bound, the sentence that
              matters is what will actually happen — a comment with nobody
              mentioned — not the public-target rule, which has no target to
              constrain. */}
          {!assignee ? (
            <Text className="text-caption text-muted-foreground">
              {t("quickActions.noTargetHint")}
            </Text>
          ) : visibility === "public" ? (
            <Text className="text-caption text-muted-foreground">
              {t("quickActions.publicTargetHint")}
            </Text>
          ) : null}
        </View>

        <View className="gap-1.5">
          <FieldLabel icon="document-text" text={t("quickActions.fieldPrompt")} />
          <View className="rounded-md border border-border bg-background px-3 py-2">
            <AutosizeTextArea
              value={prompt}
              onChangeText={setPrompt}
              placeholder={t("quickActions.fieldPromptPlaceholder")}
              editable={!saving}
              minHeight={48}
              maxHeight={160}
            />
          </View>
          {templateToken !== null ? (
            <FieldError
              text={t("quickActions.templateNotSupported", {
                token: templateToken,
              })}
            />
          ) : (
            <Text className="text-caption text-muted-foreground">
              {t("quickActions.promptHint")}
            </Text>
          )}
        </View>

        <Button onPress={handleSave} disabled={!canSave || saving}>
          <Text>
            {saving ? t("workspaceSettings.saving") : t("quickActions.save")}
          </Text>
        </Button>

        {isEdit && action ? (
          <View className="rounded-md border border-border bg-card overflow-hidden">
            <Pressable
              onPress={handleArchiveToggle}
              disabled={saving}
              className="flex-row items-center gap-3 px-4 py-3.5 active:bg-secondary"
            >
              <Ionicons name="archive-outline" size={16} color={theme.mutedForeground} />
              <Text className="flex-1 text-body text-foreground">
                {archived ? t("quickActions.unarchive") : t("quickActions.archive")}
              </Text>
            </Pressable>
            <Separator />
            <Pressable
              onPress={confirmDelete}
              disabled={saving}
              className="flex-row items-center gap-3 px-4 py-3.5 active:bg-secondary"
            >
              <Ionicons name="trash-outline" size={16} color={theme.destructive} />
              <Text className="flex-1 text-body text-destructive">
                {t("quickActions.delete")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <AgentSquadPickerModal
        visible={pickerOpen}
        value={assignee}
        onChange={(next) => setAssignee(next)}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}