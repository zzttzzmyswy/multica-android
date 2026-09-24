/**
 * Shared tap-to-upload avatar control. Mobile counterpart of web
 * `packages/views/common/avatar-upload-control.tsx`, which five surfaces reuse
 * (workspace / account / squad detail / create-squad / create-agent).
 *
 * The control owns the whole pick-and-upload half of the flow:
 *
 *   tap → ActionSheet (camera / library / remove) → permission check →
 *   size cap → `api.uploadFile` → hand the resulting URL to the caller
 *
 * Persistence stays with the caller, exactly as on web: a user avatar PATCHes
 * `/api/me`, a workspace logo PATCHes the workspace, a squad avatar goes into
 * `updateSquad`, and the create-squad flow only stashes the URL in local state
 * until the squad exists. Web's `persistedByCaller` swallows a caller
 * rejection because the caller already owns that feedback — the same split
 * holds here, so the Alert for a failed save comes from the caller and never
 * twice.
 *
 * Extraction note: this replaces the private picker that lived in
 * `more/settings/profile.tsx`; the copy it shows is the same copy, moved from
 * the `profile.*` locale group to `avatar.*` now that three more screens use
 * it. The profile screen's separate spinner is gone — the control renders the
 * busy state on the avatar itself, which is where the user is looking.
 */
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import type { FileAsset } from "@/data/api";
import { ActionSheet } from "@/lib/action-sheet";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB — matches what's reasonable on cellular.

export type AvatarUploadVariant = "user" | "squad" | "workspace";

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Empty-state glyph: a group for squads, the initial for people/workspaces. */
function AvatarFallbackBody({
  variant,
  name,
  size,
}: {
  variant: AvatarUploadVariant;
  name: string;
  size: number;
}) {
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  if (variant === "squad") {
    return <Ionicons name="people" size={size * 0.45} color={muted} />;
  }
  const text = variant === "workspace" ? name.trim().charAt(0) : initialsOf(name);
  return (
    <Text
      className="font-semibold text-muted-foreground"
      style={{ fontSize: size * 0.38 }}
    >
      {text.toUpperCase() || "?"}
    </Text>
  );
}

export function AvatarUploadControl({
  value,
  variant,
  name = "",
  size = 64,
  disabled = false,
  onUploaded,
  onRemove,
  accessibilityLabel,
}: {
  /** Current avatar URL, raw (unresolved). `null`/empty renders the fallback. */
  value: string | null | undefined;
  /** Drives the empty-state glyph. */
  variant: AvatarUploadVariant;
  /** Name used for initials and the image alt text. */
  name?: string;
  size?: number;
  disabled?: boolean;
  /**
   * Fires with the uploaded file URL. The caller persists it. A rejection is
   * swallowed here — the caller owns that feedback (see the module comment).
   */
  onUploaded: (url: string) => void | Promise<unknown>;
  /**
   * When provided, the sheet offers a Remove entry that clears the avatar.
   * Edit flows that can persist an empty value pass it; create flows pass a
   * local-state clear.
   */
  onRemove?: () => void | Promise<unknown>;
  accessibilityLabel?: string;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [busy, setBusy] = useState(false);

  // `avatar_url` comes back as a server-relative path on self-hosted backends
  // with no CDN signer (`/api/attachments/{id}/download`). Web resolves that
  // against the document origin for free; RN has no origin, so an unresolved
  // path makes <Image> drop the request and the avatar renders blank. Same
  // helper WorkspaceAvatar uses.
  const resolved = resolveAttachmentUrl(value);
  const hasAvatar = !!resolved;

  /** Runs the caller's write; a failure there is the caller's to report. */
  const persistedByCaller = async (save: () => void | Promise<unknown>) => {
    try {
      await save();
    } catch {
      // Deliberately swallowed — see the module comment.
    }
  };

  const uploadAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
      Alert.alert(t("avatar.imageTooLargeTitle"), t("avatar.imageTooLargeMessage"));
      return;
    }
    const fileAsset: FileAsset = {
      uri: asset.uri,
      // expo-image-picker doesn't always supply a fileName (camera captures);
      // fabricate one from the URI so the multipart upload has a stable name.
      name: asset.fileName ?? `avatar-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    };

    setBusy(true);
    try {
      const attachment = await api.uploadFile(fileAsset);
      await persistedByCaller(() => onUploaded(attachment.url));
    } catch (err) {
      // Only the upload can land here — see persistedByCaller.
      Alert.alert(
        t("avatar.uploadFailedTitle"),
        err instanceof Error ? err.message : t("avatar.uploadFailedMessage"),
      );
    } finally {
      setBusy(false);
    }
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("avatar.cameraPermissionTitle"), t("avatar.cameraPermissionMessage"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) await uploadAsset(result.assets[0]);
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) await uploadAsset(result.assets[0]);
  };

  const handleRemove = async () => {
    if (!onRemove) return;
    setBusy(true);
    try {
      await persistedByCaller(() => onRemove());
    } finally {
      setBusy(false);
    }
  };

  const handlePick = () => {
    if (busy || disabled) return;
    // Remove sits between the two pickers and Cancel, and only when the
    // caller can clear an existing avatar — the same shape web's control
    // takes when it is given `onClear`.
    const options = [
      t("avatar.takePhoto"),
      t("avatar.chooseFromLibrary"),
      ...(hasAvatar && onRemove ? [t("avatar.removePhoto")] : []),
      t("common.cancel"),
    ];
    const removeIndex = hasAvatar && onRemove ? 2 : -1;
    const cancelIndex = options.length - 1;

    ActionSheet.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: cancelIndex,
        destructiveButtonIndex: removeIndex >= 0 ? removeIndex : undefined,
      },
      async (index) => {
        if (index === cancelIndex) return;
        if (index === 0) await pickFromCamera();
        else if (index === 1) await pickFromLibrary();
        else if (index === removeIndex) await handleRemove();
      },
    );
  };

  return (
    <Pressable
      onPress={handlePick}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? t("avatar.change")}
      // Pinned to the avatar's own box: a Pressable stretches to its parent's
      // width by default, which would drag the corner badge off to the right
      // edge of any full-width container (the create-squad field is one).
      style={{ width: size, height: size }}
      className={disabled ? "opacity-60" : ""}
    >
      <Avatar alt={name} className="rounded-full" style={{ width: size, height: size }}>
        {resolved ? <AvatarImage source={{ uri: resolved }} /> : null}
        <AvatarFallback>
          <AvatarFallbackBody variant={variant} name={name} size={size} />
        </AvatarFallback>
        {busy ? (
          <View
            className="absolute inset-0 items-center justify-center bg-black/40"
            style={{ width: size, height: size }}
          >
            <ActivityIndicator size="small" color="#fff" />
          </View>
        ) : null}
      </Avatar>
      {!busy && !disabled ? (
        <View
          className="absolute -bottom-0.5 -right-0.5 items-center justify-center rounded-full border border-border bg-card"
          style={{ width: size * 0.34, height: size * 0.34 }}
        >
          <Ionicons name="camera" size={size * 0.18} color={theme.mutedForeground} />
        </View>
      ) : null}
    </Pressable>
  );
}
