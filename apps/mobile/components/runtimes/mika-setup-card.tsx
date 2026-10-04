/**
 * "Start with Mika" card + its runtime picker — mobile port of web
 * `packages/views/runtimes/components/runtimes-page.tsx:232-346`
 * (`MikaSetupCard` + `MikaRuntimeChoice`).
 *
 * Shown on the Runtimes page while `memberNeedsMikaSetup` is true. It is the
 * only surface on mobile that can mint a Mika — the generic agent-create form
 * cannot, since the server endpoint behind it accepts neither `kind` nor
 * `system_key`.
 *
 * Two deliberate mobile differences:
 *   - Web offers a runtime *and* a model dropdown. A phone stacks them as two
 *     rows of the same dialog and reuses `RuntimePickerSheet` (the agent-create
 *     form's picker) rather than growing a second one. The model row is
 *     optional: empty means "the runtime's default", which is what web sends
 *     when the member never opens the model dropdown.
 *   - The language comes from the app locale (`pickMikaContentLang`), not a
 *     picker. Web reads `i18n.language` the same way; it just has a locale
 *     switcher elsewhere on the page.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import type { RuntimeDevice } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { RuntimePickerSheet } from "@/components/agent/runtime-picker-sheet";
import { ModelPickerSheet } from "@/components/agent/model-picker-sheet";
import { runtimeModelsOptions } from "@/data/queries/runtimes";
import { usableRuntimes } from "@/lib/agent-create";
import { getMikaOnboarding, pickMikaContentLang } from "@/lib/mika-onboarding";
import { MIKA_PLACEHOLDER_EMOJI } from "@/lib/mika";
import { useTranslation, useAppLocale } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Props {
  runtimes: RuntimeDevice[];
  runtimesLoading?: boolean;
  currentUserId: string | null;
  /** Resolves once the two server steps are done. Rejects with the error the
   *  caller surfaces — the dialog stays open so the member can retry. */
  onStart: (input: { runtimeId: string; model: string }) => Promise<void>;
}

export function MikaSetupCard({
  runtimes,
  runtimesLoading = false,
  currentUserId,
  onStart,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [open, setOpen] = useState(false);

  return (
    <>
      <View className="mx-4 mb-4 rounded-xl border border-border bg-card p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <Text className="text-lg leading-none">{MIKA_PLACEHOLDER_EMOJI}</Text>
          </View>
          <View className="flex-1 min-w-0 gap-1">
            <Text className="text-sm font-semibold text-foreground">
              {t("runtimes.mikaSetup.title")}
            </Text>
            <Text className="text-xs leading-relaxed text-muted-foreground">
              {t("runtimes.mikaSetup.description")}
            </Text>
          </View>
        </View>
        <Button
          className="mt-3"
          onPress={() => setOpen(true)}
          accessibilityLabel={t("runtimes.mikaSetup.action")}
        >
          <Text>{t("runtimes.mikaSetup.action")}</Text>
        </Button>
      </View>
      <MikaSetupDialog
        visible={open}
        onClose={() => setOpen(false)}
        runtimes={runtimes}
        runtimesLoading={runtimesLoading}
        currentUserId={currentUserId}
        onStart={onStart}
        theme={theme}
      />
    </>
  );
}

/**
 * The two choices web asks for, as one full-screen modal.
 *
 * The runtime defaults to the first *usable* one (online + visible to this
 * member) rather than web's `runtimes[0]`, because mobile's list carries
 * offline rows the server would reject — but the choice stays visible and
 * changeable, which is the point web's comment makes: one machine commonly
 * exposes every CLI it has installed, so "the first one" must not be silent.
 */
function MikaSetupDialog({
  visible,
  onClose,
  runtimes,
  runtimesLoading,
  currentUserId,
  onStart,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  runtimes: RuntimeDevice[];
  runtimesLoading: boolean;
  currentUserId: string | null;
  onStart: (input: { runtimeId: string; model: string }) => Promise<void>;
  theme: (typeof THEME)["light"];
}) {
  const { t } = useTranslation();
  const locale = useAppLocale();
  const contentLang = pickMikaContentLang(locale);
  const onboarding = useMemo(() => getMikaOnboarding(contentLang), [contentLang]);

  const usable = useMemo(
    () => usableRuntimes(runtimes, currentUserId),
    [runtimes, currentUserId],
  );

  const [runtimeId, setRuntimeId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [runtimePickerOpen, setRuntimePickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = usable.find((r) => r.id === runtimeId) ?? null;
  // Seeded lazily rather than in an effect: a default that only exists while
  // the dialog is open cannot go stale behind the member's back.
  const effectiveRuntimeId = runtimeId ?? usable[0]?.id ?? null;
  const effectiveRuntime =
    selected ?? usable.find((r) => r.id === effectiveRuntimeId) ?? null;

  // Same gate the agent-create form uses: the catalog is a live daemon round
  // trip, so it is only asked for an online runtime and never retried.
  const modelsQuery = useQuery({
    ...runtimeModelsOptions(effectiveRuntime?.id ?? null),
    enabled:
      visible &&
      Boolean(effectiveRuntime?.id) &&
      effectiveRuntime?.status === "online",
  });
  const catalogModels = modelsQuery.data?.models ?? [];

  const handleStart = async () => {
    if (!effectiveRuntimeId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onStart({ runtimeId: effectiveRuntimeId, model });
      onClose();
    } catch (err) {
      // The dialog stays open on purpose: both steps are idempotent, so the
      // honest recovery is a retry from here rather than sending the member
      // back to the page to find the card again.
      setError(
        err instanceof Error ? err.message : t("runtimes.mikaSetup.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background">
        <View className="border-b border-border px-4 py-3 flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Text className="text-base leading-none">{MIKA_PLACEHOLDER_EMOJI}</Text>
          </View>
          <Text className="flex-1 text-base font-semibold text-foreground">
            {t("runtimes.mikaSetup.dialogTitle")}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityLabel={t("runtimes.mikaSetup.cancel")}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="px-4 py-4 gap-4">
          <Text className="text-xs leading-relaxed text-muted-foreground">
            {t("runtimes.mikaSetup.dialogDescription")}
          </Text>

          {runtimesLoading ? (
            <View className="py-8 items-center">
              <ActivityIndicator />
            </View>
          ) : usable.length === 0 ? (
            <View className="rounded-xl border border-border bg-secondary/30 px-4 py-4">
              <Text className="text-sm text-muted-foreground">
                {t("runtimes.mikaSetup.noRuntimes")}
              </Text>
            </View>
          ) : (
            <>
              <ChoiceRow
                label={t("runtimes.mikaSetup.runtimeLabel")}
                value={
                  effectiveRuntime
                    ? runtimeDisplayLabel(effectiveRuntime)
                    : t("runtimes.mikaSetup.pickRuntime")
                }
                onPress={() => setRuntimePickerOpen(true)}
                disabled={busy}
                theme={theme}
              />
              <ChoiceRow
                label={t("runtimes.mikaSetup.modelLabel")}
                value={model || t("runtimes.mikaSetup.modelDefault")}
                onPress={() => setModelPickerOpen(true)}
                disabled={busy || !effectiveRuntime}
                theme={theme}
              />
            </>
          )}

          {error ? (
            <Text className="text-sm text-destructive">{error}</Text>
          ) : null}
        </ScrollView>

        <View className="border-t border-border px-4 py-3 flex-row items-center justify-end gap-2">
          <Button variant="outline" onPress={onClose} disabled={busy}>
            <Text>{t("runtimes.mikaSetup.cancel")}</Text>
          </Button>
          <Button
            onPress={handleStart}
            disabled={busy || !effectiveRuntimeId}
            accessibilityLabel={t("runtimes.mikaSetup.action")}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.primaryForeground} />
            ) : null}
            <Text>{t("runtimes.mikaSetup.action")}</Text>
          </Button>
        </View>

        <RuntimePickerSheet
          visible={runtimePickerOpen}
          runtimes={usable}
          loading={runtimesLoading}
          selectedId={effectiveRuntimeId}
          onPick={(runtime) => {
            setRuntimeId(runtime.id);
            // Models are per-runtime, so a value chosen for the previous
            // runtime may not exist on this one (web resets it too).
            setModel("");
          }}
          onClose={() => setRuntimePickerOpen(false)}
        />
        <ModelPickerSheet
          visible={modelPickerOpen}
          models={catalogModels}
          loading={modelsQuery.isLoading}
          failed={modelsQuery.isError}
          value={model}
          onPick={(modelId) => setModel(modelId)}
          onClear={() => setModel("")}
          onClose={() => setModelPickerOpen(false)}
        />
      </View>
    </Modal>
  );
}

/** One label + value row that opens a picker. Same shape the agent-create
 *  form's runtime/model fields use, so the two surfaces read alike. */
function ChoiceRow({
  label,
  value,
  onPress,
  disabled,
  theme,
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
  theme: (typeof THEME)["light"];
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-medium text-muted-foreground">{label}</Text>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        className={cn(
          "flex-row items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2.5",
          disabled ? "opacity-50" : "active:opacity-70",
        )}
      >
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {value}
        </Text>
        <Ionicons name="chevron-down" size={14} color={theme.mutedForeground} />
      </Pressable>
    </View>
  );
}
