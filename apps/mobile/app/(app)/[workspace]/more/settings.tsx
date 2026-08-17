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
import { useReducer, useState } from "react";
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
import { SettingsTimezonePicker } from "@/components/settings/timezone-picker";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme, type ThemePreference } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import { getSavedLocaleOverride, resetLocale, setLocale } from "@/lib/i18n";
import { LANGUAGE_OPTIONS, languageOptionForSaved, serverLanguageFor, type LanguageOptionId } from "@/lib/settings-language";
import { resolveViewingTimezone, timezoneLabel } from "@/lib/timezone";
import { cn } from "@/lib/utils";

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
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const currentSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const clearWorkspace = useWorkspaceStore((s) => s.clear);
  const { data, isLoading, error } = useQuery(workspaceListOptions());
  const { preference, setPreference, colorScheme } = useColorScheme();
  const mutedFg = THEME[colorScheme].mutedForeground;
  const { t } = useTranslation();
  // The language picker's value is derived from the i18n override store, so a
  // switch to "Follow system" that leaves the effective locale unchanged (e.g.
  // device language is already en) would skip the subscription re-render and
  // keep the old radio highlight. bump() forces one render after switching.
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
  const goWorkspaceSettings = () =>
    router.push(`/${currentSlug}/more/settings/workspace`);

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
      contentContainerClassName="px-4 py-4 gap-6"
    >
      <SectionGroup title={t("settings.account")}>
        <NavRow
          onPress={goProfile}
          chevronColor={mutedFg}
          leading={
            <Avatar alt={user?.name ?? t("settings.accountSettings")} className="size-10">
              {user?.avatar_url ? (
                <AvatarImage source={{ uri: user.avatar_url }} />
              ) : null}
              <AvatarFallback>
                <Text className="text-sm font-semibold text-muted-foreground">
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
          title={t("settings.notifications")}
          subtitle={t("settings.notificationsSub")}
        />
        <Separator />
        <NavRow
          onPress={goIssueSettings}
          chevronColor={mutedFg}
          title={t("settings.issueTitle")}
          subtitle={t("settings.issueSubtitle")}
        />
        <Separator />
        <NavRow
          onPress={goTokens}
          chevronColor={mutedFg}
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
            <Text className="text-sm text-destructive">
              {t("settings.workspacesLoadError")}
            </Text>
          </View>
        ) : (
          data?.map((ws, idx) => {
            const isActive = ws.slug === currentSlug;
            const isLast = idx === (data?.length ?? 0) - 1;
            return (
              <View key={ws.id}>
                <WorkspaceRow
                  name={ws.name}
                  slug={ws.slug}
                  isActive={isActive}
                  iconColor={mutedFg}
                  onPress={() => onSwitch(ws)}
                />
                {!isLast ? <Separator /> : null}
              </View>
            );
          })
        )}
        <Separator />
        <NavRow
          onPress={goWorkspaceSettings}
          chevronColor={mutedFg}
          title={t("settings.workspaceSettings")}
          subtitle={t("settings.workspaceSettingsSub")}
        />
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
                  className="flex-row items-center px-4 py-3.5 active:bg-secondary gap-3"
                >
                  <RadioGroupItem value={opt.value} />
                  <Text className="flex-1 text-base font-medium text-foreground">
                    {t(opt.labelKey)}
                  </Text>
                </Pressable>
                {!isLast ? <Separator /> : null}
              </View>
            );
          })}
        </RadioGroup>
      </SectionGroup>

      <SectionGroup title={t("settings.language")}>
        {/* Same convergent-tap structure as the theme picker above: choosing a
            language pins it (setLocale, persisted + synced to user.language);
            "Follow system" clears the pin and falls back to the device. */}
        <RadioGroup
          value={languageOptionForSaved(getSavedLocaleOverride())}
          onValueChange={(v) => void onLanguageChange(v as LanguageOptionId)}
          className="gap-0"
        >
          {LANGUAGE_OPTIONS.map((opt, idx) => {
            const isLast = idx === LANGUAGE_OPTIONS.length - 1;
            return (
              <View key={opt.id}>
                <Pressable
                  onPress={() => void onLanguageChange(opt.id)}
                  className="flex-row items-center px-4 py-3.5 active:bg-secondary gap-3"
                >
                  <RadioGroupItem value={opt.id} />
                  <Text className="flex-1 text-base font-medium text-foreground">
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
          leading={
            <Ionicons name="globe-outline" size={18} color={mutedFg} />
          }
          title={timezoneLabel(effectiveTimezone)}
          subtitle={user?.timezone ? undefined : t("settings.languageSystem")}
        />
      </SectionGroup>

      <View className="pt-2">
        <Button variant="destructive" onPress={onSignOut}>
          <Text>{t("settings.signOutTitle")}</Text>
        </Button>
      </View>

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
  title,
  subtitle,
  chevronColor,
}: {
  onPress: () => void;
  leading?: React.ReactNode;
  title: string;
  subtitle?: string;
  chevronColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center px-4 py-3.5 active:bg-secondary gap-3",
      )}
    >
      {leading}
      <View className="flex-1">
        <Text className="text-base font-medium text-foreground">{title}</Text>
        {subtitle ? (
          <Text className="text-sm text-muted-foreground mt-0.5">
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
      <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </Text>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        {children}
      </View>
    </View>
  );
}

function WorkspaceRow({
  name,
  slug,
  isActive,
  iconColor,
  onPress,
}: {
  name: string;
  slug: string;
  isActive: boolean;
  iconColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={isActive}
      className="flex-row items-center px-4 py-3.5 active:bg-secondary"
    >
      <View className="flex-1">
        <Text className="text-base font-medium text-foreground">{name}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5">/{slug}</Text>
      </View>
      <Ionicons
        name={isActive ? "checkmark" : "chevron-forward"}
        size={18}
        color={iconColor}
      />
    </Pressable>
  );
}
