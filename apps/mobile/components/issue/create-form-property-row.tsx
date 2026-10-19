/**
 * The custom-property chips in the create form (iteration 259, MYS-2245).
 *
 * Web renders these inside the same toolbar as its standard fields
 * (`packages/views/modals/create-issue.tsx:1000-1030` for the chips holding a
 * value, `:1159-1180` for the `custom_properties` group in the overflow menu).
 * Mobile's `CreateFormAttributeRow` covers the seven STANDARD fields, and it
 * cannot cover these: that row's field pool is the closed union
 * `NewIssuePickerField`, while workspace properties are an open, per-workspace
 * set. Bolting them onto that union would push an unbounded id space through
 * every `switch` in the row.
 *
 * So this is a sibling row that follows the same three visibility rules web
 * applies, restated here because the row is new:
 *
 *   1. a property with a value is ALWAYS drawn — a hidden choice the user made
 *      is worse than a crowded row;
 *   2. a property without a value is drawn only while the picker for it is the
 *      active one — i.e. never, on first open;
 *   3. the rest are reachable from an overflow entry (`onOpenOverflow`).
 *
 * Together these mean a fresh form shows a single compact「自定义属性」entry
 * rather than one chip per workspace property, which is what keeps a workspace
 * with twenty properties usable on a phone.
 *
 * ## Load state
 *
 * The catalog is read through `useActivePropertyCatalog`, whose four-state
 * contract (MYS-1892) is the reason this row renders NOTHING while the read is
 * unresolved rather than an empty row: an empty row would say "this workspace
 * has no custom properties", which the client does not know yet. A failed read
 * gets a retry affordance instead of that false claim.
 */
import { View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueProperty, IssuePropertyValue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { AttributeChip } from "@/components/issue/attribute-chip";
import { useActivePropertyCatalog } from "@/data/queries/properties";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { formatPropertyValue, propertyTypeIcon } from "@/lib/issue-properties";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

/** Short, single-line echo of a property value for a chip. */
function chipValueLabel(
  property: IssueProperty,
  value: IssuePropertyValue | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const display = formatPropertyValue(property, value);
  if (display === null) return t("properties.value.empty");
  switch (display.kind) {
    case "option":
      return display.option.name;
    case "options":
      return display.options.map((o) => o.name).join(", ");
    case "checkbox":
      return display.value ? t("properties.value.true") : t("properties.value.false");
    case "actors":
      // Resolved names need the member directory, and a chip is a summary. The
      // count is derived from the refs the VALUE holds — a read of the issue
      // payload — so it is true before any directory answers, and it never
      // prints the raw `member:<uuid>` refs. The editor sheet shows the names.
      return t("properties.value.actorCount", { count: display.refs.length });
    case "unknownActors":
      // A newer build wrote an actor kind this one cannot parse. Say so with
      // the same word the issue-detail chip uses rather than a count that would
      // claim to know how many there are.
      return t("properties.value.unknown");
    case "date":
    case "plain":
      return display.text;
  }
}

export function CreateFormPropertyRow() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const catalog = useActivePropertyCatalog(wsId);
  const values = useNewIssueDraftStore((s) => s.propertyValues);

  const withValue = catalog.definitions.filter((p) => values[p.id] !== undefined);

  const open = (propertyId: string) => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/new-issue-picker/property",
      params: { workspace: wsSlug, propertyId },
    });
  };

  const openOverflow = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/new-issue-picker/properties",
      params: { workspace: wsSlug },
    });
  };

  // Unresolved read: say nothing rather than "none".
  if (!catalog.isResolved) {
    if (catalog.state === "error") {
      return (
        <AttributeChip
          icon={<Ionicons name="refresh" size={14} color={theme.mutedForeground} />}
          label={t("newIssue.propertiesRetry")}
          variant="dimmed"
          onPress={catalog.retry}
        />
      );
    }
    return null;
  }

  // A workspace with no custom properties gains no chip at all.
  if (catalog.definitions.length === 0) return null;

  return (
    <View className="flex-row flex-wrap gap-2">
      {withValue.map((property) => (
        <AttributeChip
          key={property.id}
          icon={
            <Ionicons
              name={propertyTypeIcon(property.type)}
              size={13}
              color={theme.mutedForeground}
            />
          }
          label={`${property.name}: ${chipValueLabel(property, values[property.id], t)}`}
          variant="filled"
          onPress={() => open(property.id)}
        />
      ))}
      <AttributeChip
        icon={<Ionicons name="pricetag-outline" size={13} color={theme.mutedForeground} />}
        label={t("newIssue.propertiesAdd")}
        variant="dimmed"
        onPress={openOverflow}
      />
    </View>
  );
}

/** The overflow list of properties still unset — rendered by the
 *  `new-issue-picker/properties` route. */
export function NewIssuePropertyPickerBody() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const catalog = useActivePropertyCatalog(wsId);
  const values = useNewIssueDraftStore((s) => s.propertyValues);

  const rows = catalog.definitions.filter((p) => values[p.id] === undefined);

  return (
    <View className="flex-1">
      {rows.map((property) => (
        <AttributeRowButton
          key={property.id}
          property={property}
          onPress={() => {
            if (!wsSlug) return;
            router.push({
              pathname: "/[workspace]/new-issue-picker/property",
              params: { workspace: wsSlug, propertyId: property.id },
            });
          }}
        />
      ))}
      {catalog.isResolved && rows.length === 0 ? (
        <Text className="px-4 py-6 text-center text-body text-muted-foreground">
          {t("properties.value.noneAvailable")}
        </Text>
      ) : null}
    </View>
  );
}

function AttributeRowButton({
  property,
  onPress,
}: {
  property: IssueProperty;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <AttributeChip
      icon={
        <Ionicons
          name={propertyTypeIcon(property.type)}
          size={14}
          color={theme.mutedForeground}
        />
      }
      label={property.name || t("properties.value.untitled")}
      variant="dimmed"
      onPress={onPress}
    />
  );
}
