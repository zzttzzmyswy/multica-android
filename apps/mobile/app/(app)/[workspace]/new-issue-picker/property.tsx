/**
 * Custom-property value editor for the NOT-YET-CREATED issue (iteration 259,
 * MYS-2245) — the create form's counterpart to
 * `issue/[id]/picker/property.tsx`.
 *
 * The value goes into `useNewIssueDraftStore.propertyValues`, never to the
 * server: `POST /api/issues` has no field for property values, so web keeps
 * them in local draft state and replays one PUT per property after the issue
 * exists (`packages/views/modals/create-issue.tsx:483-508`). The mobile create
 * screen mirrors that ordering in `lib/create-property-writes.ts`.
 *
 * Why a separate route rather than reusing `issue/[id]/picker/property`: that
 * screen binds to an issue id and fires `useSetIssueProperty` on commit. Here
 * there is no issue yet, so the only difference is the host — which is exactly
 * the seam `components/issue/pickers/property-value-body.tsx` was extracted
 * for. Dismissing the sheet (back gesture, or a tap that commits) returns to
 * the create form with the draft chip already updated, because the picker
 * routes read the same store the chip row renders from.
 *
 * Terminology: "commit" below means "write into the draft", not "persist".
 */
import { useState } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { PropertyCatalogStatus } from "@/components/property/property-catalog-status";
import { CatalogEmptySlot } from "@/components/catalog/catalog-status";
import {
  PropertyValueBody,
  propertyBodyHasDone,
} from "@/components/issue/pickers/property-value-body";
import { useActivePropertyCatalog } from "@/data/queries/properties";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { propertyTypeIcon } from "@/lib/issue-properties";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function NewIssuePropertyRoute() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const catalog = useActivePropertyCatalog(wsId);
  const property = catalog.definitions.find((p) => p.id === propertyId);

  const values = useNewIssueDraftStore((s) => s.propertyValues);
  const setPropertyValue = useNewIssueDraftStore((s) => s.setPropertyValue);
  const value = propertyId ? values[propertyId] : undefined;

  // `DONE` is offered from the header for the text-ish bodies only, matching
  // the issue-bound editor (`property-value-editor.tsx`): a list body commits
  // on the row the user taps, so a Done button there would be decoration.
  // Mirrors the shared body's text input so the header's Done can commit what
  // was actually typed (see `PropertyValueBody`'s `onDraftChange`).
  const [draftText, setDraftText] = useState(
    typeof value === "string" ? value : "",
  );

  const close = () => router.back();

  const commit = (next: import("@multica/core/types").IssuePropertyValue) => {
    if (!propertyId) return;
    setPropertyValue(propertyId, next);
    // A single-value commit finishes the edit, exactly like the issue-bound
    // editor's `onSuccess: () => onClose()`. `multi_select` and `multi_actor`
    // get their own close (the sheet stays open while toggling), which the
    // shared body handles by simply not calling back here.
    const multi =
      property?.type === "multi_select" || property?.type === "multi_actor";
    if (!multi) close();
  };

  const clear = () => {
    if (!propertyId) return;
    setPropertyValue(propertyId, undefined);
    close();
  };

  if (!catalog.isResolved) {
    // Never "this property does not exist" while the catalog is still in
    // flight or its read failed (MYS-1892's rule).
    return (
      <View className="flex-1 justify-center bg-background">
        <PropertyCatalogStatus
          state={catalog.state}
          onRetry={catalog.retry}
          layout="centered"
        />
      </View>
    );
  }

  if (!property) {
    return (
      <View className="flex-1 bg-background">
        <CatalogEmptySlot
          states={[catalog.state]}
          onRetry={catalog.retry}
          emptyMessage={t("properties.notFound")}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={keyboardBehavior}>
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <View className="flex-1 flex-row items-center gap-2 min-w-0">
          <Ionicons
            name={propertyTypeIcon(property.type)}
            size={16}
            color={theme.mutedForeground}
          />
          <Text
            className="text-title-sm font-semibold text-foreground"
            numberOfLines={1}
          >
            {property.name}
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          {value !== undefined ? (
            <Pressable
              onPress={clear}
              hitSlop={6}
              className="px-2 py-1 rounded-md active:bg-secondary"
            >
              <Text className="text-body text-destructive">
                {t("common.clear")}
              </Text>
            </Pressable>
          ) : null}
          {propertyBodyHasDone(property.type) ? (
            <Pressable
              onPress={() => {
                const trimmed = draftText.trim();
                if (!trimmed) {
                  if (value !== undefined) clear();
                  else close();
                  return;
                }
                if (property.type === "number") {
                  const parsed = Number(trimmed);
                  if (Number.isNaN(parsed)) return;
                  commit(parsed);
                } else {
                  commit(trimmed);
                }
              }}
              hitSlop={6}
              className="px-2 py-1 rounded-md active:bg-secondary"
            >
              <Text className="text-body font-medium text-primary">
                {t("common.done")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <PropertyValueBody
        property={property}
        value={value}
        onCommit={commit}
        onClear={clear}
        initialDraft={draftText}
        onDraftChange={setDraftText}
      />
    </KeyboardAvoidingView>
  );
}
