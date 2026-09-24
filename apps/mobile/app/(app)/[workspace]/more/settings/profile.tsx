/**
 * Profile edit subscreen — name + about + avatar.
 *
 * The avatar is the shared `AvatarUploadControl` (components/ui/
 * avatar-upload-control.tsx), which owns the ActionSheet (Take Photo / Choose
 * from Library / Remove), the permission check, the size cap and the upload;
 * this screen only persists the URL it hands back. That control is also what
 * workspace settings and the squad screens use, so the picker exists once.
 *
 * The "about" field is web's `profile_description` — free-form text shared
 * with agents working on the user's behalf. Mobile keeps the screen's explicit
 * Save button (web auto-saves on blur) but holds the same contract: a 2000
 * character cap mirroring the server's `MaxProfileDescriptionLen`, an empty
 * string clears the field, and the PATCH only fires when something changed.
 *
 * Save runs PATCH /api/me then writes the returned user back to the auth
 * store via setUser — same source-of-truth pattern as web (server response
 * is authoritative, never the local form state).
 */
import { useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { AvatarUploadControl } from "@/components/ui/avatar-upload-control";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import { useTranslation } from "@/lib/i18n/react";

// Mirrors server/internal/handler/auth.go:MaxProfileDescriptionLen. Counted in
// JS String.length (UTF-16 code units) here while the server counts runes, so a
// profile full of supplementary-plane emoji trips the client cap before the
// server's — the safer direction of drift (web does the same).
const MAX_PROFILE_DESCRIPTION_LEN = 2000;

export default function ProfileSettingsScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? "");
  const [description, setDescription] = useState(user?.profile_description ?? "");
  const [saving, setSaving] = useState(false);

  // Resync if `user` updates from outside (avatar upload, refetch, login as
  // different user). Without this the form would render stale init forever.
  useEffect(() => {
    setName(user?.name ?? "");
    setDescription(user?.profile_description ?? "");
  }, [user]);

  const trimmedName = name.trim();
  const descriptionTooLong = description.length > MAX_PROFILE_DESCRIPTION_LEN;
  const dirty =
    !descriptionTooLong &&
    ((trimmedName !== (user?.name ?? "") && trimmedName.length > 0) ||
      description !== (user?.profile_description ?? ""));

  // The PATCH is owned here, not by the control: the control reports only its
  // own upload failures, so the Alert for a failed write is this screen's.
  // An empty URL clears the avatar — the same field, the same endpoint.
  const persistAvatar = async (url: string) => {
    try {
      setUser(await api.updateMe({ avatar_url: url }));
    } catch (err) {
      Alert.alert(
        t("profile.saveFailedTitle"),
        err instanceof Error ? err.message : t("profile.saveFailedMessage"),
      );
    }
  };

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      // Both fields go in one PATCH: the server returns the authoritative
      // user and setUser replaces the store, so a partial payload would
      // silently drop the untouched field back to its stored value.
      const updated = await api.updateMe({
        name: trimmedName,
        profile_description: description,
      });
      setUser(updated);
    } catch (err) {
      Alert.alert(
        t("profile.saveFailedTitle"),
        err instanceof Error ? err.message : t("profile.saveFailedMessage"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-6 gap-6"
      keyboardShouldPersistTaps="handled"
    >
      <View className="items-center gap-3">
        <AvatarUploadControl
          variant="user"
          value={user?.avatar_url ?? null}
          name={user?.name ?? ""}
          size={96}
          accessibilityLabel={t("profile.yourAvatar")}
          onUploaded={persistAvatar}
          onRemove={() => persistAvatar("")}
        />
        <Text className="text-xs text-muted-foreground">
          {t("profile.tapToChangePhoto")}
        </Text>
      </View>

      <Separator />

      <View className="gap-4">
        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">{t("settings.name")}</Text>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={t("settings.namePlaceholder")}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
          />
        </View>
        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">
            {t("profile.aboutLabel")}
          </Text>
          <AutosizeTextArea
            value={description}
            onChangeText={setDescription}
            placeholder={t("profile.aboutPlaceholder")}
            editable={!saving}
            maxLength={MAX_PROFILE_DESCRIPTION_LEN}
            minHeight={110}
            maxHeight={240}
            className={
              descriptionTooLong
                ? "rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2"
                : "rounded-md border border-border bg-secondary/50 px-3 py-2"
            }
          />
          <View className="flex-row justify-between mt-1.5 gap-3">
            <Text className="flex-1 text-xs text-muted-foreground/70">
              {t("profile.aboutHint")}
            </Text>
            <Text
              className={
                descriptionTooLong
                  ? "text-xs text-destructive tabular-nums"
                  : "text-xs text-muted-foreground tabular-nums"
              }
            >
              {description.length}/{MAX_PROFILE_DESCRIPTION_LEN}
            </Text>
          </View>
          {descriptionTooLong ? (
            <Text className="text-xs text-destructive mt-1.5">
              {t("profile.aboutTooLong", {
                max: MAX_PROFILE_DESCRIPTION_LEN,
                count: description.length,
              })}
            </Text>
          ) : null}
        </View>
        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">{t("settings.email")}</Text>
          <View className="rounded-md border border-border bg-muted px-3 py-2.5">
            <Text className="text-base text-muted-foreground">
              {user?.email ?? "—"}
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground mt-1.5">
            {t("profile.emailSetAtSignup")}
          </Text>
        </View>
      </View>

      <Button onPress={handleSave} disabled={!dirty || saving}>
        <Text>{saving ? t("profile.saving") : t("profile.save")}</Text>
      </Button>
    </ScrollView>
  );
}
