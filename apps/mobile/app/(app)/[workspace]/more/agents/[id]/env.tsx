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
 *  - Bulk text editing (added iteration 80, MYS-578): a "Bulk edit / Edit as
 *    rows" toggle switches the row list for a dotenv-style textarea. Every
 *    keystroke round-trips through lib/env-file (a 1:1 port of web's
 *    packages/views/agents/components/tabs/env-file.ts): text that parses is
 *    written straight through to the row state so dirty-tracking and Save
 *    behave identically in both modes; text that does not parse leaves the
 *    rows on their last good value and raises a line-numbered error that
 *    disables Save — the user can never ship the state that is no longer on
 *    screen. Entering bulk mode refuses (Alert) when formatEnvFile cannot
 *    represent the current rows (newline/PEM-style values, bad keys).
 *
 * Remaining divergence from web (documented): no per-row env-file paste
 * interception — RN has no clipboardData event model, and bulk edit is the
 * entry point for files anyway, matching the web value-paste rationale.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { agentEnvOptions, agentListAllOptions } from "@/data/queries/agents";
import { useUpdateAgentEnv } from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { EnvParseError } from "@/lib/env-file";
import { formatEnvFile, parseEnvFileResult } from "@/lib/env-file";
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

  // Bulk mode is a second editor over the same `entries` state rather than a
  // staging buffer (web env-tab semantics): every keystroke that parses is
  // written straight through, so dirty-tracking and Save behave identically in
  // both modes. A keystroke that does not parse leaves `entries` on its last
  // good value and raises `bulkError`, which disables Save so the user can
  // never ship the stale state that is no longer on screen.
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<EnvParseError | null>(null);

  const saveEnv = useUpdateAgentEnv(id);

  const entriesToBulkText = (rows: EnvEntry[]) =>
    formatEnvFile(
      rows
        .filter((entry) => entry.key.trim() !== "")
        .map((entry) => ({ key: entry.key.trim(), value: entry.value })),
    );

  const describeParseError = (error: EnvParseError) =>
    error.kind === "duplicate"
      ? t("agents.env.parseErrorDuplicate", {
          line: error.line,
          key: error.key,
        })
      : t("agents.env.parseErrorMalformed", { line: error.line });

  const enterBulkEditing = () => {
    const formatted = entriesToBulkText(entries ?? []);
    if (!formatted.ok) {
      // Refuse rather than hand back text that cannot be read again — the
      // user would edit an unrelated line and silently truncate this one.
      Alert.alert(
        t("agents.env.bulkUnsupportedTitle"),
        formatted.reason === "duplicate"
          ? t("agents.env.duplicateKeys")
          : t("agents.env.bulkUnsupportedMessage", { key: formatted.key }),
      );
      return;
    }

    setBulkText(formatted.text);
    setBulkError(null);
    setBulkEditing(true);
  };

  const leaveBulkEditing = () => {
    setBulkEditing(false);
    setBulkError(null);
  };

  const handleBulkTextChange = (text: string) => {
    setBulkText(text);

    const result = parseEnvFileResult(text);
    if (!result.ok) {
      setBulkError(result.error);
      return;
    }

    setBulkError(null);
    setEntries(
      result.assignments.length > 0
        ? result.assignments.map(({ key, value }) => ({
            id: freshId(),
            key,
            value,
            visible: false,
          }))
        : [{ id: freshId(), key: "", value: "", visible: true }],
    );
  };

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

  // Bulk text that does not parse never reaches `entries`, so `dirty` alone
  // would report a clean page while the textarea still holds the user's work.
  const hasUnsavedWork = dirty || (bulkEditing && bulkError !== null);

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
      const savedEntries = envMapToEntries(saved);
      setOriginalMap(saved);
      setEntries(savedEntries);
      // Keep the textarea in step with what the server accepted rather than
      // dropping the user out of bulk mode on every save. If the server hands
      // back something bulk text cannot express, fall back to rows — the data
      // is already saved, so the only wrong move would be showing lossy text.
      if (bulkEditing) {
        const formatted = entriesToBulkText(savedEntries);
        if (formatted.ok) {
          setBulkText(formatted.text);
        } else {
          leaveBulkEditing();
        }
      }
    } catch (err) {
      Alert.alert(
        t("agents.env.saveFailedTitle"),
        err instanceof Error && err.message
          ? err.message
          : t("agents.env.saveFailedMessage"),
      );
    }
  }, [entries, saveEnv, t, bulkEditing]);

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
          <View className="flex-row items-center gap-3 px-4 pt-4">
            <Button
              variant="outline"
              size="sm"
              onPress={bulkEditing ? leaveBulkEditing : enterBulkEditing}
              disabled={bulkEditing && bulkError !== null}
              accessibilityLabel={
                bulkEditing
                  ? t("agents.env.rowEditAction")
                  : t("agents.env.bulkEditAction")
              }
            >
              <Ionicons
                name={bulkEditing ? "list-outline" : "reader-outline"}
                size={14}
                color={theme.mutedForeground}
              />
              <Text>
                {bulkEditing
                  ? t("agents.env.rowEditAction")
                  : t("agents.env.bulkEditAction")}
              </Text>
            </Button>
            {!bulkEditing && (
              <Button variant="outline" size="sm" onPress={addRow} disabled={saveEnv.isPending}>
                <Text>{t("agents.env.add")}</Text>
              </Button>
            )}
          </View>

          {bulkEditing ? (
            <View className="px-4 pt-3 gap-2">
              <AutosizeTextArea
                value={bulkText}
                onChangeText={handleBulkTextChange}
                placeholder={t("agents.env.bulkPlaceholder")}
                accessibilityLabel={t("agents.env.bulkEditAction")}
                editable={!saveEnv.isPending}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                minHeight={192}
                maxHeight={400}
                className="font-mono text-sm"
                style={
                  bulkError
                    ? { borderColor: theme.destructive, borderWidth: 1 }
                    : undefined
                }
              />
              {bulkError ? (
                <Text className="text-xs" style={{ color: theme.destructive }}>
                  {describeParseError(bulkError)}
                </Text>
              ) : (
                <Text className="text-xs text-muted-foreground/80">
                  {t("agents.env.bulkPlaintextNotice")}
                </Text>
              )}
            </View>
          ) : entries.length === 0 ? (
            <Text className="px-4 pt-3 text-xs italic text-muted-foreground/80">
              {t("agents.env.emptyEditable")}
            </Text>
          ) : (
            <View className="px-4 pt-3 gap-2.5">
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
            <View className="flex-1" />
            {hasUnsavedWork ? (
              <Text className="text-xs text-muted-foreground">
                {t("common.unsavedChanges")}
              </Text>
            ) : null}
            <Button
              onPress={() => void handleSave()}
              disabled={!dirty || saveEnv.isPending || bulkError !== null}
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