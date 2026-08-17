/**
 * Description input block shared by `new-issue.tsx` and `issue/[id]/edit.tsx`.
 *
 * Focus-tinted `rounded-2xl` container wrapping the `AutosizeTextArea` and a
 * `MarkdownToolbar` — matches the "write markdown body" treatment used by the
 * comment composer so all three surfaces feel like the same control.
 *
 * The toolbar's image / file buttons upload through `useFileAttach` and
 * insert the server markdown link at the caret through `insertAtCursor`
 * (web content-editor parity). Newly bound attachment ids are reported via
 * `onAttachmentUploaded` so the caller can carry them into the issue
 * create / update payload (`attachment_ids`).
 *
 * Pure UI shell. The mention pipeline lives in the caller's `useMentionInput`
 * instance, passed in as `description`. Callers also own the floating
 * `MentionSuggestionBar` (it has to sit above the keyboard, outside the
 * scroll view).
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { MIN_BODY_INPUT_HEIGHT_PX } from "@/components/ui/input-tokens";
import { MarkdownToolbar } from "@/components/editor/markdown-toolbar";
import { useFileAttach } from "@/components/editor/use-file-attach";
import {
  insertMarkdown,
  type MarkdownInsertKind,
} from "@/lib/markdown-insert";
import {
  fileInsertMarkdown,
  imageInsertMarkdown,
} from "@/lib/description-upload";
import { cn } from "@/lib/utils";
import type { UseMentionInputReturn } from "@/lib/use-mention-input";
import { useTranslation } from "@/lib/i18n/react";

export function DescriptionField({
  description,
  disabled,
  placeholder,
  issueId,
  onAttachmentUploaded,
  onUploadingChange,
}: {
  description: UseMentionInputReturn;
  disabled: boolean;
  placeholder?: string;
  /** Editing an existing issue: uploads attach to it directly. */
  issueId?: string;
  /** Reports a freshly uploaded attachment id for `attachment_ids`. */
  onAttachmentUploaded?: (id: string) => void;
  /** Mirrors the in-flight upload flag so callers can gate submit — an
   *  attachment picked but not yet uploaded must never be left dangling. */
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const { pickAndUploadImage, pickAndUploadFile, uploading } = useFileAttach();
  const resolvedPlaceholder = placeholder ?? t("issue.descriptionPlaceholder");

  useEffect(() => {
    onUploadingChange?.(uploading);
  }, [uploading, onUploadingChange]);

  const applyMarkdown = (kind: MarkdownInsertKind) => {
    // Pure function computes the next text + selection; the hook applies it
    // and closes any open @ suggestion — toolbar inserts never produce a
    // mention, so the state machine stays consistent.
    description.applyMarkdownInsert(
      insertMarkdown(description.text, description.selection, kind),
    );
  };

  const attachContext = issueId ? { issueId } : undefined;

  const attachImage = async () => {
    try {
      const result = await pickAndUploadImage(attachContext);
      if (!result) return; // cancelled / failed — Alert already shown
      description.insertAtCursor(imageInsertMarkdown(result.markdownUrl));
      onAttachmentUploaded?.(result.id);
    } catch {
      // picker itself rejected (expo picker outage) — nothing inserted.
    }
  };

  const attachFile = async () => {
    try {
      const result = await pickAndUploadFile(attachContext);
      if (!result) return;
      description.insertAtCursor(
        fileInsertMarkdown(result.filename, result.markdownUrl),
      );
      onAttachmentUploaded?.(result.id);
    } catch {
      // see attachImage
    }
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
        onImage={attachImage}
        onFile={attachFile}
        disabled={disabled || uploading}
      />
    </View>
  );
}
