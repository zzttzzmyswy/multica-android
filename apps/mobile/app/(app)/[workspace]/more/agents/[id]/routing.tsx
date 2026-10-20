/**
 * Agent routing configuration (more/agents/[id]/routing) — the mobile port of
 * web's Runtime Config tab (`packages/views/agents/components/tabs/
 * runtime-config-tab.tsx`).
 *
 * Scope: OpenClaw agents only. Web mounts this tab when the bound runtime's
 * provider is `openclaw` (`agent-overview-pane.tsx:223`); the reachability
 * decision lives in `lib/openclaw-routing-availability.ts` so the "runtime read
 * has not answered" case cannot be mistaken for "not an OpenClaw agent".
 *
 * Interaction parity:
 *  - Routing mode: Local ⇄ Gateway. The gateway block is disabled in Local
 *    mode, exactly like web's `disabled={!isGateway}` fieldset — including the
 *    TLS switch, which web had to disable explicitly because an ARIA switch is
 *    not deactivated by a native `<fieldset disabled>`.
 *  - The auth token field NEVER renders the mask sentinel. A saved token shows
 *    an empty field with a "saved" placeholder; leaving it untouched replays
 *    the sentinel on submit so the server preserves the stored value, and any
 *    keystroke drops that intent (`lib/openclaw-routing.ts`).
 *  - Port accepts only a digit string (or empty = inherit from the daemon
 *    host). Invalid input disables Save and says why.
 *  - Save writes `{ runtime_config }` through `PUT /api/agents/{id}` and is
 *    disabled until the form is dirty, the port parses, and the agent row came
 *    out of a settled read.
 *
 * Divergence from web (documented): no toast infrastructure on mobile — a
 * successful save is reported by the form going clean again, and failures
 * surface as an Alert, matching the env / custom-args screens.
 */
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { OpenclawRuntimeConfig } from "@multica/core/agents";
import {
  parseOpenclawRuntimeConfig,
  serializeOpenclawRuntimeConfig,
} from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import { agentListAllOptions } from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useUpdateAgent } from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { recordRead } from "@/lib/catalog-read";
import {
  openclawRoutingAvailability,
  type OpenclawRoutingAvailability,
} from "@/lib/openclaw-routing-availability";
import {
  canSaveRouting,
  isGatewayBlockEnabled,
  isRoutingFormDirty,
  isRoutingPortValid,
  routingConfigToForm,
  routingFormToConfig,
  type OpenclawRoutingForm,
} from "@/lib/openclaw-routing";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function AgentRoutingPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const agents = useQuery(agentListAllOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  const agent = agents.data?.find((a) => a.id === id);
  const read = recordRead(agent, [agents]);
  const saveAgent = useUpdateAgent(id ?? "");

  const runtime =
    runtimes.data?.find((r) => r.id === agent?.runtime_id) ?? null;
  const availability: OpenclawRoutingAvailability = agent
    ? openclawRoutingAvailability({
        agent,
        runtime,
        runtimesSettled: runtimes.isSuccess,
        runtimesFailed: runtimes.isError,
      })
    : { state: "pending" };

  // The server's config, parsed once per agent revision. Everything the dirty
  // check compares against comes from here — never from the live form — or the
  // check would compare the form to itself and always report clean.
  const original = useMemo<OpenclawRuntimeConfig>(
    () => parseOpenclawRuntimeConfig(agent?.runtime_config),
    [agent?.runtime_config],
  );

  // Page-local form state, seeded once per agent. A background refetch must
  // never clobber in-progress edits (same rule as env.tsx / custom-args.tsx).
  const [state, setState] = useState<OpenclawRoutingForm | null>(null);
  const [seededId, setSeededId] = useState<string | null>(null);
  if (agent && seededId !== agent.id) {
    setSeededId(agent.id);
    setState(routingConfigToForm(original));
  }

  const form = state ?? routingConfigToForm(original);
  const portValid = isRoutingPortValid(form.port);
  const dirty = isRoutingFormDirty(original, form);
  const gatewayEnabled = isGatewayBlockEnabled(form);
  const canSave = canSaveRouting({
    dirty,
    portValid,
    readSettled: read.isResolved,
    saving: saveAgent.isPending,
  });

  const patch = useCallback((next: Partial<OpenclawRoutingForm>) => {
    setState((current) => (current ? { ...current, ...next } : current));
  }, []);

  const handleSave = useCallback(async () => {
    // Defence in depth: the button is already disabled, but the payload
    // replaces `runtime_config` wholesale, so a save must never be reachable
    // from a form that was not seeded off a settled read.
    if (!agent || !read.isResolved) return;
    try {
      const cfg = routingFormToConfig(form);
      // Serialize through core, not `cfg` directly. Core is the side that knows
      // the wire shape: it drops an empty gateway block entirely and only emits
      // `tls: true`, so a "Local" save leaves no endpoint litter on the record
      // and a partial pin stays partial. Posting the typed object happened to
      // work for a fully-filled gateway, which is exactly the case a manual
      // check covers — the half-filled ones are where it drifts.
      const resp = await saveAgent.mutateAsync({
        runtime_config: serializeOpenclawRuntimeConfig(cfg),
      });
      // Reseed from what the SERVER returned. Two things only the server knows
      // land here: the mask sentinel it substituted for the token we just sent,
      // and any normalization it applied. Reseeding from the local value left
      // the field showing a token the server had already replaced with "***",
      // so the next save would replay a secret the user had rotated away.
      setState(routingConfigToForm(parseOpenclawRuntimeConfig(resp.runtime_config)));
    } catch (err) {
      Alert.alert(
        t("agents.routing.saveFailedTitle"),
        err instanceof Error && err.message
          ? err.message
          : t("agents.routing.saveFailedMessage"),
      );
    }
  }, [agent, read.isResolved, form, saveAgent, t]);

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

  // The routing config only means something for an OpenClaw runtime. Every
  // non-shown state says what it knows rather than rendering a form gated on a
  // provider the surface never read — see the module doc on the availability
  // states.
  if (availability.state !== "shown") {
    if (availability.state === "pending") {
      return (
        <View className="flex-1 justify-center bg-background">
          <CatalogStatus
            state="loading"
            onRetry={() => {
              void runtimes.refetch();
            }}
            layout="centered"
          />
        </View>
      );
    }
    if (availability.state === "failed") {
      return (
        <View className="flex-1 justify-center bg-background">
          <CatalogStatus
            state="error"
            onRetry={() => {
              void runtimes.refetch();
            }}
            layout="centered"
          />
        </View>
      );
    }
    return (
      <View className="flex-1 justify-center bg-background px-6 gap-2">
        <Ionicons
          name="git-network-outline"
          size={32}
          color={theme.mutedForeground}
          style={{ alignSelf: "center" }}
        />
        <Text className="text-title-sm font-medium text-foreground text-center pt-2">
          {availability.state === "unbound"
            ? t("agents.routing.unboundTitle")
            : t("agents.routing.notOpenclawTitle")}
        </Text>
        <Text className="text-caption text-muted-foreground text-center leading-5">
          {availability.state === "unbound"
            ? t("agents.routing.unboundBody")
            : t("agents.routing.notOpenclawBody")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="px-4 pt-4 text-caption text-muted-foreground leading-5">
        {t("agents.routing.intro")}
      </Text>

      {/* Routing mode */}
      <View className="px-4 pt-5 gap-2">
        <Text className="text-caption font-medium text-foreground">
          {t("agents.routing.modeLabel")}
        </Text>
        <SegmentedControl
          value={form.mode}
          onChange={(mode) => {
            // Switching modes drops the masked-replay flag. Without this a
            // gateway → local → gateway round trip re-arms the sentinel
            // replay and silently restores a token the user meant to drop.
            patch({ mode, tokenWasMasked: false });
          }}
          options={[
            { value: "local", label: t("agents.routing.modeLocal") },
            { value: "gateway", label: t("agents.routing.modeGateway") },
          ]}
        />
        <Text className="text-caption text-muted-foreground leading-5">
          {gatewayEnabled
            ? t("agents.routing.modeGatewayHint")
            : t("agents.routing.modeLocalHint")}
        </Text>
      </View>

      {/* Gateway endpoint */}
      <View
        className="mx-4 mt-4 rounded-md border border-border p-3 gap-3"
        style={gatewayEnabled ? undefined : { opacity: 0.5 }}
      >
        <Text className="text-caption font-medium text-muted-foreground">
          {t("agents.routing.gatewayLegend")}
        </Text>

        <View className="gap-1.5">
          <Text className="text-caption text-muted-foreground">
            {t("agents.routing.hostLabel")}
          </Text>
          <TextField
            value={form.host}
            onChangeText={(host) => patch({ host })}
            placeholder={t("agents.routing.hostPlaceholder")}
            accessibilityLabel={t("agents.routing.hostLabel")}
            editable={gatewayEnabled && !saveAgent.isPending}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            className="font-mono"
          />
        </View>

        <View className="gap-1.5">
          <Text className="text-caption text-muted-foreground">
            {t("agents.routing.portLabel")}
          </Text>
          <TextField
            value={form.port}
            onChangeText={(port) => patch({ port })}
            placeholder={t("agents.routing.portPlaceholder")}
            accessibilityLabel={t("agents.routing.portLabel")}
            editable={gatewayEnabled && !saveAgent.isPending}
            keyboardType="number-pad"
            invalid={!portValid}
            className="font-mono"
          />
          {portValid ? null : (
            <Text className="text-caption" style={{ color: theme.destructive }}>
              {t("agents.routing.portInvalid")}
            </Text>
          )}
        </View>

        <View className="gap-1.5">
          <Text className="text-caption text-muted-foreground">
            {t("agents.routing.tokenLabel")}
          </Text>
          <TextField
            value={form.token}
            onChangeText={(token) =>
              // A keystroke means the user is now stating the value they want:
              // drop the masked-replay flag so an emptied field genuinely
              // clears the persisted token instead of preserving it.
              patch({ token, tokenWasMasked: false })
            }
            placeholder={
              form.tokenWasMasked
                ? t("agents.routing.tokenMaskedPlaceholder")
                : t("agents.routing.tokenPlaceholder")
            }
            accessibilityLabel={t("agents.routing.tokenLabel")}
            editable={gatewayEnabled && !saveAgent.isPending}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
          />
        </View>

        <View className="flex-row items-center justify-between gap-2 pt-1">
          <View className="flex-1">
            <Text className="text-caption text-muted-foreground">
              {t("agents.routing.tlsLabel")}
            </Text>
            <Text className="text-caption text-muted-foreground/80 leading-5">
              {t("agents.routing.tlsHint")}
            </Text>
          </View>
          <Switch
            checked={form.tls}
            // Explicit gate: the dimmed container does not deactivate a press
            // target, so without this the TLS switch stays live in Local mode.
            disabled={!gatewayEnabled || saveAgent.isPending}
            onCheckedChange={(tls) => patch({ tls })}
          />
        </View>
      </View>

      <View className="flex-row items-center gap-3 px-4 pt-5">
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
