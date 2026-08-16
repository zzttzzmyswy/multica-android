/**
 * Agent environment variables screen (more/agents/[id]/env). Mirrors web's
 * env-tab.tsx interaction model:
 *
 *  - Values are NEVER fetched on mount — every GET /api/agents/:id/env writes
 *    an `agent_env_revealed` audit row, so revealing must be intentional (web
 *    env-tab keeps the same gate). The header shows only the key count from
 *    the agent resource until the user taps "Reveal & edit".
 *  - Reveal fetches the plaintext `custom_env` into local row state; each row
 *    value renders masked (secureTextEntry) with an eye toggle.
 *  - Save PUTs the whole map back via updateAgentEnv. Unchanged rows send the
 *    server's own value back (no-op); the "****" sentinel rule stays
 *    server-side so a masked round-trip can never clobber a real secret.
 *  - Empty state, duplicate-key guard, add/remove rows mirror env-tab.
 *
 * Divergences from web (documented): no bulk text editor and no env-file
 * paste interception — the row editor covers the acceptance surface and the
 * clipboard formats don't translate to mobile's text events without new
 * platform plumbing. The "KEY=value file" hint text is still shown.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { agentEnvOptions, agentListAllOptions } from "@/data/queries/agents";
import { useUpdateAgentEnv } from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

let nextEnvId = 0;
function freshId() {
  return nextEnvId++;
}

interface EnvEntry {
  id: number;
  key: string;
  value: string;
  visible: boolean;
}

function envMapToEntries(env: Record<string, string>): EnvEntry[] {
  const entries = Object.entries(env).map(([key, value]) => ({
    id: freshId(),
    key,
    value,
    visible: false,
  }));
  return entries.length > 0
    ? entries
    : [{ id: freshId(), key: "", value: "", visible: true }];
}

export default function AgentEnvPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const agents = useQuery(agentListAllOptions(wsId));
  const agent = agents.data?.find((a) => a.id === id);
  const keyCount = agent?.custom_env_key_count ?? 0;

  // null = not revealed yet. Entries are page-local (web env-tab holds the
  // same state): a background refetch must never clobber in-progress edits.
  const [entries, setEntries] = useState<EnvEntry[] | null>(null);
  const [originalMap, setOriginalMap] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState(false);

  const saveEnv = useUpdateAgentEnv(id);

  const handleReveal = useCallback(async () => {
    setRevealing(true);
    try {
      const resp = await qc.fetchQuery(agentEnvOptions(id));
      setOriginalMap(resp.custom_env ?? {});
      setEntries(envMapToEntries(resp.custom_env ?? {}));
    } catch (err) {
      Alert.alert(
        t("agents.env.revealFailedTitle"),
        err instanceof Error && err.message
          ? err.message
          : t("agents.env.revealFailedMessage"),
      );
    } finally {
      setRevealing(false);
    }
  }, [qc, id, t]);

  const updateRow = (index: number, field: "key" | "value", val: string) => {
    setEntries((prev) =>
      (prev ?? []).map((entry, i) =>
        i === index ? { ...entry, [field]: val } : entry,
      ),
    );
  };

  const toggleRow = (index: number) => {
    setEntries((prev) =>
      (prev ?? []).map((entry, i) =>
        i === index ? { ...entry, visible: !entry.visible } : entry,
      ),
    );
  };

  const addRow = () => {
    setEntries((prev) => [
      ...(prev ?? []),
      { id: freshId(), key: "", value: "", visible: true },
    ]);
  };

  const removeRow = (index: number) => {
    setEntries((prev) => {
      const next = (prev ?? []).filter((_, i) => i !== index);
      return next.length > 0
        ? next
        : [{ id: freshId(), key: "", value: "", visible: true }];
    });
  };

  const envMap = (rows: EnvEntry[]): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const entry of rows) {
      const key = entry.key.trim();
      if (key) map[key] = entry.value;
    }
    return map;
  };

  const dirty =
    entries !== null &&
    JSON.stringify(envMap(entries)) !== JSON.stringify(originalMap);

  const handleSave = useCallback(async () => {
    if (entries === null) return;
    const keys = entries.filter((e) => e.key.trim()).map((e) => e.key.trim());
    if (new Set(keys).size < keys.length) {
      Alert.alert(t("agents.env.duplicateTitle"), t("agents.env.duplicateKeys"));
      return;
    }
    try {
      const resp = await saveEnv.mutateAsync({
        custom_env: envMap(entries),
      });
      const saved = resp.custom_env ?? {};
      setOriginalMap(saved);
      setEntries(envMapToEntries(saved));
    } catch (err) {
      Alert.alert(
        t("agents.env.saveFailedTitle"),
        err instanceof Error && err.message
          ? err.message
          : t("agents.env.saveFailedMessage"),
      );
    }
  }, [entries, saveEnv, t]);

  const revealed = entries !== null;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      {keyCount > 0 ? (
        <View className="px-4 pt-4 flex-row items-center gap-2">
          <Ionicons name="lock-closed" size={14} color={theme.mutedForeground} />
          <Text className="text-sm text-foreground">
            {t("agents.env.configuredCount", { count: keyCount })}
          </Text>
        </View>
      ) : null}
      <Text className="px-4 pt-2 text-xs text-muted-foreground/80 leading-5">
        {revealed ? t("agents.env.introRevealed") : t("agents.env.introHidden")}
      </Text>

      {revealed ? (
        <>
          {entries.length === 0 ? null : (
            <View className="px-4 pt-4 gap-2.5">
              {entries.map((entry, index) => (
                <View key={entry.id} className="flex-row items-center gap-2">
                  <TextField
                    value={entry.key}
                    onChangeText={(text) => updateRow(index, "key", text)}
                    placeholder={t("agents.env.keyPlaceholder")}
                    editable={!saveEnv.isPending}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    className="w-[38%] font-mono"
                  />
                  <View className="flex-1 relative">
                    <TextField
                      value={entry.value}
                      onChangeText={(text) => updateRow(index, "value", text)}
                      placeholder={t("agents.env.valuePlaceholder")}
                      editable={!saveEnv.isPending}
                      secureTextEntry={!entry.visible}
                      autoCorrect={false}
                      className="pr-9 font-mono"
                    />
                    <Pressable
                      onPress={() => toggleRow(index)}
                      accessibilityLabel={
                        entry.visible
                          ? t("agents.env.hideValueAria")
                          : t("agents.env.showValueAria")
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                    >
                      <Ionicons
                        name={entry.visible ? "eye-off-outline" : "eye-outline"}
                        size={16}
                        color={theme.mutedForeground}
                      />
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => removeRow(index)}
                    disabled={saveEnv.isPending}
                    accessibilityLabel={t("agents.env.removeAria")}
                    className="p-1.5"
                  >
                    <Ionicons
                      name="trash-outline"
                      size={17}
                      color={theme.mutedForeground}
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View className="flex-row items-center gap-3 px-4 pt-4">
            <Button variant="outline" onPress={addRow} disabled={saveEnv.isPending}>
              <Text>{t("agents.env.add")}</Text>
            </Button>
            <View className="flex-1" />
            {dirty ? (
              <Text className="text-xs text-muted-foreground">
                {t("common.unsavedChanges")}
              </Text>
            ) : null}
            <Button
              onPress={() => void handleSave()}
              disabled={!dirty || saveEnv.isPending}
            >
              <Text>
                {saveEnv.isPending ? t("agents.env.saving") : t("agents.env.save")}
              </Text>
            </Button>
          </View>
        </>
      ) : (
        <View className="px-4 pt-4">
          <Button variant="outline" onPress={() => void handleReveal()} disabled={revealing}>
            <Text>
              {revealing ? t("agents.env.revealing") : t("agents.env.revealAction")}
            </Text>
          </Button>
        </View>
      )}

      {saveEnv.isPending ? (
        <View className="py-6 items-center">
          <ActivityIndicator />
        </View>
      ) : null}
    </ScrollView>
  );
}