/**
 * Onboarding flow — first-run setup + create-workspace, aligned with web
 * `packages/views/onboarding/` (MYS-371).
 *
 * Two modes (route param `mode`, default `first_run`):
 *   - first_run     [welcome → about-you → workspace → runtime] — entry from
 *     select-workspace's "start onboarding" banner (new users) or the
 *     welcome welcome/skip path. Finishes by calling
 *     `markOnboardingComplete` and entering the newly created workspace.
 *   - new_workspace [workspace] — entry from select-workspace empty-state or
 *     the switch-workspace "+ create new workspace" button. Creating enters
 *     the new workspace immediately; the user is already onboarded so no
 *     completion call happens.
 *
 * Step semantics mirror web's steps but mobile-first:
 *   welcome    → StepWelcome  (one-shot intro, skip when workspace exists)
 *   about-you  → StepAboutYou (display name via updateMe, skippable)
 *   workspace  → StepWorkspace(name → auto-slug via deriveSlug, description)
 *   runtime    → StepRuntimeConnect, light version: tells the user to run
 *                `multica daemon` on a computer and skip; no CLI install UI.
 *
 * Auth-required but workspace-less, so it lives under (app) next to
 * select-workspace.
 */
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { Workspace } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Button } from "@/components/ui/button";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { api, ApiError } from "@/data/api";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { WORKSPACE_SLUG_REGEX, deriveSlug } from "@/lib/workspace-slug";
import { keyboardBehavior } from "@/lib/keyboard";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

const FIRST_RUN_STEPS = ["welcome", "about-you", "workspace", "runtime"] as const;
const NEW_WORKSPACE_STEPS = ["workspace"] as const;
type StepName = "welcome" | "about-you" | "workspace" | "runtime";

function workspaceErrorLabel(err: unknown, t: (id: string) => string): string {
  if (err instanceof ApiError && err.status === 409) {
    return t("onboarding.workspace.slugConflict");
  }
  const base = t("onboarding.workspace.createFailed");
  return err instanceof Error && err.message
    ? `${base}: ${err.message}`
    : base;
}

export default function OnboardingRoute() {
  const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
  const isFirstRun = rawMode === "new_workspace" ? false : true;
  const steps: readonly StepName[] = isFirstRun
    ? FIRST_RUN_STEPS
    : NEW_WORKSPACE_STEPS;
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];

  const { t } = useTranslation();
  const setUser = useAuthStore((s) => s.setUser);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const tint = THEME[colorScheme];

  // Needed for the welcome "skip to my existing workspace" exit.
  const { data: workspaces } = useQuery(workspaceListOptions());

  // Created mid-flow; drives navigation on the runtime step.
  const [created, setCreated] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);

  /** Enter a workspace: sync the auth-free workspace store, make the
   *  workspace visible to [workspace]/_layout's membership check
   *  immediately (the list query refetches in the background), then
   *  `router.replace` INTO it. Replace (not dismissTo) is the proven
   *  navigation here: the target href mounts a fresh [workspace] stack, so
   *  any sheet beneath (switch-workspace formSheet) is discarded with the
   *  old stack — same pattern as select-workspace/switch-workspace
   *  switching. */
  const enterWorkspace = async (ws: Workspace) => {
    await setCurrentWorkspace(ws.id, ws.slug);
    qc.setQueryData(["workspaces"], (old: Workspace[] | undefined) =>
      old?.some((w) => w.id === ws.id) ? old : [...(old ?? []), ws],
    );
    void qc.invalidateQueries({ queryKey: ["workspaces"] });
    router.replace(`/${ws.slug}/inbox`);
  };

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));

  const onBack = () => {
    // After a workspace exists, backing out of the runtime step would
    // remount the (now stale) create form and a re-submit would 409 — the
    // "Done" CTA is the only exit from that step.
    if (step === "runtime" && created) return;
    if (stepIndex > 0) setStepIndex((i) => i - 1);
    else if (router.canGoBack()) router.back();
  };

  /** First-run exits: mark onboarding complete server-side (best-effort —
   *  navigation still proceeds, next launch re-offers the entry) and head
   *  into the created workspace. */
  const finishFirstRun = async (workspaceId?: string) => {
    try {
      const updated = await api.markOnboardingComplete({
        completion_path: "mobile_onboarding",
        workspace_id: workspaceId,
      });
      // Guard against a drifted (EMPTY_USER) response — writing id:"" into
      // the auth store would leave the app half-logged-in.
      if (updated.id) setUser(updated);
    } catch {
      // Best-effort — the flow still delivers the user into their workspace.
    }
  };

  const onFinish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isFirstRun) await finishFirstRun(created?.id);
      if (created) await enterWorkspace(created);
      else router.replace("/select-workspace");
    } finally {
      setBusy(false);
    }
  };

  /** Welcome-step "I've done this before": complete onboarding without
   *  creating a workspace and enter the first existing one. */
  const skipToExisting = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isFirstRun) {
        try {
          const updated = await api.markOnboardingComplete({
            completion_path: "skip_existing",
          });
          if (updated.id) setUser(updated);
        } catch {
          // Best-effort.
        }
      }
      const list = await qc.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const existing = list[0];
      if (existing) await enterWorkspace(existing);
      else router.replace("/select-workspace");
    } finally {
      setBusy(false);
    }
  };

  const hasExisting = (workspaces?.length ?? 0) > 0;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior={keyboardBehavior}>
        {/* Header: back exits the flow on the first step, walks back one
            step otherwise. Hidden on the welcome screen of a fresh flow. */}
        <View className="flex-row items-center px-4 pt-1 pb-1 min-h-[44]">
          {(stepIndex > 0 || router.canGoBack()) && (
            <Pressable
              onPress={onBack}
              hitSlop={8}
              className="flex-row items-center gap-0.5 -ml-1 pr-3 py-1"
              accessibilityLabel={t("onboarding.back")}
            >
              <Ionicons name="chevron-back" size={22} color={tint.foreground} />
              <Text className="text-sm text-foreground">{t("onboarding.back")}</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-6 pb-10"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === "welcome" && (
            <WelcomeStep
              onNext={goNext}
              onSkip={hasExisting ? () => void skipToExisting() : undefined}
            />
          )}
          {step === "about-you" && (
            <AboutYouStep onNext={goNext} />
          )}
          {step === "workspace" && (
            <WorkspaceStep
              isFirstRun={isFirstRun}
              hasExisting={hasExisting}
              onCreated={(ws) => {
                setCreated(ws);
                if (!isFirstRun) void enterWorkspace(ws);
                else goNext();
              }}
              onSkipExisting={hasExisting ? () => void skipToExisting() : undefined}
            />
          )}
          {step === "runtime" && (
            <RuntimeStep
              busy={busy}
              onNext={() => void onFinish()}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepHeader({
  titleKey,
  ledeKey,
}: {
  titleKey: string;
  ledeKey?: string;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2 items-center mb-6">
      <Text className="text-2xl font-semibold text-foreground text-center">
        {t(titleKey)}
      </Text>
      {ledeKey ? (
        <Text className="text-sm text-muted-foreground text-center">
          {t(ledeKey)}
        </Text>
      ) : null}
    </View>
  );
}

function WelcomeStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center gap-6 pt-10">
      <MulticaLogo size={56} />
      <View className="items-center gap-2">
        <Text className="text-2xl font-semibold text-foreground text-center">
          {t("onboarding.welcome.heading")}
        </Text>
        <Text className="text-sm text-muted-foreground text-center max-w-[300]">
          {t("onboarding.welcome.lede")}
        </Text>
      </View>
      <View className="w-full gap-3 mt-4">
        <Button size="lg" onPress={onNext}>
          <Text>{t("onboarding.welcome.start")}</Text>
        </Button>
        {onSkip ? (
          <Button variant="ghost" onPress={onSkip}>
            <Text>{t("onboarding.welcome.skip")}</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function AboutYouStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { colorScheme } = useColorScheme();
  const tint = THEME[colorScheme];
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      onNext();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateMe({ name: trimmed });
      setUser(updated);
      onNext();
    } catch {
      setError(t("onboarding.aboutYou.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="gap-6 pt-6">
      <StepHeader
        titleKey="onboarding.aboutYou.title"
        ledeKey="onboarding.aboutYou.lede"
      />
      <View className="gap-3">
        <TextField
          autoFocus
          placeholder={t("onboarding.aboutYou.placeholder")}
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => void save()}
          returnKeyType="done"
          editable={!saving}
          invalid={!!error}
        />
        {error ? (
          <Text className="text-sm text-destructive">{error}</Text>
        ) : null}
        <View className="flex-row gap-3 mt-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={saving}
            onPress={onNext}
          >
            <Text>{t("onboarding.aboutYou.skip")}</Text>
          </Button>
          <Button className="flex-1" disabled={saving} onPress={() => void save()}>
            {saving ? (
              <ActivityIndicator size="small" color={tint.primaryForeground} />
            ) : (
              <Text>{t("onboarding.aboutYou.continue")}</Text>
            )}
          </Button>
        </View>
      </View>
    </View>
  );
}

function WorkspaceStep({
  isFirstRun,
  hasExisting,
  onCreated,
  onSkipExisting,
}: {
  isFirstRun: boolean;
  hasExisting: boolean;
  onCreated: (ws: Workspace) => void;
  onSkipExisting?: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const slugTouched = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Slug follows the name until the user edits it by hand.
  const onNameChange = (text: string) => {
    setName(text);
    if (formError) setFormError(null);
    if (!slugTouched.current) setSlug(deriveSlug(text));
  };
  const onSlugChange = (text: string) => {
    slugTouched.current = true;
    if (formError) setFormError(null);
    // Keep the field valid as they type — the server lowercases anyway and
    // the regex only admits lowercase.
    setSlug(text.toLowerCase());
  };

  const create = async () => {
    if (submitting) return;
    setFormError(null);
    const slugVal = slug.trim();
    if (!name.trim()) {
      setFormError(t("onboarding.workspace.nameRequired"));
      return;
    }
    if (!slugVal) {
      setFormError(t("onboarding.workspace.slugRequired"));
      return;
    }
    if (!WORKSPACE_SLUG_REGEX.test(slugVal)) {
      setFormError(t("onboarding.workspace.slugInvalid"));
      return;
    }
    setSubmitting(true);
    try {
      const ws = await api.createWorkspace({
        name: name.trim(),
        slug: slugVal,
        description: description.trim() || undefined,
      });
      onCreated(ws);
    } catch (err) {
      setFormError(workspaceErrorLabel(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="gap-6 pt-6">
      <StepHeader
        titleKey="onboarding.workspace.title"
        ledeKey="onboarding.workspace.lede"
      />
      <View className="gap-4">
        <View className="gap-1.5">
          <Text className="text-sm font-medium text-foreground">
            {t("onboarding.workspace.nameLabel")}
          </Text>
          <TextField
            placeholder={t("onboarding.workspace.namePlaceholder")}
            value={name}
            onChangeText={onNameChange}
            editable={!submitting}
            onSubmitEditing={() => void create()}
            returnKeyType="next"
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-sm font-medium text-foreground">
            {t("onboarding.workspace.slugLabel")}
          </Text>
          <TextField
            placeholder={t("onboarding.workspace.slugPlaceholder")}
            value={slug}
            onChangeText={onSlugChange}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
            invalid={!!formError}
          />
          <Text className="text-xs text-muted-foreground">
            {t("onboarding.workspace.slugHint")}
          </Text>
        </View>
        <View className="gap-1.5">
          <Text className="text-sm font-medium text-foreground">
            {t("onboarding.workspace.descriptionLabel")}
          </Text>
          <AutosizeTextArea
            minHeight={60}
            placeholder={t("onboarding.workspace.descriptionPlaceholder")}
            value={description}
            onChangeText={setDescription}
            editable={!submitting}
            className="border rounded-md px-3 py-2 text-sm text-foreground"
          />
        </View>

        {formError ? (
          <Text className="text-sm text-destructive">{formError}</Text>
        ) : null}

        <Button size="lg" disabled={submitting} onPress={() => void create()}>
          <Text>{submitting ? t("onboarding.workspace.creating") : t("onboarding.workspace.create")}</Text>
        </Button>
        {isFirstRun && hasExisting && onSkipExisting ? (
          <Button variant="ghost" disabled={submitting} onPress={onSkipExisting}>
            <Text>{t("onboarding.workspace.skipExisting")}</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function RuntimeStep({
  busy,
  onNext,
}: {
  busy: boolean;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const tint = THEME[colorScheme];
  return (
    <View className="gap-6 pt-6">
      <StepHeader
        titleKey="onboarding.runtime.title"
        ledeKey="onboarding.runtime.lede"
      />
      <View className="gap-3 rounded-lg border border-border p-4 bg-secondary/40">
        <Text className="text-sm text-foreground">
          {`1. ${t("onboarding.runtime.step1")}`}
        </Text>
        <Text className="text-sm text-foreground">
          {`2. ${t("onboarding.runtime.step2")}`}
        </Text>
        <Text className="text-sm text-foreground">
          {`3. ${t("onboarding.runtime.step3")}`}
        </Text>
      </View>
      <Text className="text-xs text-muted-foreground text-center">
        {t("onboarding.runtime.later")}
      </Text>
      <Button size="lg" disabled={busy} onPress={onNext}>
        {busy ? (
          <ActivityIndicator size="small" color={tint.primaryForeground} />
        ) : (
          <Text>{t("onboarding.runtime.done")}</Text>
        )}
      </Button>
    </View>
  );
}