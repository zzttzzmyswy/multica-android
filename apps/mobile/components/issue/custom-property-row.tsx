/**
 * Issue-detail custom-property chips (MYS-334). Rendered below the standard
 * AttributeRow: every workspace property with a value on this issue appears
 * as a chip, resolved via the workspace definition catalog (archived
 * definitions included — an issue can carry a value for an archived
 * property and the chip must still render its option names / labels).
 *
 * Value rendering mirrors web's CustomPropertyValueDisplay:
 *   select        → colored dot + option name
 *   multi_select  → one mini chip per resolved option (colored dot + name)
 *   checkbox      → check/close glyph + yes/no
 *   date          → calendar glyph + formatted day
 *   text/number/url → type glyph + raw text
 * A value whose option id vanished from the definition (option deleted)
 * drops out instead of rendering a raw UUID.
 *
 * Tapping a chip opens the value editor formSheet
 * (issue/[id]/picker/property); a "+" chip opens the add-property list
 * (issue/[id]/picker/properties), shown only while active unset
 * definitions remain.
 */
import { useMemo } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { AttributeChip } from "./attribute-chip";
import { propertyCatalogOptions } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  formatPropertyValue,
  propertyTypeIcon,
} from "@/lib/issue-properties";
import { useTranslation } from "@/lib/i18n/react";

export function CustomPropertyRow({ issue }: { issue: Issue }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { data: catalog } = useQuery(propertyCatalogOptions(wsId));

  const { entries, addableCount } = useMemo(() => {
    const definitions = catalog ?? [];
    const set = issue.properties ?? {};
    const withValue = definitions.filter((p) => set[p.id] !== undefined);
    const unsetActive = definitions.filter(
      (p) => !p.archived && set[p.id] === undefined,
    );
    return { entries: withValue, addableCount: unsetActive.length };
  }, [catalog, issue.properties]);

  if (entries.length === 0 && addableCount === 0) return null;

  const openEditor = (propertyId: string) => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issue/[id]/picker/property",
      params: { workspace: wsSlug, id: issue.id, propertyId },
    });
  };

  const openAdd = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issue/[id]/picker/properties",
      params: { workspace: wsSlug, id: issue.id },
    });
  };

  return (
    <View className="flex-row flex-wrap gap-2">
      {entries.map((property) => {
        const raw = (issue.properties ?? {})[property.id];
        const display = formatPropertyValue(property, raw);
        // Unrenderable value (select option deleted, unset, unparseable
        // date): skip — same convention as web's display component.
        if (display === null) return null;
        switch (display.kind) {
          case "option":
            return (
              <AttributeChip
                key={property.id}
                icon={
                  <View
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: display.option.color }}
                  />
                }
                label={display.option.name}
                onPress={() => openEditor(property.id)}
              />
            );
          case "options":
            return (
              <View key={property.id} className="flex-row flex-wrap items-center gap-2">
                {display.options.map((option) => (
                  <AttributeChip
                    key={option.id}
                    icon={
                      <View
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: option.color }}
                      />
                    }
                    label={option.name}
                    onPress={() => openEditor(property.id)}
                  />
                ))}
              </View>
            );
          case "checkbox":
            return (
              <AttributeChip
                key={property.id}
                icon={
                  <Text className="text-xs">
                    {display.value ? "☑" : "☐"}
                  </Text>
                }
                label={
                  display.value
                    ? t("properties.value.true")
                    : t("properties.value.false")
                }
                onPress={() => openEditor(property.id)}
              />
            );
          case "date":
            return (
              <AttributeChip
                key={property.id}
                icon={<Ionicons name="calendar" size={13} />}
                label={display.text}
                onPress={() => openEditor(property.id)}
              />
            );
          default:
            return (
              <AttributeChip
                key={property.id}
                icon={
                  <Ionicons
                    name={propertyTypeIcon(property.type)}
                    size={13}
                  />
                }
                label={display.text}
                onPress={() => openEditor(property.id)}
              />
            );
        }
      })}
      {addableCount > 0 ? (
        <AttributeChip
          icon={<Ionicons name="add" size={13} />}
          label={t("properties.value.addProperty")}
          variant="dimmed"
          onPress={openAdd}
        />
      ) : null}
    </View>
  );
}