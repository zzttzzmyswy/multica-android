/**
 * Profile edit subscreen — name + about + avatar.
 *
 * Avatar tap opens an iOS native ActionSheet (Take Photo / Choose from Library
 * / Remove). Mirrors the avatar upload flow in
 * packages/views/settings/components/account-tab.tsx but the picker uses
 * native APIs per CLAUDE.md "iOS native > RNR > discuss" waterfall.
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
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import type { FileAsset } from "@/data/api";
import { ActionSheet } from "@/lib/action-sheet";
import { useTranslation } from "@/lib/i18n/react";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB — matches what's reasonable on cellular.

// Mirrors server/internal/handler/auth.go:MaxProfileDescriptionLen. Counted in
// JS String.length (UTF-16 code units) here while the server counts runes, so a
// profile full of supplementary-plane emoji trips the client cap before the
// server's — the safer direction of drift (web does the same).
const MAX_PROFILE_DESCRIPTION_LEN = 2000;

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

export default function ProfileSettingsScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? "");
  const [description, setDescription] = useState(user?.profile_description ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  const handleAvatarPick = () => {
    const options = [
      t("profile.takePhoto"),
      t("profile.chooseFromLibrary"),
      t("profile.removePhoto"),
      t("common.cancel"),
    ];
    const removeIndex = user?.avatar_url ? 2 : -1;
    const cancelIndex = user?.avatar_url ? 3 : 2;
    const visibleOptions = user?.avatar_url ? options : options.filter((_, i) => i !== 2);

    ActionSheet.showActionSheetWithOptions(
      {
        options: visibleOptions,
        cancelButtonIndex: cancelIndex,
        destructiveButtonIndex: removeIndex >= 0 ? removeIndex : undefined,
      },
      async (index) => {
        if (index === cancelIndex) return;
        if (index === 0) await pickFromCamera();
        else if (index === 1) await pickFromLibrary();
        else if (index === removeIndex) await removeAvatar();
      },
    );
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("profile.cameraPermissionTitle"), t("profile.cameraPermissionMessage"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) await uploadAvatar(result.assets[0]);
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) await uploadAvatar(result.assets[0]);
  };

  const uploadAvatar = async (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
      Alert.alert(t("profile.imageTooLargeTitle"), t("profile.imageTooLargeMessage"));
      return;
    }
    const fileAsset: FileAsset = {
      uri: asset.uri,
      // expo-image-picker doesn't always supply a fileName (camera captures);
      // fabricate one from the URI so the multipart upload has a stable name.
      name: asset.fileName ?? `avatar-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    };

    setUploading(true);
    try {
      const attachment = await api.uploadFile(fileAsset);
      const updated = await api.updateMe({ avatar_url: attachment.url });
      setUser(updated);
    } catch (err) {
      Alert.alert(
        t("profile.uploadFailedTitle"),
        err instanceof Error ? err.message : t("profile.uploadFailedMessage"),
      );
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    setUploading(true);
    try {
      const updated = await api.updateMe({ avatar_url: "" });
      setUser(updated);
    } catch (err) {
      Alert.alert(
        t("profile.removeFailedTitle"),
        err instanceof Error ? err.message : t("profile.removeFailedMessage"),
      );
    } finally {
      setUploading(false);
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
        <Pressable onPress={handleAvatarPick} disabled={uploading}>
          <Avatar alt={user?.name ?? t("profile.yourAvatar")} className="size-24">
            {user?.avatar_url ? (
              <AvatarImage source={{ uri: user.avatar_url }} />
            ) : null}
            <AvatarFallback>
              <Text className="text-2xl font-semibold text-muted-foreground">
                {initialsOf(user?.name)}
              </Text>
            </AvatarFallback>
          </Avatar>
        </Pressable>
        {uploading ? (
          <ActivityIndicator />
        ) : (
          <Text className="text-xs text-muted-foreground">
            {t("profile.tapToChangePhoto")}
          </Text>
        )}
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
