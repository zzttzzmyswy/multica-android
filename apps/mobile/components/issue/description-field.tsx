/**
 * Description input block shared by `new-issue.tsx` and `issue/[id]/edit.tsx`.
 *
 * Focus-tinted `rounded-2xl` container wrapping the `AutosizeTextArea` and a
 * `MarkdownToolbar` — matches the "write markdown body" treatment used by the
 * comment composer so all three surfaces feel like the same control.
 *
 * Pure UI shell. The mention pipeline lives in the caller's `useMentionInput`
 * instance, passed in as `description`. Callers also own the floating
 * `MentionSuggestionBar` (it has to sit above the keyboard, outside the
 * scroll view).
 */
import { useState } from "react";
import { View } from "react-native";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { MIN_BODY_INPUT_HEIGHT_PX } from "@/components/ui/input-tokens";
import { MarkdownToolbar } from "@/components/editor/markdown-toolbar";
import {
  insertMarkdown,
  type MarkdownInsertKind,
} from "@/lib/markdown-insert";
import { cn } from "@/lib/utils";
import type { UseMentionInputReturn } from "@/lib/use-mention-input";
import { useTranslation } from "@/lib/i18n/react";

export function DescriptionField({
  description,
  disabled,
  placeholder,
}: {
  description: UseMentionInputReturn;
  disabled: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const resolvedPlaceholder = placeholder ?? t("issue.descriptionPlaceholder");

  const applyMarkdown = (kind: MarkdownInsertKind) => {
    // Pure function computes the next text + selection; the hook applies it
    // and closes any open @ suggestion — toolbar inserts never produce a
    // mention, so the state machine stays consistent.
    description.applyMarkdownInsert(
      insertMarkdown(description.text, description.selection, kind),
    );
  };

  return (
    <View
      className={cn(
        "rounded-2xl border px-3 overflow-hidden",
        focused
          ? "border-primary/30 bg-secondary"
          : "border-transparent bg-secondary/40",
      )}
    >
      <AutosizeTextArea
        value={description.text}
        onChangeText={description.handlers.onChangeText}
        selection={description.selection}
        onSelectionChange={description.handlers.onSelectionChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={resolvedPlaceholder}
        className="py-2"
        minHeight={MIN_BODY_INPUT_HEIGHT_PX}
        editable={!disabled}
      />
      <MarkdownToolbar
        onAt={description.handlers.onAtButtonPress}
        onList={() => applyMarkdown("list")}
        onCheckbox={() => applyMarkdown("checkbox")}
        onCode={() => applyMarkdown("code")}
        onQuote={() => applyMarkdown("quote")}
        disabled={disabled}
      />
    </View>
  );
}
