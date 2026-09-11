/**
 * Agent detail Skills section (web skills-tab parity, MYS-1020). Two blocks
 * mirroring `packages/views/agents/components/tabs/skills-tab.tsx`:
 *
 *  - Assigned workspace skills: toggle (temporary off without removing),
 *    remove (confirm), add via a multi-select sheet that hides skills the
 *    agent already has.
 *  - Inherited runtime-local skills: discovered from the agent's ONLINE local
 *    runtime (polling discovery), toggleable only when the daemon supports
 *    per-agent disablement; offline/missing runtimes show a notice instead.
 *
 * Every write invalidates the agent list caches (mutations own that), so the
 * section re-renders from the workspace agent list the detail screen reads.
 * Archived agents render no section at all (retired agents can't run).
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type {
  Agent,
  AgentRuntime,
  DisabledRuntimeSkill,
  RuntimeLocalSkillSummary,
  SkillSummary,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { skillListOptions } from "@/data/queries/skills";
import {
  runtimeCapabilitiesOptions,
  isRuntimeSkillDisabled,
  runtimeSkillIdentity,
} from "@/data/queries/runtime-local-skills";
import {
  useAddAgentSkills,
  useRemoveAgentSkill,
  useSetAgentRuntimeSkillEnabled,
  useSetAgentSkillEnabled,
} from "@/data/mutations/agents";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function AgentSkillsSection({
  agent,
  runtime,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
}) {
  const wsId = agent.workspace_id || "";
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data: workspaceSkills = [] } = useQuery(skillListOptions(wsId));
  const runtimeId =
    runtime?.runtime_mode === "local" && runtime.status === "online"
      ? runtime.id
      : null;
  const runtimeQuery = useQuery(runtimeCapabilitiesOptions(runtimeId));

  const [addOpen, setAddOpen] = useState(false);
  const [addSelection, setAddSelection] = useState<Set<string>>(new Set());

  const addSkills = useAddAgentSkills(agent.id);
  const setEnabled = useSetAgentSkillEnabled(agent.id);
  const removeSkill = useRemoveAgentSkill(agent.id);
  const setRuntimeEnabled = useSetAgentRuntimeSkillEnabled(agent.id);

  const attachedIds = useMemo(
    () => new Set(agent.skills.map((s) => s.id)),
    [agent.skills],
  );
  const availableSkills = useMemo(
    () => workspaceSkills.filter((s) => !attachedIds.has(s.id)),
    [workspaceSkills, attachedIds],
  );
  const addRows = useMemo(
    () =>
      availableSkills.map((skill: SkillSummary) => ({
        key: skill.id,
        title: skill.name,
        subtitle: skill.description || undefined,
      })),
    [availableSkills],
  );

  const busy =
    addSkills.isPending ||
    setEnabled.isPending ||
    removeSkill.isPending ||
    setRuntimeEnabled.isPending;

  const runtimeSkills: RuntimeLocalSkillSummary[] = runtimeQuery.data?.skills ?? [];
  const runtimeNotice = !runtime
    ? t("agents.skills.runtimeMissing")
    : runtime.status !== "online"
      ? t("agents.skills.runtimeOffline")
      : runtimeQuery.isLoading
        ? t("agents.skills.runtimeDiscovering")
        : runtimeQuery.isError
          ? runtimeQuery.error instanceof Error && "status" in runtimeQuery.error && (runtimeQuery.error as { status?: number }).status === 403
            ? t("agents.skills.runtimeForbidden")
            : t("agents.skills.runtimeFailed")
          : runtimeQuery.data?.supported !== true
            ? t("agents.skills.runtimeUnsupported")
            : runtimeSkills.length === 0
              ? t("agents.skills.runtimeEmpty")
              : null;

  const confirmAdd = () => {
    if (addSelection.size === 0) return;
    addSkills.mutate(
      { skill_ids: [...addSelection] },
      {
        onSuccess: () => {
          setAddOpen(false);
          setAddSelection(new Set());
        },
        onError: (err) =>
          Alert.alert(
            t("agents.skills.addFailed"),
            err instanceof Error ? err.message : t("common.unknownError"),
          ),
      },
    );
  };

  const closeAdd = () => {
    if (addSelection.size > 0) {
      confirmAdd();
    } else {
      setAddOpen(false);
    }
  };

  const confirmRemove = (skillId: string, name: string) => {
    Alert.alert(
      t("agents.skills.removeConfirmTitle"),
      t("agents.skills.removeConfirmMessage", { name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("agents.skills.removeAction"),
          style: "destructive",
          onPress: () =>
            removeSkill.mutate(skillId, {
              onError: (err) =>
                Alert.alert(
                  t("agents.skills.removeFailed"),
                  err instanceof Error ? err.message : t("common.unknownError"),
                ),
            }),
        },
      ],
    );
  };

  return (
    <View className="mt-1">
      {/* Assigned workspace skills */}
      <View className="px-4 pt-5 pb-2 flex-row items-center justify-between gap-3">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("agents.skills.assignedTitle")}
        </Text>
        {availableSkills.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onPress={() => setAddOpen(true)}
            disabled={busy}
          >
            <Ionicons name="add" size={14} color={muted} />
            <Text>{t("agents.skills.addAction")}</Text>
          </Button>
        ) : null}
      </View>
      <View className="px-4 gap-2">
        <Text className="text-[11px] text-muted-foreground/80 leading-4">
          {t("agents.skills.assignedHint")}
        </Text>

        {agent.skills.length === 0 ? (
          <Text className="text-xs text-muted-foreground/80 py-1">
            {workspaceSkills.length === 0
              ? t("agents.skills.emptyWorkspace")
              : t("agents.skills.emptyTitle")}
          </Text>
        ) : (
          <View className="overflow-hidden rounded-md border border-border bg-secondary/30">
            {agent.skills.map((skill, index) => {
              const enabled = skill.enabled !== false;
              return (
                <View
                  key={skill.id}
                  className={
                    index > 0
                      ? "border-t border-border px-3 py-2.5 flex-row items-center gap-3"
                      : "px-3 py-2.5 flex-row items-center gap-3"
                  }
                >
                  <Ionicons
                    name="extension-puzzle-outline"
                    size={16}
                    color={enabled ? muted : THEME[colorScheme].mutedForeground}
                  />
                  <View className="flex-1 min-w-0 gap-0.5">
                    <Text
                      className={
                        enabled
                          ? "text-sm font-medium text-foreground"
                          : "text-sm font-medium text-muted-foreground"
                      }
                      numberOfLines={1}
                    >
                      {skill.name}
                    </Text>
                    <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
                      {skill.description || t("agents.skills.noDescription")}
                    </Text>
                  </View>
                  <Switch
                    checked={enabled}
                    disabled={busy}
                    onCheckedChange={(value) =>
                      setEnabled.mutate(
                        { skillId: skill.id, enabled: value },
                        {
                          onError: (err) =>
                            Alert.alert(
                              t("agents.skills.toggleFailed"),
                              err instanceof Error
                                ? err.message
                                : t("common.unknownError"),
                            ),
                        },
                      )
                    }
                    accessibilityLabel={t("agents.skills.toggleAria", { name: skill.name })}
                  />
                  <Pressable
                    onPress={() => confirmRemove(skill.id, skill.name)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t("agents.skills.removeAria", { name: skill.name })}
                    className="p-1"
                  >
                    <Ionicons name="trash-outline" size={16} color={muted} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Inherited runtime-local skills */}
      <View className="px-4 pt-5 pb-2 flex-row items-center justify-between gap-3">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("agents.skills.runtimeTitle")}
        </Text>
        {runtimeId ? (
          <Pressable
            onPress={() => void runtimeQuery.refetch()}
            disabled={runtimeQuery.isFetching}
            accessibilityRole="button"
            accessibilityLabel={t("agents.skills.refreshAction")}
            className="flex-row items-center gap-1 p-1 active:opacity-70"
          >
            <Ionicons
              name="refresh"
              size={14}
              color={muted}
            />
            <Text className="text-xs text-muted-foreground">
              {t("agents.skills.refreshAction")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View className="px-4 gap-2">
        <Text className="text-[11px] text-muted-foreground/80 leading-4" numberOfLines={2}>
          {t("agents.skills.runtimeHint", {
            runtime: runtime ? runtime.name : "Runtime",
          })}
        </Text>
        {runtimeNotice ? (
          <View className="flex-row items-center gap-2 rounded-md border border-dashed border-border px-3 py-3">
            {runtimeQuery.isLoading && runtime ? (
              <ActivityIndicator size="small" color={muted} />
            ) : (
              <Ionicons name="server-outline" size={14} color={muted} />
            )}
            <Text className="flex-1 text-[11px] text-muted-foreground leading-4">
              {runtimeNotice}
            </Text>
          </View>
        ) : (
          <View className="overflow-hidden rounded-md border border-border bg-secondary/30">
            {runtimeSkills.map((skill, index) => {
              const disabled = isRuntimeSkillDisabled(
                agent.disabled_runtime_skills,
                runtimeId ?? undefined,
                skill,
              );
              const toggleable =
                skill.can_disable === true && !!skill.root && !!runtimeId;
              return (
                <View
                  key={runtimeSkillIdentity(skill)}
                  className={
                    index > 0
                      ? "border-t border-border px-3 py-2.5 flex-row items-center gap-3"
                      : "px-3 py-2.5 flex-row items-center gap-3"
                  }
                >
                  <Ionicons
                    name="server-outline"
                    size={16}
                    color={muted}
                  />
                  <View className="flex-1 min-w-0 gap-0.5">
                    <Text
                      className={
                        disabled
                          ? "text-sm font-medium text-muted-foreground"
                          : "text-sm font-medium text-foreground"
                      }
                      numberOfLines={1}
                    >
                      {skill.name}
                    </Text>
                    <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
                      {skill.description || skill.source_path}
                    </Text>
                  </View>
                  {toggleable ? (
                    <Switch
                      checked={!disabled}
                      disabled={busy}
                      onCheckedChange={(value) =>
                        setRuntimeEnabled.mutate(
                          {
                            runtime_id: runtime!.id,
                            root: skill.root!,
                            key: skill.key,
                            name: skill.name,
                            plugin: skill.plugin,
                            enabled: value,
                          },
                          {
                            onError: (err) =>
                              Alert.alert(
                                t("agents.skills.runtimeToggleFailed"),
                                err instanceof Error
                                  ? err.message
                                  : t("common.unknownError"),
                              ),
                          },
                        )
                      }
                      accessibilityLabel={t("agents.skills.runtimeToggleAria", {
                        name: skill.name,
                      })}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <MultiSelectSheet
        visible={addOpen}
        title={t("agents.skills.addDialogTitle")}
        rows={addRows}
        selectedKeys={addSelection}
        emptyText={
          workspaceSkills.length === 0
            ? t("agents.skills.addDialogEmpty")
            : t("agents.skills.addDialogEmptyPartial")
        }
        onToggle={(key) => {
          const next = new Set(addSelection);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          setAddSelection(next);
        }}
        onClose={() => {
          setAddOpen(false);
          if (addSelection.size > 0) confirmAdd();
        }}
      />
    </View>
  );
}
