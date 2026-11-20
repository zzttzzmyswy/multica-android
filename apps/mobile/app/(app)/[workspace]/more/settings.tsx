/**
 * Settings page — account info, workspace switching, appearance, profile and
 * notifications subscreens, and sign out.
 *
 * Inherits the responsibilities the old More tab carried (account row,
 * workspace list, sign-out button) now that the More tab is gone and global
 * navigation lives in GlobalNavMenu.
 *
 * Subscreens push under more/settings/:
 *   - more/settings/profile        — edit name + avatar
 *   - more/settings/notifications  — per-group inbox + system toggles
 *
 * Theme picker stays inline (3 fixed options, fits in one section).
 */
import { useReducer, useState, type ComponentProps } from "react";
import { Alert, ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Workspace } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WorkspaceChoiceRow } from "@/components/workspace/workspace-choice-row";
import { SettingsTimezonePicker } from "@/components/settings/timezone-picker";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useFeatureEnabled } from "@/data/queries/config";
import { BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG } from "@/lib/billing-capability";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme, type ThemePreference } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { getSavedLocaleOverride, resetLocale, setLocale } from "@/lib/i18n";
import { LANGUAGE_OPTIONS, languageOptionForSaved, serverLanguageFor, type LanguageOptionId } from "@/lib/settings-language";
import { resolveViewingTimezone, timezoneLabel } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

const THEME_OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
  { value: "system", labelKey: "settings.themeSystem" },
];

function initialsOf(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function SettingsPage() {
  const palette = useThemePalette();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const currentSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const clearWorkspace = useWorkspaceStore((s) => s.clear);
  const { data, isLoading, error } = useQuery(workspaceListOptions());
  const { preference, setPreference } = useColorScheme();
  const mutedFg = palette.mutedForeground;
  const { t } = useTranslation();
  // The language picker's value is derived from the i18n override store, so a
  // switch to "Follow system" that leaves the effective locale unchanged (e.g.
  // device language is already en) would skip the subscription re-render and
  // keep the old radio highlight. bump() forces one render after switching.
  const activeLanguage = languageOptionForSaved(getSavedLocaleOverride());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const effectiveTimezone = resolveViewingTimezone(user);

  const onSwitch = async (ws: Workspace) => {
    if (ws.slug === currentSlug) return;
    await setCurrentWorkspace(ws.id, ws.slug);
    router.replace(`/${ws.slug}/inbox`);
  };

  const onSignOut = () => {
    Alert.alert(t("settings.signOutTitle"), t("settings.signOutMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.signOutTitle"),
        style: "destructive",
        onPress: async () => {
          await clearWorkspace();
          await logout();
        },
      },
    ]);
  };

  const goProfile = () => router.push(`/${currentSlug}/more/settings/profile`);
  const goNotifications = () =>
    router.push(`/${currentSlug}/more/settings/notifications`);
  const goTokens = () => router.push(`/${currentSlug}/more/settings/tokens`);
  const goIssueSettings = () =>
    router.push(`/${currentSlug}/more/settings/issues`);
  // Settings → Wakeups (MYS-2043): the platform rule's workspace default.
  // Web hangs this off its settings Tabs; mobile's settings page is a list of
  // push screens, so it is one more row.
  const goWakeups = () => router.push(`/${currentSlug}/more/settings/wakeups`);
  const goWorkspaceSettings = () =>
    router.push(`/${currentSlug}/more/settings/workspace`);
  const goBilling = () => router.push(`/${currentSlug}/more/settings/billing`);
  const goPlugins = () => router.push(`/${currentSlug}/more/settings/plugins`);
  // Feedback page = web HelpLauncher + FeedbackModal as a push screen
  // (iteration-100): Feedback submit + Docs/Changelog/Discord external links
  // + server version, mirroring the web help menu.
  const goFeedback = () => router.push(`/${currentSlug}/more/settings/feedback`);
  // Settings → Workflows (iteration 294): the pipelines themselves — create,
  // rename, add/remove/reorder columns, delete. Web renders this as a settings
  // tab (`WorkflowsTab`); mobile's settings is a list of push screens, so it is
  // one row above the status library it draws from.
  const goWorkflows = () =>
    router.push(`/${currentSlug}/more/settings/workflows`);
  // Settings → Appearance → text size and line spacing (iteration 296).
  const goTextAppearance = () =>
    router.push(`/${currentSlug}/more/settings/appearance`);
  const goIssueStatuses = () =>
    router.push(`/${currentSlug}/more/settings/issue-statuses`);
  const goProperties = () =>
    router.push(`/${currentSlug}/more/properties`);
  // Plugins is flag-gated server-side (`plugins_v1` via /api/config
  // frontendPublicFlags) exactly like web's settings-page — the entry only
  // exists on deployments that enable the Plugin catalog (iteration-99).
  const pluginsEnabled = useFeatureEnabled("plugins_v1");
  // Billing is a *deployment capability*, gated exactly like web's settings
  // page (`settings-page.tsx:141`): with `billing_workspace_subscriptions` off
  // the tab leaves web's visible list and a `?tab=billing` deep link is
  // redirected to `workspace`. The server enforces it as a hard gate too —
  // every cloud-subscription endpoint answers 503
  // (`server/internal/handler/cloud_billing.go:76`). Rendering this row
  // regardless (iteration-209 fix) sent the user to a page whose only possible
  // outcome was a failed read labelled "temporarily unavailable".
  const billingEnabled = useFeatureEnabled(
    BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG,
  );

  // Language follows the theme picker's tap-to-act pattern. The local switch
  // takes effect immediately (setLocale/resetLocale persist + notify), and
  // the PATCH /api/me sync is best-effort — same contract as web
  // preferences-tab, where a failed sync warns but never blocks the change.
  const onLanguageChange = async (option: LanguageOptionId) => {
    const current = languageOptionForSaved(getSavedLocaleOverride());
    if (option === current) return;

    if (option === "system") {
      await resetLocale();
    } else {
      setLocale(option);
    }
    bump();

    const serverLang = serverLanguageFor(option);
    if (serverLang) {
      api
        .updateMe({ language: serverLang })
        .then((updated) => setUser(updated))
        .catch(() => {
          Alert.alert(t("settings.languageSyncFailed"));
        });
    }
  };

  // Timezone follows the same best-effort sync contract as the language
  // picker: the server update is fire-and-forget, a failure is surfaced as a
  // readable alert, and the row reflects the stored preference immediately.
  // Selecting "Follow system" (null) clears the preference with `""` — web's
  // TimezoneRow payload semantics (`""` falls back to the device zone).
  const onTimezoneSelect = async (tz: string | null) => {
    setTimezoneOpen(false);
    const stored = user?.timezone ?? null;
    if (tz === stored) return;
    try {
      const updated = await api.updateMe({ timezone: tz ?? "" });
      setUser(updated);
    } catch {
      Alert.alert(t("settings.timezoneSyncFailed"));
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-4 pt-4 pb-8"
    >
      <SectionGroup title={t("settings.account")}>
        <NavRow
          onPress={goProfile}
          chevronColor={mutedFg}
          prominent
          leading={
            <Avatar alt={user?.name ?? t("settings.accountSettings")} className="size-10">
              {user?.avatar_url ? (
                <AvatarImage source={{ uri: user.avatar_url }} />
              ) : null}
              <AvatarFallback>
                <Text className="text-body font-semibold text-muted-foreground">
                  {initialsOf(user?.name)}
                </Text>
              </AvatarFallback>
            </Avatar>
          }
          title={user?.name ?? "—"}
          subtitle={user?.email}
        />
        <Separator />
        <NavRow
          onPress={goNotifications}
          chevronColor={mutedFg}
          icon="notifications-outline"
          title={t("settings.notifications")}
          subtitle={t("settings.notificationsSub")}
        />
        <Separator />
        <NavRow
          onPress={goIssueSettings}
          chevronColor={mutedFg}
          icon="list-outline"
          title={t("settings.issueTitle")}
          subtitle={t("settings.issueSubtitle")}
        />
        <Separator />
        <NavRow
          onPress={goWakeups}
          chevronColor={mutedFg}
          icon="alarm-outline"
          title={t("settings.wakeups.title")}
          subtitle={t("settings.wakeups.subtitle")}
        />
        <Separator />
        <NavRow
          onPress={goTokens}
          chevronColor={mutedFg}
          icon="key-outline"
          title={t("settings.apiTokens")}
          subtitle={t("settings.apiTokensSub")}
        />
      </SectionGroup>

      <SectionGroup title={t("settings.workspaces")}>
        {isLoading ? (
          <View className="py-4 items-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="p-4">
            <Text className="text-body text-destructive">
              {t("settings.workspacesLoadError")}
            </Text>
          </View>
        ) : (
          data?.map((ws) => {
            const isActive = ws.slug === currentSlug;
            return (
              <View key={ws.id}>
                <WorkspaceChoiceRow
                  workspace={ws}
                  active={isActive}
                  onPress={() => onSwitch(ws)}
                />
                <Separator />
              </View>
            );
          })
        )}
        <NavRow
          onPress={goWorkflows}
          chevronColor={mutedFg}
          icon="git-branch-outline"
          title={t("settings.workflowsTitle")}
          subtitle={t("settings.workflowsSubtitle")}
        />
        <Separator />
        <NavRow
          onPress={goIssueStatuses}
          chevronColor={mutedFg}
          icon="git-commit-outline"
          title={t("settings.issueStatusesTitle")}
          subtitle={t("settings.issueStatusesSubtitle")}
        />
        <Separator />
        <NavRow
          onPress={goProperties}
          chevronColor={mutedFg}
          icon="options-outline"
          title={t("settings.propertiesTitle")}
          subtitle={t("settings.propertiesSubtitle")}
        />
        <Separator />
        <NavRow
          onPress={goWorkspaceSettings}
          chevronColor={mutedFg}
          icon="settings-outline"
          title={t("settings.workspaceSettings")}
          subtitle={t("settings.workspaceSettingsSub")}
        />
        {billingEnabled ? (
          <>
            <Separator />
            <NavRow
              onPress={goBilling}
              chevronColor={mutedFg}
              icon="card-outline"
              title={t("screen.billing")}
              subtitle={t("billing.description")}
            />
          </>
        ) : null}
        {pluginsEnabled ? (
          <>
            <Separator />
            <NavRow
              onPress={goPlugins}
              chevronColor={mutedFg}
              icon="cube-outline"
              title={t("plugins.title")}
              subtitle={t("plugins.description")}
            />
          </>
        ) : null}
      </SectionGroup>

      <SectionGroup title={t("settings.appearance")}>
        {/* Two converging entry points by design, NOT a double-fire:
              - Tap on small radio circle  → RadioGroupItem (Pressable, inner) consumes → onValueChange fires
              - Tap on text / row padding  → outer Pressable.onPress fires
            RN's responder system gives inner Pressable priority, so each tap
            triggers exactly one setPreference. Both paths land at the same
            handler intentionally — the Pressable wrapper exists only to
            extend the tap target to the full row (iOS standard). */}
        <RadioGroup
          value={preference}
          onValueChange={(v) => setPreference(v as ThemePreference)}
          className="gap-0"
        >
          {THEME_OPTIONS.map((opt, idx) => {
            const isLast = idx === THEME_OPTIONS.length - 1;
            return (
              <View key={opt.value}>
                <Pressable
                  onPress={() => setPreference(opt.value)}
                  className={cn(
                    "min-h-12 flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                    opt.value === preference && "bg-brand/10",
                  )}
                >
                  <RadioGroupItem value={opt.value} />
                  <Text className="flex-1 text-title-sm font-medium text-foreground">
                    {t(opt.labelKey)}
                  </Text>
                </Pressable>
                {!isLast ? <Separator /> : null}
              </View>
            );
          })}
        </RadioGroup>
        {/* Text size and line spacing (MYS-2931). Web has these as two rows
            inside its single Appearance tab; mobile's settings is a list of
            push screens, so they get one row that opens a sub-screen — the
            same shape iteration 294 used for Workflows. Kept inside the
            Appearance section because they ARE appearance, and a reader
            looking for "make the text bigger" looks here first. */}
        <Separator />
        <NavRow
          onPress={goTextAppearance}
          chevronColor={mutedFg}
          icon="text-outline"
          title={t("settings.appearance.typeTitle")}
          subtitle={t("settings.appearance.typeSubtitle")}
        />
      </SectionGroup>

      <SectionGroup title={t("settings.language")}>
        {/* Same convergent-tap structure as the theme picker above: choosing a
            language pins it (setLocale, persisted + synced to user.language);
            "Follow system" clears the pin and falls back to the device. */}
        <RadioGroup
          value={activeLanguage}
          onValueChange={(v) => void onLanguageChange(v as LanguageOptionId)}
          className="gap-0"
        >
          {LANGUAGE_OPTIONS.map((opt, idx) => {
            const isLast = idx === LANGUAGE_OPTIONS.length - 1;
            return (
              <View key={opt.id}>
                <Pressable
                  onPress={() => void onLanguageChange(opt.id)}
                  className={cn(
                    "min-h-12 flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                    opt.id === activeLanguage && "bg-brand/10",
                  )}
                >
                  <RadioGroupItem value={opt.id} />
                  <Text className="flex-1 text-title-sm font-medium text-foreground">
                    {t(opt.labelKey)}
                  </Text>
                </Pressable>
                {!isLast ? <Separator /> : null}
              </View>
            );
          })}
        </RadioGroup>
      </SectionGroup>

      <SectionGroup title={t("settings.timezoneTitle")}>
        <NavRow
          onPress={() => setTimezoneOpen(true)}
          chevronColor={mutedFg}
          icon="globe-outline"
          title={timezoneLabel(effectiveTimezone)}
          subtitle={user?.timezone ? undefined : t("settings.languageSystem")}
        />
      </SectionGroup>

      {/* Help & Feedback — web puts these in the global top-bar HelpLauncher
          dropdown (Docs/Changelog/Discord + Feedback + server version);
          mobile has no such global bar, so the same cluster lives here at
          the bottom of Settings as a footer-style section. */}
      <SectionGroup title={t("feedback.title")}>
        <NavRow
          onPress={goFeedback}
          chevronColor={mutedFg}
          icon="help-buoy-outline"
          title={t("feedback.title")}
          subtitle={t("feedback.entrySubtitle")}
        />
      </SectionGroup>

      <Button variant="outline" className="min-h-12 rounded-xl border-destructive/40" onPress={onSignOut}>
        <Text className="font-semibold text-destructive">{t("settings.signOutTitle")}</Text>
      </Button>

      <SettingsTimezonePicker
        visible={timezoneOpen}
        value={user?.timezone || null}
        onSelect={onTimezoneSelect}
        onClose={() => setTimezoneOpen(false)}
      />
    </ScrollView>
  );
}

function NavRow({
  onPress,
  leading,
  icon,
  prominent = false,
  title,
  subtitle,
  chevronColor,
}: {
  onPress: () => void;
  leading?: React.ReactNode;
  icon?: ComponentProps<typeof Ionicons>["name"];
  prominent?: boolean;
  title: string;
  subtitle?: string;
  chevronColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={cn(
        "min-h-14 flex-row items-center gap-3 px-3 py-3 active:bg-secondary",
        prominent && "bg-surface-1 py-4",
      )}
    >
      {leading ?? (icon ? (
        <View className="size-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
          <Ionicons name={icon} size={18} color={chevronColor} />
        </View>
      ) : null)}
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className={cn(
          "text-title-sm font-semibold text-foreground",
          prominent && "text-title",
        )}>{title}</Text>
        {subtitle ? (
          <Text className="text-caption text-muted-foreground">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={chevronColor} />
    </Pressable>
  );
}

function SectionGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-1 text-label font-semibold text-muted-foreground">
        {title}
      </Text>
      <View className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        {children}
      </View>
    </View>
  );
}
