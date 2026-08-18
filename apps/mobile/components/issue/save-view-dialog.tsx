/**
 * Save / rename saved-view dialog (iteration-65) — a centered Modal with the
 * view name input and, for workspace-scoped surfaces, a visibility toggle
 * (private ⇄ workspace). Mirrors web's save-view-dialog (name + visibility)
 * at the level mobile needs: web's display-defaults editor is beyond the
 * phone surface, so the dialog captures the CURRENT window silently.
 *
 * Same style family as `rename-chat-dialog.tsx` (bg-popover rounded-2xl
 * card on a dimmed backdrop).
 */
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/react";

export interface SaveViewDialogProps {
  visible: boolean;
  /** edit mode pre-fills the name and reuses the same form. */
  initialName?: string;
  /** my-scope views are always private — the toggle only shows for
   *  workspace-scoped surfaces (server constrains my views to private). */
  visibilityAllowed: boolean;
  initialVisibility?: "private" | "workspace";
  /** Show the sort-direction toggle (iteration-67, mirrors web
   *  save-view-dialog.tsx:157-198 sort section). Defaults to off so the few
   *  surfaces that don't track a slice keep the minimal form. */
  sortDirectionAllowed?: boolean;
  initialSortDirection?: "asc" | "desc";
  onCancel: () => void;
  onSubmit: (
    name: string,
    visibility: "private" | "workspace",
    sortDirection: "asc" | "desc",
  ) => void;
}

/** Server-side cap on a view name (server issue_view.go issueViewNameMaxLen). */
export const VIEW_NAME_MAX_LEN = 80;

export function SaveViewDialog({
  visible,
  initialName = "",
  visibilityAllowed,
  initialVisibility = "private",
  sortDirectionAllowed = false,
  initialSortDirection = "asc",
  onCancel,
  onSubmit,
}: SaveViewDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialName);
  const [visibility, setVisibility] = useState<"private" | "workspace">(
    initialVisibility,
  );
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(
    initialSortDirection,
  );

  const handleShow = () => {
    setDraft(initialName);
    setVisibility(initialVisibility);
    setSortDirection(initialSortDirection);
  };

  const trimmed = draft.trim();
  const dirty = visible && trimmed.length > 0;

  const confirm = () => {
    if (!dirty) return;
    onSubmit(
      trimmed,
      visibilityAllowed ? visibility : "private",
      sortDirection,
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={handleShow}
      onRequestClose={onCancel}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onCancel}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden p-4 gap-3">
              <Text className="text-base font-semibold text-foreground">
                {initialName
                  ? t("issueViews.editViewTitle")
                  : t("issueViews.saveViewTitle")}
              </Text>
              <View className="gap-1">
                <Text className="text-xs text-muted-foreground">
                  {t("issueViews.nameLabel")}
                </Text>
                <TextField
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t("issueViews.namePlaceholder")}
                  autoFocus
                  selectTextOnFocus
                  maxLength={VIEW_NAME_MAX_LEN}
                  returnKeyType="done"
                  onSubmitEditing={confirm}
                />
              </View>
              {visibilityAllowed ? (
                <View className="gap-1">
                  <Text className="text-xs text-muted-foreground">
                    {t("issueViews.visibilityLabel")}
                  </Text>
                  <View className="flex-row gap-2">
                    <Button
                      variant={visibility === "private" ? "default" : "outline"}
                      size="sm"
                      onPress={() => setVisibility("private")}
                      accessibilityState={{ selected: visibility === "private" }}
                    >
                      <Text>{t("issueViews.visibilityPrivate")}</Text>
                    </Button>
                    <Button
                      variant={visibility === "workspace" ? "default" : "outline"}
                      size="sm"
                      onPress={() => setVisibility("workspace")}
                      accessibilityState={{ selected: visibility === "workspace" }}
                    >
                      <Text>{t("issueViews.visibilityWorkspace")}</Text>
                    </Button>
                  </View>
                </View>
              ) : null}
              {sortDirectionAllowed ? (
                <View className="gap-1">
                  <Text className="text-xs text-muted-foreground">
                    {t("issueViews.sortLabel")}
                  </Text>
                  <View className="flex-row gap-2">
                    <Button
                      variant={sortDirection === "asc" ? "default" : "outline"}
                      size="sm"
                      onPress={() => setSortDirection("asc")}
                      accessibilityState={{ selected: sortDirection === "asc" }}
                    >
                      <Text>{t("issueViews.sortAsc")}</Text>
                    </Button>
                    <Button
                      variant={sortDirection === "desc" ? "default" : "outline"}
                      size="sm"
                      onPress={() => setSortDirection("desc")}
                      accessibilityState={{ selected: sortDirection === "desc" }}
                    >
                      <Text>{t("issueViews.sortDesc")}</Text>
                    </Button>
                  </View>
                </View>
              ) : null}
              <View className="flex-row justify-end gap-2">
                <Button variant="ghost" onPress={onCancel}>
                  <Text>{t("common.cancel")}</Text>
                </Button>
                <Button onPress={confirm} disabled={!dirty}>
                  <Text>{t("issueViews.save")}</Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}