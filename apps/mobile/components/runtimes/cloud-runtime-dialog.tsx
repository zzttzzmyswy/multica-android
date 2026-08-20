/**
 * Cloud runtime node dialog (iteration-82, A2.2). Full-screen modal mirroring
 * web `packages/views/runtimes/components/cloud-runtime-dialog.tsx` on a
 * phone: create a managed fleet node (name / instance type / disk size) and
 * manage the workspace's node list.
 *
 * Web gates the entrypoint behind a build env (`NEXT_PUBLIC_ENABLE_CLOUD_RUNTIME`);
 * mobile has no build-time fork, so availability is self-evidenced at
 * runtime: hatching `GET /api/cloud-runtime/nodes` 503s (the proxy is
 * unconfigured on this instance), the surface degrades to an explanatory
 * card telling the member the hosting instance has no cloud node service.
 * The list query polls every 5s while any node is pending (launching/…), so
 * the statuses liven up without manual refreshes.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CloudRuntimeNode } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  cloudRuntimeNodeListOptions,
  useCreateCloudRuntimeNode,
  useDeleteCloudRuntimeNode,
} from "@/data/queries/cloud-runtime";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ApiError } from "@/data/api";

const INSTANCE_TYPES = ["t4g.medium", "t4g.large"] as const;
const DEFAULT_DISK_SIZE_GB = 20;

function valueOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatDateTime(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function CloudRuntimeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const [name, setName] = useState("");
  const [instanceType, setInstanceType] = useState<string>(INSTANCE_TYPES[0]);
  const [diskSizeGB, setDiskSizeGB] = useState(String(DEFAULT_DISK_SIZE_GB));

  const nodesQuery = useQuery(
    cloudRuntimeNodeListOptions(wsId, { limit: 20, offset: 0 }),
  );
  const createNode = useCreateCloudRuntimeNode();
  const deleteNode = useDeleteCloudRuntimeNode();

  // Web's dialog renders newest-first regardless of backend order.
  const sortedNodes = useMemo(
    () =>
      (nodesQuery.data ?? []).slice().sort(
        (a: CloudRuntimeNode, b: CloudRuntimeNode) =>
          Date.parse(b.created_at) - Date.parse(a.created_at),
      ),
    [nodesQuery.data],
  );

  // 503 means the hosting instance has no cloud-runtime adapter — degrade to
  // the explanatory card instead of a raw error banner.
  const isNotEnabled =
    nodesQuery.isError &&
    nodesQuery.error instanceof ApiError &&
    nodesQuery.error.status === 503;

  const handleCreate = async () => {
    const diskSize = diskSizeGB.trim()
      ? Number(diskSizeGB.trim())
      : DEFAULT_DISK_SIZE_GB;
    if (!Number.isInteger(diskSize) || diskSize <= 0) {
      Alert.alert(t("runtimes.cloudRuntime.validation.diskSizeInvalid"));
      return;
    }
    try {
      await createNode.mutateAsync({
        instance_type: instanceType,
        name: valueOrUndefined(name),
        disk_size_gb: diskSize,
      });
      Alert.alert(t("runtimes.cloudRuntime.created"));
      setName("");
      setInstanceType(INSTANCE_TYPES[0]);
      setDiskSizeGB(String(DEFAULT_DISK_SIZE_GB));
    } catch (err) {
      Alert.alert(
        t("runtimes.cloudRuntime.createFailed"),
        err instanceof Error ? err.message : undefined,
      );
    }
  };

  const confirmDeleteNode = (node: CloudRuntimeNode) => {
    Alert.alert(t("runtimes.cloudRuntime.delete"), t("runtimes.cloudRuntime.deleteConfirm"), [
      { text: t("runtimes.cloudRuntime.cancel"), style: "cancel" },
      {
        text: t("runtimes.cloudRuntime.delete"),
        style: "destructive",
        onPress: () =>
          deleteNode.mutate(node.instance_id, {
            onError: (err) =>
              Alert.alert(
                t("runtimes.cloudRuntime.deleteFailed"),
                err instanceof Error ? err.message : undefined,
              ),
          }),
      },
    ]);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        {/* Header */}
        <View className="border-b border-border px-4 py-3 flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons name="cloud-outline" size={16} color={theme.mutedForeground} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              {t("runtimes.cloudRuntime.title")}
            </Text>
            <Text className="text-[11px] text-muted-foreground">
              {t("runtimes.cloudRuntime.description")}
            </Text>
          </View>
          <Pressable onPress={onClose} accessibilityLabel={t("runtimes.cloudRuntime.cancel")} hitSlop={8}>
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={nodesQuery.isFetching}
              onRefresh={() => nodesQuery.refetch()}
              tintColor={theme.mutedForeground}
            />
          }
          contentContainerClassName="px-4 py-4 gap-5"
        >
          {isNotEnabled ? (
            /* 503 — this instance has no cloud node service */
            <View className="items-center gap-2 rounded-lg border border-border bg-secondary/40 px-5 py-8">
              <Ionicons name="cloud-offline-outline" size={28} color={theme.mutedForeground} />
              <Text className="text-sm font-medium text-foreground">
                {t("runtimes.cloudRuntime.notEnabledTitle")}
              </Text>
              <Text className="text-xs text-muted-foreground text-center leading-5">
                {t("runtimes.cloudRuntime.notEnabledHint")}
              </Text>
            </View>
          ) : (
            <>
              {/* Create form */}
              <View className="gap-3 rounded-lg border border-border p-4">
                <Text className="text-sm font-medium text-foreground">
                  {t("runtimes.cloudRuntime.createTitle")}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {t("runtimes.cloudRuntime.createHint")}
                </Text>
                <View className="gap-3">
                  <View className="gap-1">
                    <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("runtimes.cloudRuntime.fields.name")}
                    </Text>
                    <TextField
                      value={name}
                      onChangeText={setName}
                      placeholder={t("runtimes.cloudRuntime.placeholders.name")}
                      autoCapitalize="none"
                    />
                  </View>
                  <View className="gap-1">
                    <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("runtimes.cloudRuntime.fields.instanceType")}
                    </Text>
                    <View className="flex-row gap-1.5">
                      {INSTANCE_TYPES.map((type) => {
                        const active = instanceType === type;
                        return (
                          <Pressable
                            key={type}
                            onPress={() => setInstanceType(type)}
                            className={cn(
                              "flex-1 h-10 rounded-md border items-center justify-center",
                              active
                                ? "bg-primary/10 border-primary"
                                : "bg-secondary/50 border-transparent",
                            )}
                          >
                            <Text
                              className={cn(
                                "text-xs font-medium",
                                active ? "text-primary" : "text-foreground",
                              )}
                            >
                              {type}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View className="gap-1">
                    <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("runtimes.cloudRuntime.fields.diskSize")}
                    </Text>
                    <TextField
                      value={diskSizeGB}
                      onChangeText={setDiskSizeGB}
                      placeholder={t("runtimes.cloudRuntime.placeholders.diskSize")}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              </View>

              {/* Node list */}
              <View className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-medium text-foreground">
                    {t("runtimes.cloudRuntime.nodesTitle")}
                  </Text>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => nodesQuery.refetch()}
                    disabled={nodesQuery.isFetching}
                  >
                    <Ionicons
                      name="refresh"
                      size={14}
                      color={theme.mutedForeground}
                      className={nodesQuery.isFetching ? "animate-spin" : ""}
                    />
                    <Text className="text-xs text-muted-foreground">
                      {t("runtimes.cloudRuntime.refresh")}
                    </Text>
                  </Button>
                </View>

                {nodesQuery.isLoading ? (
                  <View className="items-center py-10">
                    <ActivityIndicator />
                  </View>
                ) : nodesQuery.isError ? (
                  <View className="items-center gap-1 rounded-lg border border-border px-5 py-8">
                    <Ionicons name="alert-circle-outline" size={24} color={theme.destructive} />
                    <Text className="text-sm font-medium text-foreground">
                      {t("runtimes.cloudRuntime.nodesFailed")}
                    </Text>
                    <Text className="text-xs text-muted-foreground text-center">
                      {t("runtimes.cloudRuntime.nodesFailedHint")}
                    </Text>
                  </View>
                ) : sortedNodes.length === 0 ? (
                  <View className="items-center gap-2 rounded-lg border border-border px-5 py-8">
                    <Ionicons name="cloud-outline" size={24} color={theme.mutedForeground} />
                    <Text className="text-sm font-medium text-foreground">
                      {t("runtimes.cloudRuntime.nodesEmpty")}
                    </Text>
                  </View>
                ) : (
                  <View className="gap-2">
                    {sortedNodes.map((node) => (
                      <NodeRow
                        key={node.id}
                        node={node}
                        deleting={deleteNode.isPending}
                        onDelete={() => confirmDeleteNode(node)}
                      />
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {!isNotEnabled ? (
          <View className="border-t border-border px-4 py-3 flex-row gap-2">
            <Button variant="outline" onPress={onClose} className="flex-1">
              <Text>{t("runtimes.cloudRuntime.cancel")}</Text>
            </Button>
            <Button
              onPress={handleCreate}
              disabled={createNode.isPending}
              className="flex-1"
            >
              {createNode.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text>
                  {createNode.isPending
                    ? t("runtimes.cloudRuntime.creating")
                    : t("runtimes.cloudRuntime.create")}
                </Text>
              )}
            </Button>
          </View>
        ) : (
          <View className="border-t border-border px-4 py-3">
            <Button variant="outline" onPress={onClose}>
              <Text>{t("runtimes.cloudRuntime.cancel")}</Text>
            </Button>
          </View>
        )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function NodeRow({
  node,
  deleting,
  onDelete,
}: {
  node: CloudRuntimeNode;
  deleting: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const title =
    node.name.trim() ||
    node.instance_id.trim() ||
    t("runtimes.cloudRuntime.nodeFallbackName");
  const created = formatDateTime(node.created_at);

  return (
    <View className="rounded-lg border border-border px-3 py-2.5">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
              {title}
            </Text>
            <StatusBadge status={node.status} />
          </View>
          <View className="mt-1 flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
            <Text className="text-[11px] text-muted-foreground">{node.instance_type}</Text>
            <Text className="text-[11px] text-muted-foreground/60">/</Text>
            <Text className="text-[11px] text-muted-foreground">{node.region}</Text>
            {created ? (
              <>
                <Text className="text-[11px] text-muted-foreground/60">/</Text>
                <Text className="text-[11px] text-muted-foreground">{created}</Text>
              </>
            ) : null}
          </View>
        </View>
        <Pressable onPress={onDelete} disabled={deleting} hitSlop={8} accessibilityLabel={t("runtimes.cloudRuntime.delete")}>
          <Ionicons name="trash-outline" size={16} color={deleting ? theme.mutedForeground : theme.destructive} />
        </Pressable>
      </View>
      {node.instance_id ? (
        <Text className="mt-1.5 font-mono text-[10px] text-muted-foreground" numberOfLines={1}>
          {node.instance_id}
        </Text>
      ) : null}
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const active = normalized === "running" || normalized === "success";
  const pending = ["launching", "pending", "starting", "stopping", "rebooting", "terminating"].includes(
    normalized,
  );
  const failed = ["failed", "terminated", "error"].includes(normalized);
  return (
    <View
      className={cn(
        "px-1.5 py-0.5 rounded-md border border-transparent",
        active && "bg-success/10 border-success/20",
        pending && "bg-warning/10 border-warning/20",
        failed && "bg-destructive/10 border-destructive/20",
        !active && !pending && !failed && "bg-secondary",
      )}
    >
      <Text
        className={cn(
          "font-mono text-[10px] font-medium",
          active && "text-success",
          pending && "text-warning",
          failed && "text-destructive",
          !active && !pending && !failed && "text-muted-foreground",
        )}
      >
        {status || "unknown"}
      </Text>
    </View>
  );
}