/**
 * Agent detail MCP section (mobile mirror of web's agent mcp-config-tab, all
 * three of its sections):
 *
 *  1. Agent configuration — the servers stored on the AGENT ITSELF
 *     (`agent.mcp_config`). Web reads/writes this document through
 *     `listManagedMcpServers` / `upsertManagedMcpServer` /
 *     `removeManagedMcpServer`; the pure model lives in `lib/mcp-config.ts`
 *     and the write path is `PUT /api/agents/{id}` carrying `mcp_config`
 *     (there is no dedicated endpoint). `mcp_config_redacted` means the
 *     server stripped credentials from this response, so the section shows a
 *     lock notice instead of an edit affordance.
 *  2. Workspace assignments — the workspace MCP servers ASSIGNED to this
 *     agent, each with its own on/off toggle. A library entry does nothing
 *     until it is added here.
 *  3. Runtime discovery — the servers the agent's local runtime already
 *     provides, read from the same daemon round trip that lists local skills
 *     (`runtimeCapabilitiesOptions`). Names already covered by (1) or (2) are
 *     marked "overridden" because the daemon merges runtime < assignments +
 *     agent config.
 *
 * Archived agents render no MCP section at all (retired agents can't run).
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { AgentManagedMcpForm } from "@/components/agent/agent-managed-mcp-form";
import { agentMcpServersOptions, workspaceMcpServersOptions } from "@/data/queries/mcp";
import { runtimeCapabilitiesOptions } from "@/data/queries/runtime-local-skills";
import { useUpdateAgent } from "@/data/mutations/agents";
import {
  useAddAgentMcpServer,
  useRemoveAgentMcpServer,
  useSetAgentMcpServerEnabled,
} from "@/data/mutations/mcp";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { ActionSheet } from "@/lib/action-sheet";
import {
  formCanExpressTransport,
  listManagedMcpServers,
  managedMcpEffectiveNames,
  removeManagedMcpServer,
  transportLabel,
  upsertManagedMcpServer,
  type ManagedMcpServer,
} from "@/lib/mcp-config";

export function AgentMcpSection({
  agent,
  runtime,
}: {
  agent: Agent;
  /** The agent's bound runtime, when the workspace list has it. */
  runtime: AgentRuntime | null;
}) {
  const wsId = agent.workspace_id || "";
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;

  const assignedQuery = agentMcpServersOptions(agent.id);
  const { data: assigned = [], isLoading, error, refetch } =
    useQuery(assignedQuery);
  const { data: library = [] } = useQuery(workspaceMcpServersOptions(wsId));

  const addServer = useAddAgentMcpServer(agent.id);
  const setServerEnabled = useSetAgentMcpServerEnabled(agent.id);
  const removeServer = useRemoveAgentMcpServer(agent.id);
  const updateAgent = useUpdateAgent(agent.id);

  const assignedIds = useMemo(
    () => new Set(assigned.map((server) => server.id)),
    [assigned],
  );
  const available = useMemo(
    () => library.filter((server) => !assignedIds.has(server.id)),
    [library, assignedIds],
  );

  const busy = addServer.isPending || setServerEnabled.isPending || removeServer.isPending;

  // -- Agent-owned config (1) -------------------------------------------------

  const redacted = agent.mcp_config_redacted === true;
  const managed = useMemo(
    () => listManagedMcpServers(agent.mcp_config),
    [agent.mcp_config],
  );
  const managedNames = useMemo(
    () => managed.map((server) => server.name),
    [managed],
  );

  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<ManagedMcpServer | null>(null);

  const saveManaged = useCallback(
    (name: string, config: Record<string, unknown>) => {
      updateAgent.mutate(
        { mcp_config: upsertManagedMcpServer(agent.mcp_config, editing, name, config) },
        {
          onSuccess: () => {
            setFormVisible(false);
            setEditing(null);
          },
          onError: (err) =>
            Alert.alert(
              t("mcp.agent.managedSaveFailed"),
              err instanceof Error ? err.message : t("common.unknownError"),
            ),
        },
      );
    },
    [agent.mcp_config, editing, updateAgent, t],
  );

  const deleteManaged = useCallback(
    (server: ManagedMcpServer) => {
      updateAgent.mutate(
        { mcp_config: removeManagedMcpServer(agent.mcp_config, server) },
        {
          onError: (err) =>
            Alert.alert(
              t("mcp.agent.managedDeleteFailed"),
              err instanceof Error ? err.message : t("common.unknownError"),
            ),
        },
      );
    },
    [agent.mcp_config, updateAgent, t],
  );

  const confirmDeleteManaged = useCallback(
    (server: ManagedMcpServer) => {
      Alert.alert(
        t("mcp.agent.managedDeleteTitle"),
        t("mcp.agent.managedDeleteMessage", { name: server.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("mcp.agent.managedDeleteAction"),
            style: "destructive",
            onPress: () => deleteManaged(server),
          },
        ],
      );
    },
    [deleteManaged, t],
  );

  // -- Runtime discovery (3) -------------------------------------------------

  const runtimeId =
    runtime?.runtime_mode === "local" && runtime.status === "online"
      ? runtime.id
      : null;
  const runtimeQuery = useQuery(runtimeCapabilitiesOptions(runtimeId));

  // A name covered by the agent's own config or an enabled assignment is
  // shadowed at launch, so the runtime row says so instead of implying the
  // runtime's version is what runs.
  const effectiveNames = useMemo(
    () => managedMcpEffectiveNames(managed, assigned),
    [managed, assigned],
  );

  // -- Workspace assignment (2) ----------------------------------------------

  const openAddPicker = useCallback(() => {
    if (available.length === 0) return;
    const labels = available.map((server) => `${server.name} (${transportLabel(server.transport)})`);
    const cancelLabel = t("common.cancel");
    const cancelButtonIndex = labels.length;
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("mcp.agent.add"),
        options: [...labels, cancelLabel],
        cancelButtonIndex,
      },
      (index) => {
        if (index === undefined || index < 0 || index >= available.length) return;
        const server = available[index];
        addServer.mutate(server.id, {
          onError: (err) =>
            Alert.alert(
              t("mcp.agent.actionFailed"),
              err instanceof Error ? err.message : t("common.unknownError"),
            ),
        });
      },
    );
  }, [available, addServer, t]);

  const confirmRemove = useCallback(
    (serverId: string, name: string) => {
      Alert.alert(
        t("mcp.agent.removeConfirmTitle"),
        t("mcp.agent.removeConfirmMessage", { name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("mcp.agent.removeAction"),
            style: "destructive",
            onPress: () =>
              removeServer.mutate(serverId, {
                onError: (err) =>
                  Alert.alert(
                    t("mcp.agent.removeFailed"),
                    err instanceof Error ? err.message : t("common.unknownError"),
                  ),
              }),
          },
        ],
      );
    },
    [removeServer, t],
  );

  const runtimeNotice = !runtime
    ? t("mcp.agent.runtimeMissing")
    : runtime.status !== "online"
      ? t("mcp.agent.runtimeOffline")
      : runtimeQuery.isLoading
        ? t("mcp.agent.runtimeDiscovering")
        : runtimeQuery.isError
          ? t("mcp.agent.runtimeFailed")
          : runtimeQuery.data?.mcpSupported !== true
            ? t("mcp.agent.runtimeUnsupported")
            : null;

  return (
    <View className="mt-1">
      <View className="px-4 pt-5 pb-2">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("mcp.agent.title")}
        </Text>
      </View>

      {/* 1 — Agent configuration */}
      <View className="px-4 gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-[11px] uppercase tracking-wider text-muted-foreground/80 font-medium">
            {t("mcp.agent.managedTitle")}
          </Text>
          {!redacted ? (
            <Button
              variant="outline"
              size="sm"
              disabled={updateAgent.isPending}
              onPress={() => {
                setEditing(null);
                setFormVisible(true);
              }}
            >
              <Ionicons name="add" size={14} color={muted} />
              <Text>{t("mcp.agent.managedAdd")}</Text>
            </Button>
          ) : null}
        </View>
        <Text className="text-[11px] text-muted-foreground/80 leading-4">
          {t("mcp.agent.managedHint")}
        </Text>

        {redacted ? (
          <View className="flex-row items-start gap-2 rounded-md border border-border px-3 py-2.5">
            <Ionicons name="lock-closed-outline" size={15} color={muted} />
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-medium text-foreground">
                {t("mcp.agent.redactedTitle")}
              </Text>
              <Text className="text-[11px] text-muted-foreground leading-4">
                {t("mcp.agent.redactedHint")}
              </Text>
            </View>
          </View>
        ) : managed.length === 0 ? (
          <Text className="text-xs text-muted-foreground/80 py-1">
            {t("mcp.agent.managedEmpty")}
          </Text>
        ) : (
          <View className="overflow-hidden rounded-md border border-border bg-secondary/30">
            {managed.map((server, index) => (
              <View
                key={server.name}
                className={
                  index > 0
                    ? "border-t border-border px-3 py-2.5 flex-row items-center gap-3"
                    : "px-3 py-2.5 flex-row items-center gap-3"
                }
              >
                <Ionicons name="server-outline" size={16} color={muted} />
                <View className="flex-1 min-w-0 gap-0.5">
                  <Text
                    className="text-sm font-medium text-foreground"
                    numberOfLines={1}
                  >
                    {server.name}
                  </Text>
                  <Text className="text-[11px] text-muted-foreground uppercase">
                    {transportLabel(server.transport)}
                  </Text>
                </View>
                {formCanExpressTransport(server.transport) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("mcp.agent.managedEditAria", {
                      name: server.name,
                    })}
                    disabled={updateAgent.isPending}
                    onPress={() => {
                      setEditing(server);
                      setFormVisible(true);
                    }}
                    className="p-1"
                  >
                    <Ionicons name="pencil-outline" size={16} color={muted} />
                  </Pressable>
                ) : (
                  <Text className="text-[11px] text-muted-foreground">
                    {t("mcp.notEditable")}
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mcp.agent.managedDeleteAria", {
                    name: server.name,
                  })}
                  disabled={updateAgent.isPending}
                  onPress={() => confirmDeleteManaged(server)}
                  className="p-1"
                >
                  <Ionicons name="trash-outline" size={16} color={muted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 2 — Workspace assignments */}
      <View className="px-4 pt-5 gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-[11px] uppercase tracking-wider text-muted-foreground/80 font-medium">
            {t("mcp.agent.workspaceTitle")}
          </Text>
          {available.length > 0 ? (
            <Button variant="outline" size="sm" onPress={openAddPicker} disabled={busy}>
              <Ionicons name="add" size={14} color={muted} />
              <Text>{t("mcp.agent.add")}</Text>
            </Button>
          ) : null}
        </View>
        <Text className="text-[11px] text-muted-foreground/80 leading-4">
          {t("mcp.agent.hint")}
        </Text>

        {isLoading ? (
          <View className="py-3 items-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            className="py-3"
          >
            <Text className="text-xs text-destructive">
              {t("mcp.agent.loadError")} {t("workspace.retry")}
            </Text>
          </Pressable>
        ) : assigned.length === 0 ? (
          <Text className="text-xs text-muted-foreground/80 py-1">
            {library.length === 0
              ? t("mcp.agent.libraryEmpty")
              : t("mcp.agent.noneAssigned")}
          </Text>
        ) : (
          <View className="overflow-hidden rounded-md border border-border bg-secondary/30">
            {assigned.map((server, index) => (
              <View
                key={server.id}
                className={index > 0 ? "border-t border-border px-3 py-2.5 flex-row items-center gap-3" : "px-3 py-2.5 flex-row items-center gap-3"}
              >
                <Ionicons name="server-outline" size={16} color={muted} />
                <View className="flex-1 min-w-0 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text
                      className="text-sm font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {server.name}
                    </Text>
                    {managed.some((m) => m.name === server.name) ? (
                      <Text className="text-[10px] uppercase text-muted-foreground border border-border rounded px-1">
                        {t("mcp.agent.runtimeOverridden")}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-[11px] text-muted-foreground uppercase">
                    {transportLabel(server.transport)}
                  </Text>
                </View>
                <Switch
                  checked={server.enabled !== false}
                  disabled={busy}
                  onCheckedChange={(value) =>
                    setServerEnabled.mutate(
                      { serverId: server.id, enabled: value },
                      {
                        onError: (err) =>
                          Alert.alert(
                            t("mcp.agent.toggleFailed"),
                            err instanceof Error ? err.message : t("common.unknownError"),
                          ),
                      },
                    )
                  }
                  accessibilityLabel={t("mcp.agent.toggleAria", { name: server.name })}
                />
                <Pressable
                  onPress={() => confirmRemove(server.id, server.name)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t("mcp.agent.removeAria", { name: server.name })}
                  className="p-1"
                >
                  <Ionicons name="trash-outline" size={16} color={muted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 3 — Runtime discovery */}
      <View className="px-4 pt-5 gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-[11px] uppercase tracking-wider text-muted-foreground/80 font-medium">
            {t("mcp.agent.runtimeTitle")}
          </Text>
          {runtimeId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void runtimeQuery.refetch()}
              disabled={runtimeQuery.isFetching}
              className="flex-row items-center gap-1 py-1"
            >
              <Ionicons name="refresh" size={14} color={muted} />
              <Text className="text-xs text-muted-foreground">
                {t("mcp.agent.runtimeRefresh")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {runtime ? (
          <Text className="text-[11px] text-muted-foreground/80 leading-4">
            {t("mcp.agent.runtimeHint", { runtime: runtimeDisplayLabel(runtime) })}
          </Text>
        ) : null}

        {runtimeNotice ? (
          <View className="flex-row items-center gap-3 py-2">
            {runtimeQuery.isLoading ? <ActivityIndicator /> : null}
            <Text className="flex-1 text-xs text-muted-foreground">
              {runtimeNotice}
            </Text>
          </View>
        ) : (runtimeQuery.data?.mcpServers.length ?? 0) === 0 ? (
          <Text className="text-xs text-muted-foreground/80 py-1">
            {t("mcp.agent.runtimeEmpty")}
          </Text>
        ) : (
          <View className="overflow-hidden rounded-md border border-border bg-secondary/30">
            {(runtimeQuery.data?.mcpServers ?? []).map((server, index) => (
              <View
                key={server.name}
                className={index > 0 ? "border-t border-border px-3 py-2.5 flex-row items-center gap-3" : "px-3 py-2.5 flex-row items-center gap-3"}
              >
                <Ionicons name="hardware-chip-outline" size={16} color={muted} />
                <View className="flex-1 min-w-0 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text
                      className="text-sm font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {server.name}
                    </Text>
                    {effectiveNames.has(server.name) ? (
                      <Text className="text-[10px] uppercase text-muted-foreground border border-border rounded px-1">
                        {t("mcp.agent.runtimeOverridden")}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-[11px] text-muted-foreground uppercase">
                    {transportLabel(server.transport || "unknown")}
                  </Text>
                </View>
                {!server.enabled ? (
                  <Text className="text-[10px] uppercase text-muted-foreground border border-border rounded px-1">
                    {t("mcp.agent.runtimeDisabled")}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>

      <AgentManagedMcpForm
        visible={formVisible}
        server={editing}
        existingNames={managedNames}
        saving={updateAgent.isPending}
        onSave={saveManaged}
        onClose={() => {
          setFormVisible(false);
          setEditing(null);
        }}
      />
    </View>
  );
}
