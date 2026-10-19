/**
 * Custom-property value editor for an issue (MYS-334) — mirrors web's
 * CustomPropertyValueEditor shapes:
 *
 *   select        → option list (tap commits + closes)
 *   multi_select  → toggling option list (stays open until dismissed)
 *   date          → inline UIDatePicker + Done / Clear header
 *   checkbox      → Yes / No rows
 *   text/number/url → input row + Done (number validates parse)
 *
 * Archived (or unknown-type) definitions render read-only: the current
 * value is displayed and only Clear is offered — the server rejects new
 * values on archived properties but always allows unset (mirrors web).
 *
 * Self-contained: reads the issue + property from the caches and fires
 * useSetIssueProperty / useUnsetIssueProperty on commit, then calls
 * `onClose`. Hosted two ways (MYS-1149): as its own formSheet route
 * (`issue/[id]/picker/property`, where `onClose` is `router.back()`) and
 * inside the issue table's cell editor, where the write has to land without
 * leaving the workbench.
 */
import { useState, useEffect } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { hasUnknownActorRef } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { PropertyCatalogStatus } from "@/components/property/property-catalog-status";
import { issueDetailOptions } from "@/data/queries/issues";
import { usePropertyCatalog } from "@/data/queries/properties";
import {
  useSetIssueProperty,
  useUnsetIssueProperty,
} from "@/data/mutations/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { joinedActorNames } from "@/lib/actor-name-state";
import { formatPropertyValue, propertyTypeIcon } from "@/lib/issue-properties";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  PROPERTY_COMMIT_TYPES,
  propertyBodyHasDone,
  PropertyValueBody,
} from "./property-value-body";

interface Props {
  issueId: string;
  propertyId: string;
  /** Called once the value has been written (or when there is nothing to
   *  edit) — the host decides whether that means `router.back()` or closing
   *  a sheet. */
  onClose: () => void;
}

export function PropertyValueEditor({ issueId, propertyId, onClose }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  // Names an actor reference for the read-only label (an archived definition,
  // or a single `actor` this build cannot parse). Without it that path prints
  // the stored `member:<uuid>` — the same defect the editable path fixes.
  const { resolveActorName } = useActorLookup();

  const { data: issue } = useQuery(issueDetailOptions(wsId, issueId));
  // Four-state read (MYS-1892): `isLoading` alone cannot separate "failed"
  // from "not found", so a failed catalog used to answer 「未找到该属性」 for a
  // property that exists. The state is resolved here and each branch below
  // says only what it knows.
  const catalog = usePropertyCatalog(wsId);
  const property = catalog.definitions.find((p) => p.id === propertyId);

  const setProperty = useSetIssueProperty();
  const unsetProperty = useUnsetIssueProperty();
  const [draft, setDraft] = useState("");

  const value = issue ? (issue.properties ?? {})[property?.id ?? ""] : undefined;

  // Prefill the input from the current value once it lands; never clobber
  // text the user has already started typing.
  const textishValue = typeof value === "string" ? value : undefined;
  useEffect(() => {
    if (
      propertyBodyHasDone(property?.type ?? "") &&
      draft === "" &&
      textishValue
    ) {
      setDraft(textishValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textishValue, property?.type]);

  if (!catalog.isResolved) {
    // Still loading, or the read failed — in neither case is "this property
    // does not exist" a fact we are entitled to state (MYS-1892).
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
      <View className="flex-1 items-center justify-center bg-background px-6 gap-1">
        <Ionicons name="options-outline" size={32} color={theme.mutedForeground} />
        <Text className="text-body text-muted-foreground text-center mt-2">
          {t("properties.notFound")}
        </Text>
      </View>
    );
  }

  // A single `actor` whose only reference this build cannot parse renders as
  // nothing, so the user would see an empty field and, believing it unset,
  // overwrite a value they were never shown. Editing is withheld; Clear stays
  // available so the stale value can still be cleaned up. `multi_actor` is
  // exempt — its toggle round-trips unknown entries instead of replacing the
  // whole value. Mirrors web `isCustomPropertyReadOnly`
  // (packages/views/issues/components/pickers/custom-property-picker.tsx:58-63).
  const unknownActorRef =
    property.type === "actor" && hasUnknownActorRef(value);
  const readOnly =
    property.archived || !PROPERTY_COMMIT_TYPES.has(property.type) || unknownActorRef;

  const display = formatPropertyValue(property, value);
  const valueLabel =
    display === null
      ? t("properties.value.empty")
      : display.kind === "option"
        ? display.option.name
        : display.kind === "options"
          ? display.options.map((o) => o.name).join(", ")
          : display.kind === "checkbox"
            ? display.value
              ? t("properties.value.true")
              : t("properties.value.false")
            : display.kind === "unknownActors"
              ? t("properties.value.unknown")
              : display.kind === "actors"
                ? // The editor's field echo, through the SAME folding the
                  // folded-thread bars use (`joinedActorNames`): a withheld ref
                  // contributes nothing rather than an empty segment between
                  // two commas, and the `+N` tail only ever counts names the
                  // line actually left out. Reusing it means the "Ada, , Grace"
                  // and "" +3"" defects stay fixed in one place, and the
                  // behaviour is unit-tested in the Node lane
                  // (`lib/actor-name-state.test.ts`) rather than only asserted
                  // as source text (MYS-2227).
                  //
                  // No cap: a property value's whole list is the value, so
                  // `maxNamed` is unbounded and the tail never appears. If
                  // nothing at all is readable the field keeps its own
                  // 「value.empty」 copy — a load mark in a text field's value
                  // would read as an unfilled form.
                  joinedActorNames(
                    display.refs.map((ref) => ({
                      type: ref.kind,
                      id: ref.id,
                    })),
                    resolveActorName,
                    Number.MAX_SAFE_INTEGER,
                  ) || t("properties.value.empty")
                : display.text;
  const hasValue = value !== undefined;

  const commit = (next: import("@multica/core/types").IssuePropertyValue) => {
    setProperty.mutate(
      { issueId, propertyId: property.id, value: next },
      { onSuccess: () => onClose() },
    );
  };

  const clear = () => {
    unsetProperty.mutate(
      { issueId, propertyId: property.id },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior="padding">
      {/* Header: property name + Clear / Done actions */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <View className="flex-1 flex-row items-center gap-2 min-w-0">
          <Ionicons
            name={propertyTypeIcon(property.type)}
            size={16}
            color={theme.mutedForeground}
          />
          <Text className="text-title-sm font-semibold text-foreground" numberOfLines={1}>
            {property.name}
          </Text>
          {property.archived ? (
            <View className="rounded-full bg-secondary px-1.5 py-0.5">
              <Text className="text-micro text-muted-foreground font-medium">
                {t("properties.archivedBadge")}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="flex-row items-center gap-1">
          {hasValue ? (
            <Pressable onPress={clear} hitSlop={6} className="px-2 py-1 rounded-md active:bg-secondary">
              <Text className="text-body text-destructive">{t("common.clear")}</Text>
            </Pressable>
          ) : null}
          {propertyBodyHasDone(property.type) && (
            <Pressable
              onPress={() => {
                const trimmed = draft.trim();
                if (!trimmed) {
                  if (hasValue) clear();
                  else onClose();
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
              <Text className="text-body font-medium text-primary">{t("common.done")}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {readOnly ? (
        <View className="flex-1">
          <View className="flex-row items-center gap-2 px-4 py-3">
            <Text className="text-body text-foreground">{valueLabel}</Text>
          </View>
          <Text className="px-4 text-caption text-muted-foreground">
            {unknownActorRef
              ? t("properties.value.unknownHint")
              : t("properties.value.archivedHint")}
          </Text>
        </View>
      ) : (
        <PropertyValueBody
          property={property}
          value={value}
          onCommit={commit}
          onClear={clear}
          initialDraft={draft}
          onDraftChange={setDraft}
        />
      )}
    </KeyboardAvoidingView>
  );
}
