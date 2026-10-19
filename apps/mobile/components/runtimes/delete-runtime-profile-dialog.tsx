/**
 * The destructive CONFIRMATION for a runtime-profile delete (iteration 258,
 * MYS-2236) — the mobile mirror of web's `DeleteRuntimeProfileDialog`
 * (packages/views/runtimes/components/delete-runtime-profile-dialog.tsx).
 *
 * Why this exists separately from `use-runtime-delete-flow`: the two deletes
 * remove different objects and answer conflict differently.
 *
 *   runtime instance → `DELETE /api/runtimes/:id`, refuses with
 *                      `runtime_has_active_agents` and is retried as an
 *                      unbind-and-delete cascade.
 *   profile          → `DELETE /api/workspaces/:ws/runtime-profiles/:id`,
 *                      refuses with a plain 409 while agents still reference
 *                      it, and web does NOT cascade there: the admin is told
 *                      the reason and the dialog STAYS OPEN so they can act on
 *                      it.
 *
 * Collapsing the second into the first is what made "Delete from workspace"
 * tear down the machine's runtime instance while the profile registration —
 * the thing the label names, and the only thing the other machines' identical
 * rows depend on — survived. So the profile path gets its own modal with its
 * own 409 handling, and never calls the cascade.
 *
 * Rendered as a `Modal` rather than `Alert.alert` because the refusal has to
 * appear IN the dialog above the buttons: a native alert cannot gain a second
 * sentence after it is shown.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useDeleteRuntimeProfile } from "@/data/mutations/runtime-profiles";
import { parseRuntimeProfileBoundConflict } from "@/lib/runtime-profile-conflict";
import { classifyProfileDeleteFailure } from "@/lib/runtime-profile-delete";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

/**
 * What the dialog needs to name: the profile id the DELETE goes to, and the
 * label the copy prints.
 *
 * Deliberately not the whole `RuntimeProfile`. A runtime row knows its
 * `profile_id` from the runtime itself, but the readable name lives in the
 * profile LIST — one request the row may not have answered yet. Tying the
 * confirmation to "the profile object arrived" would either hide a legitimate
 * delete or (web's behaviour, `runtime-list.tsx:619-630`) silently fall
 * through to the RUNTIME dialog, which is the exact confusion this round is
 * fixing. The id is the authoritative fact; the name has a fallback.
 */
export interface ProfileDeleteSubject {
  id: string;
  displayName: string;
}

export function DeleteRuntimeProfileDialog({
  /** null keeps the modal closed — callers hold "which profile" in state and
   *  clearing it is how they dismiss, the same way the row menu's edit form
   *  works. */
  subject,
  onClose,
  onDeleted,
}: {
  subject: ProfileDeleteSubject | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const deleteProfile = useDeleteRuntimeProfile();
  // The server-issued "agents still bound" sentence, shown above the buttons.
  // Cleared every time the dialog re-opens so a previous refusal cannot be
  // read as this attempt's answer.
  const [bound, setBound] = useState<string | null>(null);
  const profileId = subject?.id ?? null;

  useEffect(() => {
    if (profileId) setBound(null);
  }, [profileId]);

  if (!subject) return null;

  const submitting = deleteProfile.isPending;

  const handleConfirm = () => {
    if (submitting) return;
    setBound(null);
    deleteProfile.mutate(subject.id, {
      onSuccess: () => {
        onDeleted();
      },
      onError: (err) => {
        const failure = classifyProfileDeleteFailure(
          err,
          parseRuntimeProfileBoundConflict,
          t("runtimes.profiles.deleteDialog.errorBound"),
        );
        if (failure.keepsDialogOpen) {
          // A refusal is not a dismissal: the admin needs the reason and the
          // buttons still in front of them.
          setBound(failure.message);
          return;
        }
        // Any other failure has nothing to explain inline — close and let the
        // caller's message carry it, like web's `toast.error`.
        onClose();
      },
    });
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
    >
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full max-w-[440px] rounded-lg bg-background overflow-hidden">
          <View className="px-5 pb-4 pt-5">
            <Text className="text-title-sm font-semibold text-foreground">
              {t("runtimes.profiles.deleteDialog.title")}
            </Text>
            <Text className="mt-1 text-body leading-5 text-foreground">
              {t("runtimes.profiles.deleteDialog.description", {
                name: subject.displayName,
              })}
            </Text>
            {bound ? (
              <View
                accessibilityRole="alert"
                className="mt-3 flex-row items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2"
              >
                <Ionicons
                  name="warning-outline"
                  size={14}
                  color={theme.warning}
                  style={{ marginTop: 2 }}
                />
                <Text className="flex-1 text-caption text-foreground">
                  {bound}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="border-t border-border bg-secondary/25 px-5 py-3 flex-row justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                if (!submitting) onClose();
              }}
              disabled={submitting}
            >
              <Text>{t("runtimes.profiles.deleteDialog.cancel")}</Text>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onPress={handleConfirm}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator
                  size="small"
                  color={theme.destructiveForeground}
                />
              ) : (
                <Text>{t("runtimes.profiles.deleteDialog.confirm")}</Text>
              )}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
