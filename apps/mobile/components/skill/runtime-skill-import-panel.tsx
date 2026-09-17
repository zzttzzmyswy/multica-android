/**
 * Runtime-local skill import (mobile counterpart of web's
 * runtime-local-skill-import-panel.tsx).
 *
 * Lists the skills installed on one of the user's LOCAL runtimes and copies a
 * multi-selection of them into the workspace. Differences from web, all
 * deliberate:
 *   - No conflict-resolution wizard. Web can rename/overwrite/skip per
 *     conflict inside a modal; a phone screen has no room for it. Mobile
 *     imports with `supports_conflict: false` semantics instead — the server
 *     reports the collision and the row lands in the "needs attention" list,
 *     where the fix is to import it under a different name from the workspace
 *     list. Nothing is silently overwritten.
 *   - Per-skill outcome rows instead of a progress log: the daemon can take
 *     minutes for a large batch, and the summary is what the user acts on.
 *
 * Selection maths lives in `lib/skill-import.ts` so it is unit-testable
 * without a device.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { RuntimeLocalSkillSummary } from "@multica/core/types";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { runtimeListOptions } from "@/data/queries/runtimes";
import {
  resolveRuntimeLocalSkillImport,
  runtimeCapabilitiesOptions,
} from "@/data/queries/runtime-local-skills";
import { skillKeys } from "@/data/queries/skills";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { ActionSheet } from "@/lib/action-sheet";
import {
  allSkillKeysSelected,
  isNameConflictError,
  summarizeSkillImportResults,
  toggleSkillKey,
  toggleVisibleSkillKeys,
  type SkillImportOutcome,
  type SkillImportOutcomeRow,
} from "@/lib/skill-import";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * In-flight imports. Matches web's IMPORT_CONCURRENCY, which is pinned to the
 * daemon's `maxLocalSkillImportBatch` — going higher only deepens the pending
 * queue, it does not make the daemon claim faster.
 */
const IMPORT_CONCURRENCY = 10;

type Phase = "idle" | "importing" | "done";

export function RuntimeSkillImportPanel({
  onImported,
}: {
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const queryClient = useQueryClient();

  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  // Only runtimes this user owns can be asked to list their installed
  // skills — another member's machine is not addressable from here.
  const localRuntimes = useMemo(
    () =>
      runtimes.filter(
        (r) => r.runtime_mode === "local" && (userId == null || r.owner_id === userId),
      ),
    [runtimes, userId],
  );

  const [runtimeId, setRuntimeId] = useState("");
  useEffect(() => {
    setRuntimeId((prev) => (prev && localRuntimes.some((r) => r.id === prev) ? prev : localRuntimes[0]?.id ?? ""));
  }, [localRuntimes]);

  const runtime = localRuntimes.find((r) => r.id === runtimeId);
  const online = !!runtime && runtime.status === "online";
  const skillsQuery = useQuery({
    ...runtimeCapabilitiesOptions(online ? runtimeId : null),
  });
  const runtimeSkills: RuntimeLocalSkillSummary[] = useMemo(
    () => skillsQuery.data?.skills ?? [],
    [skillsQuery.data],
  );

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<SkillImportOutcomeRow[]>([]);

  // A different runtime is a different skill set — carrying a selection
  // across would silently import the wrong skills.
  useEffect(() => {
    setSelected(new Set());
    setSearch("");
    setPhase("idle");
    setDone(0);
    setResults([]);
  }, [runtimeId]);

  const visibleSkills = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return runtimeSkills;
    return runtimeSkills.filter((skill) =>
      [skill.name, skill.description, skill.provider, skill.source_path].some(
        (value) => value?.toLowerCase().includes(query) ?? false,
      ),
    );
  }, [runtimeSkills, search]);

  const visibleKeys = useMemo(
    () => visibleSkills.map((skill) => skill.key),
    [visibleSkills],
  );
  const allVisibleSelected = allSkillKeysSelected(selected, visibleKeys);

  const openRuntimePicker = useCallback(() => {
    if (localRuntimes.length <= 1) return;
    const labels = localRuntimes.map((r) => runtimeDisplayLabel(r));
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("skills.runtimeImport.runtimeLabel"),
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
      },
      (index) => {
        if (index === undefined || index < 0 || index >= localRuntimes.length) return;
        setRuntimeId(localRuntimes[index].id);
      },
    );
  }, [localRuntimes, t]);

  const runImport = useCallback(async () => {
    if (phase === "importing" || selected.size === 0 || !runtimeId) return;
    const queue = runtimeSkills.filter((skill) => selected.has(skill.key));
    setPhase("importing");
    setDone(0);
    setResults([]);

    const collected: SkillImportOutcomeRow[] = [];
    let finished = 0;

    // Bounded pool — at most IMPORT_CONCURRENCY requests outstanding.
    const executing = new Set<Promise<void>>();
    for (const skill of queue) {
      const task = (async () => {
        let outcome: SkillImportOutcome = "created";
        let error: string | undefined;
        try {
          // `supports_conflict: false` keeps a name collision from silently
          // overwriting an existing skill; the server returns `conflict`
          // instead and we surface it as "needs attention".
          const res = await resolveRuntimeLocalSkillImport(runtimeId, {
            skill_key: skill.key,
            name: skill.name,
            description: skill.description || undefined,
            supports_conflict: false,
          });
          if (res.status === "conflict") outcome = "skipped";
          else outcome = res.status;
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          // A rejected duplicate comes back as a plain error on backends that
          // do not implement the conflict channel.
          outcome = isNameConflictError(message) ? "skipped" : "failed";
          error = message || t("skills.runtimeImport.failed");
        }
        collected.push({ key: skill.key, name: skill.name, outcome, error });
        finished += 1;
        setDone(finished);
        setResults([...collected]);
      })().then(() => {
        executing.delete(task);
      });
      executing.add(task);
      if (executing.size >= IMPORT_CONCURRENCY) await Promise.race(executing);
    }
    await Promise.all(executing);

    setResults([...collected]);
    setPhase("done");
    if (wsId) {
      void queryClient.invalidateQueries({ queryKey: skillKeys.all(wsId) });
    }
  }, [phase, selected, runtimeId, runtimeSkills, wsId, queryClient, t]);

  const summary = useMemo(() => summarizeSkillImportResults(results), [results]);

  const notice = !runtime
    ? t("skills.runtimeImport.noRuntime")
    : !online
      ? t("skills.runtimeImport.offline")
      : skillsQuery.isLoading
        ? t("skills.runtimeImport.discovering")
        : skillsQuery.isError
          ? t("skills.runtimeImport.loadFailed")
          : skillsQuery.data?.supported !== true
            ? t("skills.runtimeImport.unsupported")
            : null;

  if (phase === "done") {
    return (
      <View className="px-4 pt-4 gap-4">
        <View className="rounded-md border border-border bg-card overflow-hidden">
          {(
            [
              ["summaryCreated", summary.created],
              ["summaryUpdated", summary.updated],
              ["summarySkipped", summary.skipped],
              ["summaryFailed", summary.failed],
            ] as const
          ).map(([key, count], index) => (
            <View
              key={key}
              className={cn(
                "flex-row items-center justify-between px-3 py-2.5",
                index > 0 && "border-t border-border",
              )}
            >
              <Text className="text-sm text-muted-foreground">
                {t(`skills.runtimeImport.${key}`)}
              </Text>
              <Text className="text-sm font-medium text-foreground">{count}</Text>
            </View>
          ))}
        </View>

        {summary.problems.length > 0 ? (
          <View className="gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("skills.runtimeImport.problems")}
            </Text>
            <View className="rounded-md border border-border bg-card overflow-hidden">
              {summary.problems.map((row, index) => (
                <View
                  key={row.key}
                  className={cn(
                    "px-3 py-2.5 gap-0.5",
                    index > 0 && "border-t border-border",
                  )}
                >
                  <Text className="text-sm text-foreground" numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text className="text-[11px] text-muted-foreground leading-4">
                    {row.error || t("skills.runtimeImport.conflict")}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Button onPress={onImported}>
          <Text>{t("skills.runtimeImport.done")}</Text>
        </Button>
      </View>
    );
  }

  const importing = phase === "importing";

  return (
    <View className="px-4 pt-4 gap-4">
      <Text className="text-xs text-muted-foreground leading-4">
        {t("skills.runtimeImport.hint")}
      </Text>

      {localRuntimes.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          disabled={importing || localRuntimes.length <= 1}
          onPress={openRuntimePicker}
          className="flex-row items-center justify-between rounded-md border border-border bg-secondary/50 px-3 py-2.5"
        >
          <View className="min-w-0">
            <Text className="text-[11px] text-muted-foreground">
              {t("skills.runtimeImport.runtimeLabel")}
            </Text>
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {runtime ? runtimeDisplayLabel(runtime) : "—"}
            </Text>
          </View>
          {localRuntimes.length > 1 ? (
            <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
          ) : null}
        </Pressable>
      ) : null}

      {notice ? (
        <View className="flex-row items-center gap-3 py-2">
          {skillsQuery.isLoading ? <ActivityIndicator /> : null}
          <Text className="flex-1 text-xs text-muted-foreground">{notice}</Text>
          {skillsQuery.isError ? (
            <Button
              variant="outline"
              size="sm"
              onPress={() => void skillsQuery.refetch()}
            >
              <Text>{t("skills.runtimeImport.retry")}</Text>
            </Button>
          ) : null}
        </View>
      ) : runtimeSkills.length === 0 ? (
        <Text className="text-xs text-muted-foreground py-2">
          {t("skills.runtimeImport.empty")}
        </Text>
      ) : (
        <>
          <TextField
            value={search}
            onChangeText={setSearch}
            placeholder={t("skills.runtimeImport.searchPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!importing}
          />

          <View className="flex-row items-center justify-between">
            <Pressable
              accessibilityRole="button"
              disabled={importing}
              onPress={() =>
                setSelected((prev) => toggleVisibleSkillKeys(prev, visibleKeys))
              }
              className="flex-row items-center gap-1.5"
            >
              <Ionicons
                name={allVisibleSelected ? "checkbox" : "square-outline"}
                size={16}
                color={allVisibleSelected ? theme.brand : theme.mutedForeground}
              />
              <Text className="text-xs text-muted-foreground">
                {allVisibleSelected
                  ? t("skills.runtimeImport.clearAll")
                  : t("skills.runtimeImport.selectAll")}
              </Text>
            </Pressable>
            <Text className="text-xs text-muted-foreground">
              {t("skills.runtimeImport.selectedCount", { count: selected.size })}
            </Text>
          </View>

          <ScrollView
            className="max-h-[320px] rounded-md border border-border"
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {visibleSkills.length === 0 ? (
              <Text className="px-3 py-3 text-xs text-muted-foreground">
                {t("skills.runtimeImport.searchEmpty")}
              </Text>
            ) : (
              visibleSkills.map((skill, index) => {
                const checked = selected.has(skill.key);
                return (
                  <Pressable
                    key={skill.key}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    disabled={importing}
                    onPress={() =>
                      setSelected((prev) => toggleSkillKey(prev, skill.key))
                    }
                    className={cn(
                      "flex-row items-start gap-3 px-3 py-2.5",
                      index > 0 && "border-t border-border",
                    )}
                  >
                    <Ionicons
                      name={checked ? "checkbox" : "square-outline"}
                      size={16}
                      color={checked ? theme.brand : theme.mutedForeground}
                    />
                    <View className="flex-1 min-w-0 gap-0.5">
                      <Text
                        className="text-sm text-foreground"
                        numberOfLines={1}
                      >
                        {skill.name}
                      </Text>
                      {skill.description ? (
                        <Text
                          className="text-[11px] text-muted-foreground leading-4"
                          numberOfLines={2}
                        >
                          {skill.description}
                        </Text>
                      ) : null}
                    </View>
                    <Text className="text-[11px] text-muted-foreground">
                      {t("skills.runtimeImport.fileCount", {
                        count: skill.file_count,
                      })}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Button
            onPress={() => void runImport()}
            disabled={selected.size === 0 || importing}
          >
            <Text>
              {importing
                ? t("skills.runtimeImport.importing", {
                    done,
                    total: selected.size,
                  })
                : t("skills.runtimeImport.import")}
            </Text>
          </Button>
        </>
      )}
    </View>
  );
}
