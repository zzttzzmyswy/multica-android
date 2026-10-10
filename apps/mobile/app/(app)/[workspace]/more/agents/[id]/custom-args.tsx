/**
 * Agent CLI arguments screen (more/agents/[id]/custom-args). Mirrors web's
 * custom-args-tab.tsx interaction model:
 *
 *  - Rows list the agent's `custom_args`: each item is passed to the agent
 *    as ONE token at launch, in list order. Every row renders monospace.
 *  - Add / edit both inline-edit a single argument: the row gains a
 *    TextInput (mono, Enter commits, Esc-style cancel via the cancel
 *    button). A row in edit mode is not yet in the list — commit writes it
 *    back, cancel discards.
 *  - Save PUTs the whole list back via useUpdateAgent({ custom_args }),
 *    which invalidates the agent list cache; on success the local original
 *    is re-seeded from the server response so dirty-tracking starts clean.
 *  - Command preview mirrors web: when the runtime exposes a launch_header,
 *    show `launch_header arg1 arg2 …` with whitespace-containing args
 *    JSON-quoted (formatArgForPreview), exactly like web.
 *
 * Divergence from web (documented): no toast infra on mobile — success
 * feedback is the row list resettling clean, failures surface via Alert.
 */
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { agentListAllOptions } from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useUpdateAgent } from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { argsToEntries, canSaveCustomArgs, entriesToArgs, customArgsDirty, launchPreview, freshArgEntryId } from "@/lib/custom-args";
import type { ArgEntry } from "@/lib/custom-args";
import { recordRead } from "@/lib/catalog-read";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

const NEW_ENTRY_ID = "__new__";

export default function AgentCustomArgsPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const agents = useQuery(agentListAllOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  const agent = agents.data?.find((a) => a.id === id);
  const read = recordRead(agent, [agents]);
  const runtime = runtimes.data?.find((r) => r.id === agent?.runtime_id) ?? null;
  const saveAgent = useUpdateAgent(id);

  // Page-local row state, seeded once from the agent resource. A background
  // refetch must never clobber in-progress edits (same rule as env.tsx).
  const [originalArgs, setOriginalArgs] = useState<string[]>([]);
  const [entries, setEntries] = useState<ArgEntry[]>([]);
  const [seededId, setSeededId] = useState<string | null>(null);
  if (agent && seededId !== agent.id) {
    setSeededId(agent.id);
    setOriginalArgs(agent.custom_args ?? []);
    setEntries(argsToEntries(agent.custom_args ?? []));
  }
  // null = no inline editor open; otherwise the row being added/edited.
  const [editor, setEditor] = useState<ArgEntry | null>(null);
  const [editorValue, setEditorValue] = useState("");

  const currentArgs = entriesToArgs(entries);
  const dirty = customArgsDirty(currentArgs, originalArgs);

  // `PUT /api/agents/{id}` REPLACES `custom_args` wholesale, so a save is only
  // safe once the list on screen came out of a settled read of the real record.
  // Without this, a failed read rendered 「还没有参数」, the user re-added one
  // argument, and Save wrote that one-element list over every argument the
  // server still held — the data-loss path in MYS-1910.
  const canSave = canSaveCustomArgs({
    dirty,
    readSettled: read.isResolved,
    saving: saveAgent.isPending,
    editorOpen: editor !== null,
  });

  const startAdding = () => {
    setEditor({ id: NEW_ENTRY_ID, value: "" });
    setEditorValue("");
  };
  const startEditing = (entry: ArgEntry) => {
    setEditor(entry);
    setEditorValue(entry.value);
  };
  const closeEditor = () => {
    setEditor(null);
    setEditorValue("");
  };

  const commitEditor = () => {
    const value = editorValue.trim();
    if (!editor || !value) return;
    if (editor.id === NEW_ENTRY_ID) {
      setEntries((current) => [...current, { id: freshArgEntryId(), value }]);
    } else {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === editor.id ? { ...entry, value } : entry,
        ),
      );
    }
    closeEditor();
  };

  const removeEntry = (entryId: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    if (editor?.id === entryId) closeEditor();
  };

  const handleSave = useCallback(async () => {
    // Defence in depth: the button is already disabled, but the mutation
    // replaces the whole column, so a save must never be reachable from a
    // list that was not seeded from a settled read.
    if (!agent || !id || !read.isResolved) return;
    try {
      const resp = await saveAgent.mutateAsync({ custom_args: currentArgs });
      // Reseed the local rows + original from the server-returned agent so
      // the next dirty check starts clean (web env-tab same pattern).
      const saved = resp.custom_args ?? [];
      setOriginalArgs(saved);
      setEntries(argsToEntries(saved));
    } catch (err) {
      Alert.alert(
        t("agents.customArgs.saveFailedTitle"),
        err instanceof Error && err.message
          ? err.message
          : t("agents.customArgs.saveFailedToast"),
      );
    }
  }, [agent, id, saveAgent, currentArgs, t, read.isResolved]);

  // A read that has not settled must never paint the editor. The old code
  // branched on `entries.length === 0`, and `entries` stays `[]` until a row is
  // seeded — so a failed read rendered 「还没有参数」 ("No arguments yet") over an
  // agent that had some, and offered an editor whose Save replaces the whole
  // list. Paint the state instead, and keep the rows unreachable until the
  // read settles (MYS-1910).
  if (!read.isResolved) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus state={read.state} onRetry={read.retry} layout="centered" />
      </View>
    );
  }

  if (!agent) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus
          state="empty"
          onRetry={read.retry}
          emptyMessage={t("agents.notFound")}
          layout="centered"
        />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      <Text className="px-4 pt-4 text-body text-foreground leading-5">
        {t("agents.customArgs.intro")}
      </Text>
      <Text className="px-4 pt-1 text-caption text-muted-foreground/80 leading-5">
        {t("agents.customArgs.argumentsDescription")}
      </Text>

      <View className="flex-row items-center gap-3 px-4 pt-4">
        <Button
          variant="outline"
          size="sm"
          onPress={startAdding}
          disabled={editor !== null || saveAgent.isPending}
        >
          <Ionicons name="add" size={14} color={THEME[colorScheme].mutedForeground} />
          <Text>{t("agents.customArgs.addArgumentAction")}</Text>
        </Button>
        {editor?.id === NEW_ENTRY_ID ? (
          <View className="flex-1 flex-row items-center gap-2">
            <TextField
              value={editorValue}
              onChangeText={setEditorValue}
              placeholder={t("agents.customArgs.inputPlaceholder")}
              accessibilityLabel={t("agents.customArgs.newArgumentAria")}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              editable={!saveAgent.isPending}
              onSubmitEditing={commitEditor}
              className="flex-1 font-mono"
              style={{ borderColor: THEME[colorScheme].border }}
            />
            <Button size="sm" onPress={commitEditor} disabled={!editorValue.trim()}>
              <Text>{t("agents.customArgs.addAction")}</Text>
            </Button>
            <Button variant="ghost" size="sm" onPress={closeEditor}>
              <Text>{t("agents.customArgs.cancelAction")}</Text>
            </Button>
          </View>
        ) : null}
      </View>

      {entries.length === 0 ? (
        <View className="px-4 pt-6">
          <Text className="text-body font-medium text-foreground">
            {t("agents.customArgs.emptyTitle")}
          </Text>
          <Text className="pt-1 text-caption text-muted-foreground/80">
            {t("agents.customArgs.emptyHint")}
          </Text>
        </View>
      ) : (
        <View className="px-4 pt-3 gap-2.5">
          {entries.map((entry, index) =>
            editor?.id === entry.id ? (
              <View key={entry.id} className="flex-row items-center gap-2">
                <TextField
                  value={editorValue}
                  onChangeText={setEditorValue}
                  placeholder={t("agents.customArgs.inputPlaceholder")}
                  accessibilityLabel={t("agents.customArgs.inputAria", {
                    index: index + 1,
                  })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!saveAgent.isPending}
                  onSubmitEditing={commitEditor}
                  className="flex-1 font-mono"
                />
                <Button size="sm" onPress={commitEditor} disabled={!editorValue.trim()}>
                  <Text>{t("agents.customArgs.updateAction")}</Text>
                </Button>
                <Button variant="ghost" size="sm" onPress={closeEditor}>
                  <Text>{t("agents.customArgs.cancelAction")}</Text>
              </Button>
              </View>
            ) : (
              <View key={entry.id} className="flex-row items-center gap-2">
                <Text className="flex-1 shrink font-mono text-body text-foreground">
                  {entry.value}
                </Text>
                <Pressable
                  onPress={() => startEditing(entry)}
                  disabled={editor !== null || saveAgent.isPending}
                  accessibilityLabel={t("agents.customArgs.editAria", {
                    index: index + 1,
                  })}
                  className="p-1.5"
                >
                  <Ionicons name="pencil" size={15} color={THEME[colorScheme].mutedForeground} />
                </Pressable>
                <Pressable
                  onPress={() => removeEntry(entry.id)}
                  disabled={editor !== null || saveAgent.isPending}
                  accessibilityLabel={t("agents.customArgs.removeAria", {
                    index: index + 1,
                  })}
                  className="p-1.5"
                >
                  <Ionicons name="trash-outline" size={16} color={THEME[colorScheme].mutedForeground} />
                </Pressable>
              </View>
            ),
          )}
        </View>
      )}

      {launchPreview(runtime?.launch_header, currentArgs) ? (
        <View className="px-4 pt-6">
          <Text className="text-body font-semibold text-foreground">
            {t("agents.customArgs.commandPreviewLabel")}
          </Text>
          <View className="mt-2 rounded-md border border-border bg-muted px-3 py-2">
            <Text className="font-mono text-caption text-foreground" selectable>
              {launchPreview(runtime?.launch_header, currentArgs)}
            </Text>
          </View>
        </View>
      ) : null}

      <View className="flex-row items-center gap-3 px-4 pt-6">
        <View className="flex-1" />
        {dirty ? (
          <Text className="text-caption text-muted-foreground">
            {t("common.unsavedChanges")}
          </Text>
        ) : null}
        <Button onPress={() => void handleSave()} disabled={!canSave}>
          <Text>
            {saveAgent.isPending ? t("common.saving") : t("common.save")}
          </Text>
        </Button>
      </View>
    </ScrollView>
  );
}