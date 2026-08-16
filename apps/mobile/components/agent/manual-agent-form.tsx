/**
 * Manual agent form — create (more/agents/new/manual) AND edit
 * (more/agents/[id]/edit) modes. Fields mirror web
 * `packages/views/agents/create/agent-configuration-panel.tsx`, organised in
 * the same four sections (Identity / Behavior / Execution / Access).
 *
 * Create submission uses core's `buildCreateAgentRequest` (draft.ts) → `POST
 * /api/agents`, then pushes the new agent's detail screen. Edit submission
 * uses `buildUpdateAgentRequest` (same draft module) → `PUT /api/agents/{id}`
 * (+ `setAgentSkills` when the skill set changed), then pops back to the
 * detail screen whose list cache the mutations invalidate. The duplicate-name
 * 409 is classified to the name field inline (web use-create-agent-submit);
 * everything else — 400 (description over 255 / runtime missing), network —
 * surfaces as a form-level alert.
 *
 * Edit-mode divergences from create (each documented at its site):
 *  - The seeded draft keeps the agent's own runtime even when it is offline
 *    (an edit must not force a rebind); the gate only requires a selection.
 *  - Access is OWNER-ONLY server-side (MUL-3963): a non-owner admin sees the
 *    radios disabled and the access fields are omitted from the PUT body.
 *  - No autoFocus on the name field (the user landed to make one small change,
 *    not to type).
 *
 * Deliberate mobile divergences (each documented at its site):
 *  - Model / thinking / speed are plain optional text fields. Web loads a
 *    live model catalog from the runtime daemon (model-dropdown.tsx +
 *    packages/core/runtimes/models.ts); mobile v1 keeps the same wire fields
 *    but accepts a typed value, so the runtime's default applies when empty.
 *  - Avatar is emoji-only (same `emoji:` avatar_url format web persists; no
 *    image upload).
 *  - Feedback is a native Alert (no toast infra on mobile — same choice as
 *    more/autopilots/new.tsx).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent } from "@multica/core/types";
import {
  AGENT_DESCRIPTION_MAX_LENGTH,
  EMPTY_AGENT_DRAFT,
  applyDraftModelChange,
  applyDraftRuntimeChange,
  buildCreateAgentRequest,
  buildUpdateAgentRequest,
  seedDraftFromAgent,
  type AgentDraft,
} from "@multica/core/agents";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { AgentEmojiPickerSheet } from "@/components/agent/agent-emoji-picker-sheet";
import { RuntimePickerSheet } from "@/components/agent/runtime-picker-sheet";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { agentCreateGate, classifyAgentCreateError, usableRuntimes } from "@/lib/agent-create";
import { agentEditGate } from "@/lib/agent-edit";
import { formatAvatarEmoji, parseAvatarEmoji } from "@/lib/agent-avatar";
import {
  useCreateAgent,
  useSetAgentSkills,
  useUpdateAgent,
} from "@/data/mutations/agents";
import { memberListOptions } from "@/data/queries/members";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { skillListOptions } from "@/data/queries/skills";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type PermissionScope = AgentDraft["permissionScope"];

const PERMISSION_SCOPES: {
  value: PermissionScope;
  titleKey: string;
  descKey: string;
}[] = [
  { value: "private", titleKey: "agents.new.accessPrivate", descKey: "agents.new.accessPrivateDesc" },
  { value: "workspace", titleKey: "agents.new.accessWorkspace", descKey: "agents.new.accessWorkspaceDesc" },
  { value: "members", titleKey: "agents.new.accessMembers", descKey: "agents.new.accessMembersDesc" },
];

export function ManualAgentForm({ agent }: { agent?: Agent | null }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  // `agent` present → edit mode: seed the draft from the agent (once; the
  // edit page only renders the form with a loaded agent). Create mode starts
  // empty.
  const isEdit = agent != null;
  const [draft, setDraft] = useState<AgentDraft>(() =>
    isEdit ? seedDraftFromAgent(agent) : EMPTY_AGENT_DRAFT,
  );
  const initialSkills = useMemo(
    () => new Set((agent?.skills ?? []).map((skill) => skill.id)),
    [agent],
  );
  // Access fields are owner-only writes (MUL-3963): a non-owner admin edit
  // keeps the agent's grants untouched and the radios disabled.
  const canEditAccess = !isEdit || agent.owner_id === currentUserId;
  const [showErrors, setShowErrors] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [runtimePickerOpen, setRuntimePickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);

  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(
    runtimeListOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: workspaceSkills = [] } = useQuery(skillListOptions(wsId));

  const usable = useMemo(
    () => usableRuntimes(runtimes, currentUserId),
    [runtimes, currentUserId],
  );
  // Edit mode keeps the agent's own runtime selectable even when offline —
  // the picker list is the online+usable set PLUS the current binding (the
  // binding must stay honest and re-choosable; an offline runtime is still
  // the agent's home).
  const pickerRuntimes = useMemo(() => {
    if (!isEdit || !agent?.runtime_id || !draft.runtimeId) return usable;
    if (usable.some((r) => r.id === draft.runtimeId)) return usable;
    const bound = runtimes.find((r) => r.id === draft.runtimeId);
    return bound ? [bound, ...usable] : usable;
  }, [usable, runtimes, isEdit, agent?.runtime_id, draft.runtimeId]);
  const selectedRuntime =
    runtimes.find((r) => r.id === draft.runtimeId) ??
    (isEdit ? pickerRuntimes.find((r) => r.id === draft.runtimeId) ?? null : null);

  // Seeds the picker with the first usable runtime so the CREATE form is
  // submittable without a manual selection — mirrors use-create-agent-form.ts.
  // Edit drafts already carry their runtime binding, so this never fires there.
  useEffect(() => {
    if (draft.runtimeId || usable.length === 0) return;
    setDraft((current) => ({ ...current, runtimeId: usable[0].id }));
  }, [draft.runtimeId, usable]);

  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent(agent?.id ?? "");
  const setSkills = useSetAgentSkills(agent?.id ?? "");
  const gate = isEdit
    ? agentEditGate(draft)
    : agentCreateGate(draft, selectedRuntime, currentUserId);
  const isSubmitting = createAgent.isPending || updateAgent.isPending || setSkills.isPending;
  const canCreate =
    !isSubmitting &&
    !gate.nameMissing &&
    !gate.runtimeMissing &&
    !gate.accessInvalid &&
    !gate.descriptionOverLimit &&
    nameError == null;
  const skillsChanged =
    isEdit && (draft.skillIds.size !== initialSkills.size || ![...draft.skillIds].every((id) => initialSkills.has(id)));

  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const handleRuntimePick = (runtimeId: string) => {
    // Model / thinking / speed are scoped to the runtime they were chosen on
    // (mirror of web's applyDraftRuntimeChange); a switch clears them so the
    // new runtime resolves its own defaults.
    setDraft((current) => applyDraftRuntimeChange(current, runtimeId));
  };

  const handleModelChange = (model: string) => {
    const normalized = model.trim();
    setDraft((current) => applyDraftModelChange(current, normalized));
  };

  const effectiveMembers = useMemo(
    () => members.filter((m) => m.user_id !== currentUserId),
    [members, currentUserId],
  );

  const skillRows = useMemo(
    () =>
      workspaceSkills.map((s) => ({
        key: s.id,
        title: s.name,
        subtitle: s.description || undefined,
      })),
    [workspaceSkills],
  );
  const selectedSkills = workspaceSkills.filter((s) => draft.skillIds.has(s.id));
  const selectedMembers = effectiveMembers.filter((m) =>
    draft.memberIds.has(m.user_id),
  );

  const handleSubmit = useCallback(async () => {
    if (!canCreate) {
      setShowErrors(true);
      if (gate.accessInvalid) {
        Alert.alert(
          t("agents.new.failedTitle"),
          t("agents.new.accessMembersRequired"),
        );
      }
      return;
    }
    setShowErrors(false);
    setNameError(null);
    setFormError(null);
    try {
      if (isEdit && agent) {
        await updateAgent.mutateAsync(
          buildUpdateAgentRequest({
            draft,
            runtimeId: draft.runtimeId,
            includeAccess: canEditAccess,
          }),
        );
        if (skillsChanged) {
          await setSkills.mutateAsync({ skill_ids: [...draft.skillIds] });
        }
        router.back();
      } else {
        const created = await createAgent.mutateAsync(
          buildCreateAgentRequest({
            draft,
            runtimeId: draft.runtimeId,
            template: "mobile-manual",
          }),
        );
        if (wsSlug) router.replace(`/${wsSlug}/more/agents/${created.id}`);
        else router.back();
      }
    } catch (err) {
      const next = classifyAgentCreateError(
        err,
        isEdit ? t("agents.edit.failedMessage") : t("agents.new.failedMessage"),
        t("agents.new.nameConflict"),
      );
      setNameError(next.nameError);
      setFormError(next.formError);
    }
  }, [
    canCreate,
    gate.accessInvalid,
    isEdit,
    agent,
    draft,
    canEditAccess,
    skillsChanged,
    wsSlug,
    createAgent,
    updateAgent,
    setSkills,
    t,
  ]);

  const avatarEmoji = parseAvatarEmoji(draft.avatarUrl);

  return (
    <View className="px-4 pt-4 pb-10 gap-6">
      {/* ---- Identity ---- */}
      <SectionLabel
        icon="person-outline"
        title={t("agents.new.identity")}
        hint={t("agents.new.identityHint")}
      />

      {/* Avatar + name */}
      <View className="flex-row gap-4 items-center">
        <Pressable
          onPress={() => setEmojiPickerOpen(true)}
          accessibilityLabel={t("agents.new.avatarChange")}
          className="bg-secondary rounded-full items-center justify-center border border-border"
          style={{ width: 56, height: 56 }}
        >
          {avatarEmoji ? (
            <Text style={{ fontSize: 28 }}>{avatarEmoji}</Text>
          ) : (
            <Ionicons name="hardware-chip-outline" size={24} color={theme.mutedForeground} />
          )}
        </Pressable>
        <View className="flex-1 gap-1">
          <TextField
            value={draft.name}
            onChangeText={(text) => {
              setNameError(null);
              set("name", text);
            }}
            placeholder={t("agents.new.namePlaceholder")}
            invalid={(showErrors && gate.nameMissing) || !!nameError}
            editable={!isSubmitting}
            maxLength={120}
            autoFocus={!isEdit}
          />
          {nameError ? <FieldError text={nameError} /> : null}
          {showErrors && gate.nameMissing && !nameError ? (
            <FieldError text={t("agents.new.nameRequired")} />
          ) : null}
        </View>
      </View>
      <AgentEmojiPickerSheet
        visible={emojiPickerOpen}
        selected={avatarEmoji}
        onPick={(emoji) => set("avatarUrl", formatAvatarEmoji(emoji))}
        onClose={() => setEmojiPickerOpen(false)}
      />

      {/* Description */}
      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.descriptionLabel")} />
        <AutosizeTextArea
          value={draft.description}
          onChangeText={(text) => set("description", text)}
          placeholder={t("agents.new.descriptionPlaceholder")}
          editable={!isSubmitting}
          maxLength={AGENT_DESCRIPTION_MAX_LENGTH}
          className="border border-border rounded-md px-3 py-2 min-h-[72px]"
        />
        <View className="flex-row justify-end">
          <Text className="text-[11px] text-muted-foreground/70 tabular-nums">
            {[...draft.description].length}/{AGENT_DESCRIPTION_MAX_LENGTH}
          </Text>
        </View>
      </View>

      {/* ---- Behavior ---- */}
      <SectionLabel
        icon="git-branch-outline"
        title={t("agents.new.behavior")}
        hint={t("agents.new.behaviorHint")}
      />

      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.instructionsLabel")} />
        <AutosizeTextArea
          value={draft.instructions}
          onChangeText={(text) => set("instructions", text)}
          placeholder={t("agents.new.instructionsPlaceholder")}
          editable={!isSubmitting}
          className="border border-border rounded-md px-3 py-2 min-h-[120px] font-mono text-sm leading-6"
        />
      </View>

      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.skillsLabel")} />
        <Pressable
          onPress={() => setSkillPickerOpen(true)}
          disabled={isSubmitting}
          accessibilityLabel={t("agents.new.skillsLabel")}
          className="flex-row items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
        >
          <Ionicons name="extension-puzzle-outline" size={16} color={theme.mutedForeground} />
          <Text
            className={cn(
              "flex-1 text-sm",
              selectedSkills.length > 0 ? "text-foreground" : "text-muted-foreground",
            )}
            numberOfLines={1}
          >
            {selectedSkills.length > 0
              ? selectedSkills.map((s) => s.name).join(", ")
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

      {/* ---- Execution ---- */}
      <SectionLabel
        icon="flash-outline"
        title={t("agents.new.execution")}
        hint={t("agents.new.executionHint")}
      />

      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.runtimeLabel")} required />
        <Pressable
          onPress={() => setRuntimePickerOpen(true)}
          disabled={isSubmitting}
          accessibilityLabel={t("agents.new.runtimeLabel")}
          className={cn(
            "flex-row items-center gap-2.5 rounded-md border px-3 py-2.5",
            showErrors && gate.runtimeMissing
              ? "border-destructive/60 bg-destructive/10"
              : "border-border bg-secondary/50",
          )}
        >
          {selectedRuntime ? (
            <>
              <Ionicons
                name={selectedRuntime.runtime_mode === "cloud" ? "cloud" : "hardware-chip"}
                size={16}
                color={theme.mutedForeground}
              />
              <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                {runtimeDisplayLabel(selectedRuntime)}
              </Text>
              {selectedRuntime.visibility !== "public" ? (
                <Text className="text-[10px] text-info">
                  {t("runtimes.visibility.private")}
                </Text>
              ) : null}
            </>
          ) : (
            <Text
              className={cn(
                "flex-1 text-sm",
                showErrors && gate.runtimeMissing
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {runtimesLoading
                ? t("agents.new.runtimesLoading")
                : t("agents.new.runtimePlaceholder")}
            </Text>
          )}
          <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
        </Pressable>
        {showErrors && gate.runtimeMissing ? (
          <FieldError text={t("agents.new.runtimeRequired")} />
        ) : null}
        <RuntimePickerSheet
          visible={runtimePickerOpen}
          runtimes={pickerRuntimes}
          loading={runtimesLoading}
          selectedId={draft.runtimeId}
          onPick={(runtime) => handleRuntimePick(runtime.id)}
          onClose={() => setRuntimePickerOpen(false)}
        />
      </View>

      {/* Model + per-model overrides. Web enumerates the runtime's catalog
          (model-dropdown.tsx); mobile accepts a typed value and clears the
          per-model overrides on change (applyDraftModelChange). */}
      <View className="gap-1.5">
        <FieldLabel text={t("agents.new.modelLabel")} />
        <TextField
          value={draft.model}
          onChangeText={handleModelChange}
          placeholder={t("agents.new.modelPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSubmitting}
        />
        <Text className="text-xs text-muted-foreground/70">
          {t("agents.new.modelHint")}
        </Text>
      </View>

      {draft.model.trim() ? (
        <View className="gap-3">
          <View className="gap-1.5">
            <FieldLabel text={t("agents.new.thinkingLabel")} />
            <TextField
              value={draft.thinkingLevel}
              onChangeText={(text) => set("thinkingLevel", text)}
              placeholder={t("agents.new.thinkingPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
            />
          </View>
          <View className="gap-1.5">
            <FieldLabel text={t("agents.new.speedLabel")} />
            <TextField
              value={draft.serviceTier}
              onChangeText={(text) => set("serviceTier", text)}
              placeholder={t("agents.new.speedPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
            />
          </View>
        </View>
      ) : null}

      {/* ---- Access ---- */}
      <SectionLabel
        icon="lock-closed-outline"
        title={t("agents.new.access")}
        hint={
          isEdit && !canEditAccess
            ? t("agents.edit.accessOwnerOnly")
            : t("agents.new.accessHint")
        }
      />

      <View className="gap-1">
        <RadioGroup
          value={draft.permissionScope}
          onValueChange={(v) => set("permissionScope", v as PermissionScope)}
          disabled={!canEditAccess || isSubmitting}
        >
          {PERMISSION_SCOPES.map((scope) => {
            const active = draft.permissionScope === scope.value;
            return (
              <Pressable
                key={scope.value}
                onPress={() => set("permissionScope", scope.value)}
                disabled={!canEditAccess || isSubmitting}
                className={cn(
                  "flex-row items-center gap-2.5 rounded-md px-2 py-2",
                  active && "bg-secondary",
                )}
              >
                <RadioGroupItem
                  value={scope.value}
                  aria-label={t(scope.titleKey)}
                  disabled={!canEditAccess || isSubmitting}
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
            );
          })}
        </RadioGroup>
      </View>

      {draft.permissionScope === "members" ? (
        <View className="gap-1.5">
          <Pressable
            onPress={() => setMemberPickerOpen(true)}
            disabled={!canEditAccess || isSubmitting}
            accessibilityLabel={t("agents.new.membersLabel")}
            className={cn(
              "flex-row items-center gap-2.5 rounded-md border px-3 py-2.5",
              showErrors && gate.accessInvalid
                ? "border-destructive/60 bg-destructive/10"
                : "border-border bg-secondary/50",
            )}
          >
            <Ionicons name="people-outline" size={16} color={theme.mutedForeground} />
            <Text
              className={cn(
                "flex-1 text-sm",
                selectedMembers.length > 0 ? "text-foreground" : "text-muted-foreground",
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
          {showErrors && gate.accessInvalid ? (
            <FieldError text={t("agents.new.accessMembersRequired")} />
          ) : null}
          <MultiSelectSheet
            visible={memberPickerOpen}
            title={t("agents.new.membersLabel")}
            rows={effectiveMembers.map((m) => ({
              key: m.user_id,
              title: m.name,
            }))}
            selectedKeys={draft.memberIds}
            emptyText={t("agents.new.membersEmpty")}
            leading={(row) => (
              <ActorAvatar type="member" id={row.key} size={32} />
            )}
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

      {/* Submit */}
      {formError ? (
        <View className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5">
          <Text className="text-sm text-destructive">{formError}</Text>
        </View>
      ) : null}

      <Button onPress={() => void handleSubmit()} disabled={isSubmitting}>
        <Text>
          {isSubmitting
            ? isEdit
              ? t("agents.edit.saving")
              : t("agents.new.creating")
            : isEdit
              ? t("agents.edit.save")
              : t("agents.new.create")}
        </Text>
      </Button>
    </View>
  );
}

function SectionLabel({
  icon,
  title,
  hint,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  hint: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name={icon} size={15} color={THEME[colorScheme].mutedForeground} />
        <Text className="text-sm font-semibold text-foreground">{title}</Text>
      </View>
      <Text className="text-xs text-muted-foreground/80">{hint}</Text>
    </View>
  );
}

function FieldLabel({ text, required = false }: { text: string; required?: boolean }) {
  return (
    <View className="flex-row items-center gap-1">
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {text}
      </Text>
      {required ? <Text className="text-destructive">*</Text> : null}
    </View>
  );
}

function FieldError({ text }: { text: string }) {
  return <Text className="text-xs text-destructive">{text}</Text>;
}