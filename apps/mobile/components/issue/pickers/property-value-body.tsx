/**
 * The value bodies for one custom property, host-agnostic (iteration 259,
 * MYS-2245).
 *
 * Both hosts that edit a property value need the same seven shapes (select /
 * multi_select / checkbox / date / text / number / url / actor / multi_actor);
 * what differs is only WHERE the committed value goes:
 *
 *   - `components/issue/pickers/property-value-editor.tsx` — an existing issue,
 *     written through `useSetIssueProperty`.
 *   - `app/(app)/[workspace]/new-issue-picker/property.tsx` — the not-yet-created
 *     draft, written into `useNewIssueDraftStore` and only fanned out to the
 *     server after the issue exists (web's own sequencing,
 *     `packages/views/modals/create-issue.tsx:483-508`).
 *
 * Before this split the bodies lived inside the issue-bound editor, so the
 * create form had no way to reuse them and simply had no property UI at all.
 * Copying them would have put two implementations of "what does the deadline
 * picker do" in the tree — the exact drift this repo's `lib/` layer exists to
 * prevent.
 *
 * This module is RN-facing (it renders), so it is exercised through the wiring
 * test rather than the Node decision lane; the DECISIONS it makes — which type
 * is editable, how a value summarises, whether an actor ref is parseable — stay
 * in `lib/issue-properties.ts`, which the Node lane does cover.
 */
import { useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueProperty, IssuePropertyValue } from "@multica/core/types";
import {
  MAX_ISSUE_PROPERTY_ACTOR_VALUES,
  actorRefValuesFromValue,
  formatActorRef,
  isActorPropertyType,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { CatalogEmptySlot } from "@/components/catalog/catalog-status";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { catalogRead, retryCatalogs } from "@/lib/catalog-read";
import {
  propertyOptions,
  propertyTypeIcon,
  toggleActorRefValue,
} from "@/lib/issue-properties";
import { matchesNameOrPinyin } from "@/lib/name-search";
import { toDateOnly, dateOnlyToLocalDate } from "@multica/core/issues/date";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

/** Types whose value can be written. Archived definitions and unknown types
 *  are read-only (the server rejects new values on an archived property but
 *  always allows unset — mirrors web `isCustomPropertyReadOnly`). */
export const PROPERTY_COMMIT_TYPES = new Set([
  "select",
  "multi_select",
  "date",
  "checkbox",
  "text",
  "number",
  "url",
  // Actor properties are editable: the phone writes `member:<user_id>` refs
  // through the same PUT the other types use. Leaving them out of this set
  // marked them read-only, so a member-valued property could be read but
  // never set from the app.
  "actor",
  "multi_actor",
]);

const TEXTISH_TYPES = new Set(["text", "number", "url"]);

export interface PropertyValueBodyProps {
  property: IssueProperty;
  value: IssuePropertyValue | undefined;
  /** Write a resolved value. For a multi-select whose last option was
   *  unticked the host is expected to CLEAR instead — callers route that
   *  through `onClear`, which this component does itself. */
  onCommit: (next: IssuePropertyValue) => void;
  onClear: () => void;
  /** Prefill for the text-ish input. The issue-bound host seeds it from the
   *  saved value once it lands; the draft host starts empty. */
  initialDraft?: string;
  /**
   * Reports the text-ish input's live contents.
   *
   * Both hosts put the "Done" affordance in their own HEADER (a plain list
   * body commits from its row, so a header Done there would be decoration),
   * and a header button has to know what was typed. Without this callback the
   * host would read its `initialDraft` seed forever and commit the value the
   * field held when the sheet OPENED — silently discarding the edit, which is
   * how this seam failed the first time it was written.
   *
   * Optional because the issue TABLE's cell editor mounts the body without a
   * header (it commits on blur), and a host that ignores it loses nothing.
   */
  onDraftChange?: (next: string) => void;
}

export function PropertyValueBody({
  property,
  value,
  onCommit,
  onClear,
  initialDraft = "",
  onDraftChange,
}: PropertyValueBodyProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [draft, setDraft] = useState(initialDraft);

  /** Keep the host's copy in step. Called on every keystroke, so the host's
   *  state stays a mirror rather than a second source of truth. */
  const updateDraft = (next: string) => {
    setDraft(next);
    onDraftChange?.(next);
  };

  const commitText = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onClear();
      return;
    }
    if (property.type === "number") {
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) return;
      onCommit(parsed);
      return;
    }
    onCommit(trimmed);
  };

  if (property.type === "select" || property.type === "multi_select") {
    return (
      <FlatList
        data={propertyOptions(property)}
        keyExtractor={(option) => option.id}
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        renderItem={({ item: option }) => {
          const multi = property.type === "multi_select";
          const list = Array.isArray(value) ? value : [];
          const selected = multi ? list.includes(option.id) : value === option.id;
          return (
            <Pressable
              onPress={() => {
                if (multi) {
                  const next = selected
                    ? list.filter((v) => v !== option.id)
                    : [...list, option.id];
                  // Unsetting to empty = clear (web's toggle→clear).
                  if (next.length === 0) onClear();
                  else onCommit(next);
                } else {
                  onCommit(option.id);
                }
              }}
              className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
            >
              <View
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: option.color }}
              />
              <Text
                className={cn(
                  "flex-1 text-title-sm",
                  selected ? "text-foreground font-medium" : "text-foreground",
                )}
                numberOfLines={1}
              >
                {option.name}
              </Text>
              {selected ? (
                <Ionicons name="checkmark" size={20} color={theme.primary} />
              ) : null}
            </Pressable>
          );
        }}
      />
    );
  }

  if (property.type === "checkbox") {
    return (
      <View className="flex-1">
        <CheckRow
          label={t("properties.value.true")}
          selected={value === true}
          onPress={() => onCommit(true)}
        />
        <View className="h-px bg-border ml-4" />
        <CheckRow
          label={t("properties.value.false")}
          selected={value === false}
          onPress={() => onCommit(false)}
        />
      </View>
    );
  }

  if (isActorPropertyType(property.type)) {
    return (
      <ActorRefBody
        property={property}
        value={value}
        onCommit={onCommit}
        onClear={onClear}
      />
    );
  }

  if (property.type === "date") {
    return (
      <DateBody
        value={typeof value === "string" ? value : null}
        onDone={(iso) => onCommit(iso)}
      />
    );
  }

  if (TEXTISH_TYPES.has(property.type)) {
    return (
      <View className="flex-1 px-4 pt-2">
        <TextInput
          autoFocus
          value={draft}
          onChangeText={updateDraft}
          keyboardType={
            property.type === "number"
              ? "decimal-pad"
              : property.type === "url"
                ? "url"
                : "default"
          }
          returnKeyType="done"
          onSubmitEditing={commitText}
          placeholder={
            property.type === "url"
              ? t("properties.value.urlPlaceholder")
              : property.type === "number"
                ? t("properties.value.numberPlaceholder")
                : t("properties.value.valuePlaceholder")
          }
          placeholderTextColor={theme.mutedForeground}
          className="border border-border rounded-md px-3 py-2.5 text-body text-foreground"
          style={{ fontSize: 14, includeFontPadding: false, textAlignVertical: "center" }}
        />
      </View>
    );
  }

  // A type this build cannot write. The host should have withheld entry
  // (`PROPERTY_COMMIT_TYPES`), so reaching here means a newer server type —
  // show the header glyph and say nothing false about the value.
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Ionicons
        name={propertyTypeIcon(property.type)}
        size={28}
        color={theme.mutedForeground}
      />
      <Text className="mt-2 text-body text-muted-foreground text-center">
        {t("properties.value.unsupportedType")}
      </Text>
    </View>
  );
}

/** The Done affordance for the text-ish bodies, which commit from the header
 *  rather than from a list row. Hosts that render a header use this; keeping
 *  the predicate beside the body prevents "header shows Done for a list body". */
export function propertyBodyHasDone(propertyType: string): boolean {
  return TEXTISH_TYPES.has(propertyType);
}

function CheckRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary">
      <Text className="flex-1 text-title-sm text-foreground">{label}</Text>
      {selected ? <Ionicons name="checkmark" size={20} color={theme.primary} /> : null}
    </Pressable>
  );
}

function DateBody({
  value,
  onDone,
}: {
  value: string | null;
  onDone: (iso: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => dateOnlyToLocalDate(value) ?? new Date());
  return (
    <View className="flex-1 items-center pt-2">
      <DateTimePicker
        value={draft}
        mode="date"
        display="inline"
        onChange={(_event, selected) => {
          if (selected) setDraft(selected);
        }}
        maximumDate={new Date(9999, 11, 31)}
      />
      <Pressable
        onPress={() => onDone(toDateOnly(draft))}
        className="mt-2 rounded-md px-4 py-2 active:bg-secondary"
      >
        <Text className="text-body font-medium text-primary">{t("common.done")}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Actor / multi_actor value body — the workspace member directory as a
 * selectable list, mirroring web's `ActorPropertyPicker`
 * (packages/views/issues/components/pickers/actor-property-picker.tsx):
 *
 *   actor        → tapping a member commits `member:<user_id>` and closes
 *   multi_actor  → tapping toggles in place and keeps the sheet open; the
 *                  value becomes `undefined` (= clear) when the last member
 *                  is unticked, matching web's `toggleActorRefValue`
 *
 * Members are the only kind either type accepts: web deliberately excludes
 * agents and squads here (an agent reference would drag in agent-visibility
 * rules, and a squad is a routing target rather than a person), so the list is
 * the member directory alone.
 *
 * Search runs through `matchesNameOrPinyin`, the same helper the assignee
 * picker uses, so a Chinese name is reachable by full pinyin, initials or
 * hybrid input.
 */
function ActorRefBody({
  property,
  value,
  onCommit,
  onClear,
}: {
  property: IssueProperty;
  value: IssuePropertyValue | undefined;
  onCommit: (next: IssuePropertyValue) => void;
  onClear: () => void;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [query, setQuery] = useState("");

  const members = catalogRead(useQuery(memberListOptions(wsId)));
  const multiple = property.type === "multi_actor";

  // Raw strings, not parsed refs: an entry whose kind this build cannot
  // resolve has to survive a toggle instead of being deleted when the user
  // ticks a member it does understand.
  const selected = actorRefValuesFromValue(value);
  const selectedKeys = new Set(selected);
  const atCapacity = multiple && selected.length >= MAX_ISSUE_PROPERTY_ACTOR_VALUES;

  const q = query.trim();
  const rows = members.items.filter(
    (member) => !q || matchesNameOrPinyin(member.name, q),
  );

  const commitMember = (userId: string) => {
    const key = formatActorRef("member", userId);
    if (!multiple) {
      onCommit(key);
      return;
    }
    const next = toggleActorRefValue(selected, key);
    if (next === undefined) onClear();
    else onCommit(next);
  };

  return (
    <View className="flex-1">
      <View className="px-4 pb-2">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("properties.value.actorSearchPlaceholder")}
          placeholderTextColor={theme.mutedForeground}
          autoCorrect={false}
          className="border border-border rounded-md px-3 py-2 text-body text-foreground"
          style={{ fontSize: 14, includeFontPadding: false, textAlignVertical: "center" }}
        />
        {atCapacity ? (
          <Text className="mt-2 text-caption text-muted-foreground">
            {t("properties.value.actorLimit", {
              count: MAX_ISSUE_PROPERTY_ACTOR_VALUES,
            })}
          </Text>
        ) : null}
      </View>
      <FlatList
        data={rows}
        className="flex-1"
        keyExtractor={(member) => member.user_id}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        renderItem={({ item: member }) => {
          const key = formatActorRef("member", member.user_id);
          const isSelected = selectedKeys.has(key);
          const disabled = atCapacity && !isSelected;
          return (
            <Pressable
              onPress={() => commitMember(member.user_id)}
              disabled={disabled}
              className={cn(
                "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                disabled && "opacity-40",
              )}
            >
              <ActorAvatar type="member" id={member.user_id} size={28} />
              <Text
                className={cn(
                  "flex-1 text-title-sm",
                  isSelected ? "text-foreground font-medium" : "text-foreground",
                )}
                numberOfLines={1}
              >
                {member.name}
              </Text>
              {isSelected ? (
                <Ionicons name="checkmark" size={20} color={theme.primary} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <CatalogEmptySlot
            states={[members.state]}
            onRetry={() => retryCatalogs(members)}
            emptyMessage={t("properties.value.actorSearchEmpty")}
            query={query}
          />
        }
      />
    </View>
  );
}
