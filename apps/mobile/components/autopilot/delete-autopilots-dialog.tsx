/**
 * Delete confirm for the autopilots list — the mobile port of web's
 * `DeleteAutopilotsDialog` (`autopilot-list-actions.tsx:38-105`), which the
 * single row's kebab and the batch toolbar SHARE. One implementation, one copy
 * set, one loop over the rows — two dialogs is how the two entry points would
 * come to disagree about what "delete" promises.
 *
 * Web renders a `Dialog` with three copy lines (title / description /
 * warning) and a destructive confirm; the app's one-line `Alert.alert` pattern
 * would drop the warning, so this is a rendered `Modal` like
 * `assign-confirm-dialog.tsx`. The copy is web's `actions.delete_dialog.*`
 * verbatim in both locales.
 *
 * The batch path deletes rows one request at a time, as web does
 * (`:58-66`), and keeps the dialog open (with its spinner) until the loop
 * settles. Mobile's other batch write (`SkillBatchBar`) runs its calls
 * concurrently and reports partial failure; this one stays SEQUENTIAL because
 * the copy promises a specific number of deletions and a half-finished batch
 * has no report surface here — web's loop aborts on the first rejection, and
 * a failure alerts through the mutation's own write-failure title.
 */
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import type { Autopilot } from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";

export function DeleteAutopilotsDialog({
  rows,
  visible,
  onClose,
  onConfirm,
}: {
  /** The rows this confirmation covers — one from a kebab, N from the toolbar. */
  rows: readonly Autopilot[];
  visible: boolean;
  onClose: () => void;
  /** Runs the deletes. Resolves when the loop has settled, so the dialog can
   *  keep its spinner up for the whole batch. */
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  // Web switches on `rows.length === 1` for the description, so a single-row
  // delete names the autopilot instead of saying "1 automations". The mobile
  // `translate` does not resolve plurals (`_one` / `_other` — see the note on
  // `AutopilotFilterChip`), so the two sentences are two explicit keys.
  const description =
    rows.length === 1
      ? t("autopilots.actions.delete_dialog.descriptionOne", {
          name: rows[0]?.title ?? "",
        })
      : t("autopilots.actions.delete_dialog.descriptionOther", {
          count: rows.length,
        });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-center px-6">
          <Pressable onPress={() => {}} className="bg-popover rounded-2xl p-4">
            <Text className="text-title-sm font-semibold text-foreground">
              {t("autopilots.actions.delete_dialog.title")}
            </Text>
            <Text className="text-body text-muted-foreground leading-5 mt-1.5">
              {description}
            </Text>
            {/* Web renders the warning as a separate, smaller line below the
                description — it is the sentence that makes the action
                irreversible, so it must not be folded into the other one. */}
            <Text className="text-caption text-muted-foreground mt-2">
              {t("autopilots.actions.delete_dialog.warning")}
            </Text>
            <View className="flex-row gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={deleting}
                onPress={onClose}
              >
                <Text>{t("autopilots.actions.delete_dialog.cancel")}</Text>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="flex-1"
                disabled={deleting}
                onPress={handleDelete}
              >
                {deleting ? (
                  <>
                    <ActivityIndicator size="small" />
                    <Text>
                      {t("autopilots.actions.delete_dialog.deleting")}
                    </Text>
                  </>
                ) : (
                  <Text>
                    {t("autopilots.actions.delete_dialog.confirm")}
                  </Text>
                )}
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
