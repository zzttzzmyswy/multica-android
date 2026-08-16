/**
 * AI-builder live-draft form (config tab of more/agents/builder/[sessionId]).
 * Mirrors web `agent-configuration-panel.tsx` (compact) for the builder flow:
 * every field is hand-editable, assistant `<agent_draft>` replies back-fill
 * it, and the whole draft autosaves via saveAgentBuilderDraft (the workspace
 * component owns that). The mobile field set is the same four sections the
 * manual form uses — Identity / Behavior / Execution / Access.
 *
 * Mobile v1 divergences (same as manual-agent-form): model is a typed value
 * (no live catalog dropdown), avatar is omitted, and the runtime picker
 * rebinds the live conversation server-side BEFORE the draft reflects it
 * (MUL-5163) — the workspace passes `onRuntimeSwitch` and applies
 * applyDraftRuntimeChange to the result.
 */
import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import type { RuntimeDevice } from "@multica/core/types";
import {
  AGENT_DESCRIPTION_MAX_LENGTH,
  applyDraftModelChange,
  type AgentDraft,
} from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RuntimePickerSheet } from "@/components/agent/runtime-picker-sheet";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

type PermissionScope = AgentDraft["permissionScope"];

interface Props {
  draft: AgentDraft;
  onChange: Dispatch<SetStateAction<AgentDraft>>;
  runtimes: RuntimeDevice[];
  members: { user_id: string; name: string }[];
  workspaceSkills: {
    id: string;
    name: string;
    description: string;
  }[];
  selectedRuntimeId: string;
  currentUserId?: string | null;
  formError: string | null;
  /** Rebinds the live conversation to another runtime (server-side). */
  onRuntimeSwitch: (runtime: RuntimeDevice) => void | Promise<void>;
}

export function BuilderConfigPanel({
  draft,
  onChange,
  runtimes,
  members,
  workspaceSkills,
  selectedRuntimeId,
  currentUserId = null,
  formError,
  onRuntimeSwitch,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [runtimePickerOpen, setRuntimePickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);

  const selectedRuntime =
    runtimes.find((runtime) => runtime.id === selectedRuntimeId) ?? null;

  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    onChange((current) => ({ ...current, [key]: value }));

  const effectiveMembers = useMemo(
    () => members.filter((m) => m.user_id !== currentUserId),
    [members, currentUserId],
  );

  const skillRows = useMemo(
    () =>
      workspaceSkills.map((skill) => ({
        key: skill.id,
        title: skill.name,
        subtitle: skill.description || undefined,
      })),
    [workspaceSkills],
  );
  const selectedSkills = workspaceSkills.filter((skill) =>
    draft.skillIds.has(skill.id),
  );
  const selectedMembers = effectiveMembers.filter((m) =>
    draft.memberIds.has(m.user_id),
  );

  return (
    <View className="gap-5">
      <View className="gap-1">
        <Text className="text-base font-semibold text-foreground">
          {t("agents.new.ai.liveDraft")}
        </Text>
        <Text className="text-xs text-muted-foreground/80">
          {t("agents.new.ai.liveDraftHint")}
        </Text>
      </View>

      {/* Identity */}
      <View className="gap-3">
        <FieldLabel text={t("agents.new.nameLabel")} required />
        <TextField
          value={draft.name}
          onChangeText={(text) => set("name", text)}
          placeholder={t("agents.new.namePlaceholder")}
          maxLength={120}
          autoCapitalize="sentences"
        />
      </View>

      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.descriptionLabel")} />
        <AutosizeTextArea
          value={draft.description}
          onChangeText={(text) => set("description", text)}
          placeholder={t("agents.new.descriptionPlaceholder")}
          maxLength={AGENT_DESCRIPTION_MAX_LENGTH}
          className="border border-border rounded-md px-3 py-2 min-h-[72px]"
        />
        <View className="flex-row justify-end">
          <Text className="text-[11px] text-muted-foreground/70 tabular-nums">
            {[...draft.description].length}/{AGENT_DESCRIPTION_MAX_LENGTH}
          </Text>
        </View>
      </View>

      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.instructionsLabel")} />
        <AutosizeTextArea
          value={draft.instructions}
          onChangeText={(text) => set("instructions", text)}
          placeholder={t("agents.new.instructionsPlaceholder")}
          className="border border-border rounded-md px-3 py-2 min-h-[120px] font-mono text-sm leading-6"
        />
      </View>

      {/* Behavior */}
      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.skillsLabel")} />
        <Pressable
          onPress={() => setSkillPickerOpen(true)}
          accessibilityLabel={t("agents.new.skillsLabel")}
          className="flex-row items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
        >
          <Ionicons
            name="extension-puzzle-outline"
            size={16}
            color={theme.mutedForeground}
          />
          <Text
            className={cn(
              "flex-1 text-sm",
              selectedSkills.length > 0
                ? "text-foreground"
                : "text-muted-foreground",
            )}
            numberOfLines={1}
          >
            {selectedSkills.length > 0
              ? selectedSkills.map((skill) => skill.name).join(", ")
              : t("agents.new.skillsPlaceholder")}
          </Text>
          <Text className="text-xs text-muted-foreground tabular-nums">
            {selectedSkills.length > 0 ? `${selectedSkills.length}` : ""}
          </Text>
          <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
        </Pressable>
        <MultiSelectSheet
          visible={skillPickerOpen}
          title={t("agents.new.skillsLabel")}
          rows={skillRows}
          selectedKeys={draft.skillIds}
          emptyText={t("agents.new.skillsEmpty")}
          onToggle={(id) => {
            const next = new Set(draft.skillIds);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            set("skillIds", next);
          }}
          onClose={() => setSkillPickerOpen(false)}
        />
      </View>

      {/* Execution */}
      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.runtimeLabel")} required />
        <Pressable
          onPress={() => setRuntimePickerOpen(true)}
          accessibilityLabel={t("agents.new.runtimeLabel")}
          className="flex-row items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
        >
          {selectedRuntime ? (
            <>
              <Ionicons
                name={
                  selectedRuntime.runtime_mode === "cloud"
                    ? "cloud"
                    : "hardware-chip"
                }
                size={16}
                color={theme.mutedForeground}
              />
              <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                {runtimeDisplayLabel(selectedRuntime)}
              </Text>
            </>
          ) : (
            <Text className="flex-1 text-sm text-muted-foreground">
              {t("agents.new.runtimePlaceholder")}
            </Text>
          )}
          <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
        </Pressable>
        <Text className="text-[11px] text-muted-foreground/70">
          {t("agents.new.ai.runtimeSwitchHint")}
        </Text>
        <RuntimePickerSheet
          visible={runtimePickerOpen}
          runtimes={runtimes.filter(
            (runtime) =>
              runtime.status === "online" &&
              runtime.id !== selectedRuntimeId,
          )}
          loading={false}
          selectedId={selectedRuntimeId}
          onPick={(runtime) => {
            void onRuntimeSwitch(runtime);
          }}
          onClose={() => setRuntimePickerOpen(false)}
        />
      </View>

      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.modelLabel")} />
        <TextField
          value={draft.model}
          onChangeText={(text) =>
            onChange((current) =>
              applyDraftModelChange({ ...current, model: text.trim() }, text.trim()),
            )
          }
          placeholder={t("agents.new.modelPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text className="text-xs text-muted-foreground/70">
          {t("agents.new.modelHint")}
        </Text>
      </View>

      {/* Access */}
      <View className="gap-1">
        <FieldLabel text={t("agents.new.access")} />
        <RadioGroup
          value={draft.permissionScope}
          onValueChange={(value) => set("permissionScope", value as PermissionScope)}
        >
          {PERMISSION_SCOPES.map((scope) => (
            <Pressable
              key={scope.value}
              onPress={() => set("permissionScope", scope.value)}
              className={cn(
                "flex-row items-center gap-2.5 rounded-md px-2 py-2",
                draft.permissionScope === scope.value && "bg-secondary",
              )}
            >
              <RadioGroupItem
                value={scope.value}
                aria-label={t(scope.titleKey)}
              />
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  {t(scope.titleKey)}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {t(scope.descKey)}
                </Text>
              </View>
            </Pressable>
          ))}
        </RadioGroup>
      </View>

      {draft.permissionScope === "members" ? (
        <View className="gap-1.5">
          <FieldLabel text={t("agents.new.membersLabel")} required />
          <Pressable
            onPress={() => setMemberPickerOpen(true)}
            accessibilityLabel={t("agents.new.membersLabel")}
            className="flex-row items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
          >
            <Ionicons
              name="people-outline"
              size={16}
              color={theme.mutedForeground}
            />
            <Text
              className={cn(
                "flex-1 text-sm",
                selectedMembers.length > 0
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
              numberOfLines={1}
            >
              {selectedMembers.length > 0
                ? selectedMembers.map((m) => m.name).join(", ")
                : t("agents.new.membersPlaceholder")}
            </Text>
            <Text className="text-xs text-muted-foreground tabular-nums">
              {selectedMembers.length > 0 ? `${selectedMembers.length}` : ""}
            </Text>
            <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
          </Pressable>
          <MultiSelectSheet
            visible={memberPickerOpen}
            title={t("agents.new.membersLabel")}
            rows={effectiveMembers.map((m) => ({
              key: m.user_id,
              title: m.name,
            }))}
            selectedKeys={draft.memberIds}
            emptyText={t("agents.new.membersEmpty")}
            leading={(row) => <ActorAvatar type="member" id={row.key} size={32} />}
            onToggle={(id) => {
              const next = new Set(draft.memberIds);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              set("memberIds", next);
            }}
            onClose={() => setMemberPickerOpen(false)}
          />
        </View>
      ) : null}

      {formError ? (
        <View className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5">
          <Text className="text-sm text-destructive">{formError}</Text>
        </View>
      ) : null}
    </View>
  );
}

const PERMISSION_SCOPES: {
  value: PermissionScope;
  titleKey: string;
  descKey: string;
}[] = [
  { value: "private", titleKey: "agents.new.accessPrivate", descKey: "agents.new.accessPrivateDesc" },
  { value: "workspace", titleKey: "agents.new.accessWorkspace", descKey: "agents.new.accessWorkspaceDesc" },
  { value: "members", titleKey: "agents.new.accessMembers", descKey: "agents.new.accessMembersDesc" },
];

function FieldLabel({
  text,
  required = false,
}: {
  text: string;
  required?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {text}
      </Text>
      {required ? <Text className="text-destructive">*</Text> : null}
    </View>
  );
}