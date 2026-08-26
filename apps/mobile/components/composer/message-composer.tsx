/**
 * Shared message composer used by both the issue-comment thread and the
 * chat tab. Two visual states:
 *
 *   collapsed → pill button (configurable label / icon). Minimal vertical
 *               footprint so the list above gets the full screen.
 *   expanded  → optional reply chip → chip row (@ + image + file) →
 *               plain TextInput → toolbar (`@ 📷 📎 ──── [➤ or Stop]`).
 *
 * Mentions / images / files all live in the chip row OUTSIDE the text
 * input. The input itself is a plain RN `<TextInput multiline>` — no
 * controlled selection, no inline overlays. On submit the composer
 * prepends mention markdown links to the typed text and attaches
 * `attachmentIds`. Server-side mention regex
 * (`server/internal/util/mention.go:16`) parses them as if they were
 * inline.
 *
 * Mention picker is a formSheet route, pushed via `mentionPickerPath`.
 * That route writes selections into `useMentionDraftStore`; this composer
 * reads from the same store.
 *
 * Why a shared component:
 *   - Comment and chat composers want byte-identical UI / interaction.
 *   - Chat-specific differences are slim: controlled draft text (parent
 *     owns the value for cross-session persistence), Stop button during
 *     agent execution. Both addressed via optional props.
 *
 * What this component does NOT own:
 *   - The submit action — `onSubmit` is the caller's escape hatch (it
 *     wires `useCreateComment` on the comment side, the chat send burst
 *     on the chat side).
 *   - Reply target lifecycle — comment passes in `replyTarget` +
 *     `onClearReplyTarget` from its store; chat doesn't.
 *   - Stop visual / animation — chat passes a `renderStop()` slot when
 *     `isSending` is true.
 *
 * Cleanup: mention draft store cleared on unmount so navigating away
 * from comment-A's draft doesn't leak `@张三` into comment-B's composer.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, ActivityIndicator, Keyboard, Pressable, ScrollView, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { api, MAX_FILE_SIZE } from "@/data/api";
import { useMentionDraftStore } from "@/data/stores/mention-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { quickActionListOptions } from "@/data/queries/quick-actions";
import {
  buildBuiltinCommandItems,
  buildChatSkillItems,
  isQuickActionItem,
  matchSlashTrigger,
  quickActionIdFromItem,
  replaceSlashTrigger,
  type ChatSkillInput,
  type SlashCommandItem,
} from "@/lib/slash-command";
import { useColorScheme } from "@/lib/use-color-scheme";
import { stripMarkdown } from "@/lib/strip-markdown";
import { THEME } from "@/lib/theme";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { IconButton } from "@/components/ui/icon-button";
import {
  ComposerAttachmentRow,
  type ComposerAttachmentItem,
  type MentionChip,
} from "@/components/issue/composer-attachment-row";

export interface MessageComposerReplyTarget {
  actorName: string;
  preview: string;
}

interface Props {
  /** Submit callback. Composer awaits this; on rejection it restores text,
   *  attachments, and mentions so the user can retry without losing
   *  context. Resolved promise → text + chips cleared, composer collapses
   *  back to pill. */
  onSubmit: (args: {
    content: string;
    attachmentIds: string[];
    mentions: MentionChip[];
    /** Agents the user skipped via the trigger preview. Populated by the
     *  comment composer (see `suppressAgentIds` prop); chat ignores it. */
    suppressAgentIds?: string[];
  }) => Promise<void>;

  /** Push target for the `@` button. The picker route reads /
   *  writes `useMentionDraftStore` directly. */
  mentionPickerPath: Href;

  /** Attachment upload context — forwarded to `api.uploadFile`. Comment
   *  passes `issueId`; chat omits both (uploads are session-scoped via
   *  the message id assigned by the server post-send). */
  uploadContext?: { issueId?: string; commentId?: string };

  placeholder?: string;
  pillLabel?: string;
  pillIcon?: keyof typeof Ionicons.glyphMap;

  /** Optional controlled-text mode. When `value` + `onChangeText` are
   *  both provided, the parent owns the draft (chat: persists to its
   *  draft store across sessions). When omitted, composer manages its
   *  own internal text state (comment). */
  value?: string;
  onChangeText?: (next: string) => void;

  /** Optional reply chip (comment only). */
  replyTarget?: MessageComposerReplyTarget | null;
  onClearReplyTarget?: () => void;

  /** Composer enters "auto-expanded + focused" mode when this changes to
   *  a truthy stable key. Comment uses it to react to long-press → reply
   *  flow. Chat doesn't pass it. */
  expandTrigger?: string | null;

  /** When `isSending` is true AND `renderStop` is provided, the trailing
   *  send button is replaced by whatever `renderStop` returns. Chat uses
   *  this to show a Stop affordance while the agent is running. */
  isSending?: boolean;
  renderStop?: () => ReactNode;

  /** Hard-disable. Used when chat has no usable agent. The pill shows
   *  `disabledReason` instead of `pillLabel`, and the pill is
   *  non-interactive (cannot expand). */
  disabled?: boolean;
  disabledReason?: string;

  /** Comment-mode trigger-preview slot: rendered BELOW the editor while
   *  expanded, receiving the live draft (mention chips + plain text) so the
   *  caller can rebuild the exact markdown the server will see and render
   *  "who will start" chips. Mounts only when expanded, so the preview
   *  fetch never runs for a collapsed pill. */
  triggerPreviewSlot?: (draft: {
    text: string;
    mentions: MentionChip[];
  }) => ReactNode;

  /** Agents the user skipped via the trigger preview. Forwarded to
   *  `onSubmit` so the server does not enqueue runs for these targets. */
  suppressAgentIds?: string[];

  /** When true the composer renders flush at the bottom of its parent
   *  while a `KeyboardStickyView` lifts it above the IME and the
   *  safe-area bottom inset is added (default). Chat and the inline
   *  issue comment composer both use this. Pass false only when a parent
   *  already owns keyboard handling and bottom-inset compensation. */
  manageKeyboard?: boolean;

  /** Enables the `/` command menu (MYS-681). Issue comment mode passes
   *  the issueId: typing a trailing `/` arms the menu of active quick
   *  actions + `/note`; picking a quick action inserts the server-
   *  rendered body (editable before send), `/note` inserts the plain
   *  prefix. Chat omits it — its `/` menu is the agent-skill picker
   *  below (`slashSkills`).
   *
   *  Exactly one of `slashCommands` / `slashSkills` is set per composer
   *  instance; both arm on the same trailing `/token` trigger. */
  slashCommands?: { issueId: string };

  /** Enables the chat `/` skill picker (MYS-682): typing a trailing `/`
   *  opens the active agent's skills (name + description, prefix/
   *  substring filter, MAX 20), picking one inserts `/{name} ` with a
   *  trailing space so the token stops matching. Unlike the quick-action
   *  menu the insert is synchronous plain text. An agent with no skills
   *  arms nothing — web's "no skills configured" empty state is skipped
   *  on mobile so normal typing is never interrupted (see MYS-682). */
  slashSkills?: ChatSkillInput[];
}

function makeLocalId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Serialises mention chips into the markdown link form the backend
 *  regex parser recognises. The string lands at the START of the
 *  outgoing content; mobile can't position mentions inline because the
 *  TextInput is plain. Acceptable semantic difference vs web/desktop's
 *  rich editor (web supports anywhere-in-text).
 *
 *  Exported so the comment-side trigger-preview slot rebuilds the EXACT
 *  content the composer will submit — one source of truth for both. */
export function serializeMentions(chips: MentionChip[]): string {
  return chips
    .map((m) => {
      const label =
        m.type === "issue"
          ? m.name
          : m.type === "all"
            ? "@all"
            : `@${m.name}`;
      return `[${label}](mention://${m.type}/${m.id})`;
    })
    .join(" ");
}

export function MessageComposer({
  onSubmit,
  mentionPickerPath,
  uploadContext,
  placeholder = "Type a message…",
  pillLabel = "Type a message…",
  pillIcon = "chatbubble-ellipses-outline",
  value: controlledValue,
  onChangeText: controlledOnChange,
  replyTarget = null,
  onClearReplyTarget,
  expandTrigger,
  isSending = false,
  renderStop,
  disabled = false,
  disabledReason,
  manageKeyboard = true,
  slashCommands,
  slashSkills,
  triggerPreviewSlot,
  suppressAgentIds,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [expanded, setExpanded] = useState(false);
  const [internalText, setInternalText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachmentItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Hybrid controlled / uncontrolled pattern (React-canonical). Chat
  // passes `value`/`onChangeText` for cross-session draft persistence;
  // comment omits both and the composer manages local state.
  const isControlled =
    controlledValue !== undefined && controlledOnChange !== undefined;
  const text = isControlled ? controlledValue : internalText;
  const setText = useCallback(
    (next: string) => {
      if (isControlled) {
        controlledOnChange(next);
      } else {
        setInternalText(next);
      }
    },
    [isControlled, controlledOnChange],
  );

  const mentions = useMentionDraftStore((s) => s.mentions);
  const removeMention = useMentionDraftStore((s) => s.remove);
  const clearMentions = useMentionDraftStore((s) => s.clear);

  // --- `/` menu: quick-action commands (issue comments, MYS-681) or
  // agent-skill picker (chat, MYS-682) --------------------------------
  // Armed on a TRAILING whitespace-delimited `/token` (see matchSlashTrigger).
  // The menu catalog re-derives on every render from its source: the
  // workspace's active quick actions (data arriving after the menu opens
  // grows it in place) or the active agent's skills from the chat screen.
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: quickActions = [] } = useQuery({
    ...quickActionListOptions(wsId, false),
    enabled: !!wsId && !!slashCommands,
  });
  const activeQuickActions = quickActions.filter((a) => a.status === "active");
  const [slashTrigger, setSlashTrigger] = useState<{
    from: number;
    query: string;
  } | null>(null);
  const [slashPendingId, setSlashPendingId] = useState<string | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // Which `/` catalog mode is active: issue-comment quick-action commands or
  // the chat agent-skill picker. Exactly one prop is ever set per instance.
  const slashMode: "commands" | "skills" | null = slashCommands
    ? "commands"
    : slashSkills
      ? "skills"
      : null;
  const buildCatalog = useCallback(
    (query: string): SlashCommandItem[] =>
      slashMode === "commands"
        ? buildBuiltinCommandItems(query, activeQuickActions)
        : slashMode === "skills" && slashSkills
          ? buildChatSkillItems(query, slashSkills)
          : [],
    [slashMode, activeQuickActions, slashSkills],
  );

  // Recompute the menu per keystroke: a re-arm clears the trigger when the
  // token stops matching (or no item matches); otherwise the visible items
  // refilter live.
  const onTextChange = useCallback(
    (next: string) => {
      setText(next);
      if (!slashMode) return;
      const trig = matchSlashTrigger(next);
      setSlashTrigger(trig && buildCatalog(trig.query).length > 0 ? trig : null);
    },
    [setText, slashMode, buildCatalog],
  );

  const slashMenuItems =
    slashTrigger && slashMode ? buildCatalog(slashTrigger.query) : [];
  const slashMenuVisible =
    slashTrigger !== null && slashMode !== null && slashMenuItems.length > 0;

  const pickSlashItem = useCallback(
    (item: SlashCommandItem) => {
      if (!slashTrigger || !slashMode) return;
      const { from, query } = slashTrigger;

      if (slashMode === "skills") {
        // Chat skill picker — synchronous plain-text insert with a trailing
        // space so the token stops matching and the menu does not re-open.
        // Web inserts a slashCommand node rendered as `/[label]` (MYS-682);
        // mobile has no such node type, and the byte-identical `/{name} `
        // prefix is what the user sees either way.
        setText(
          replaceSlashTrigger(textRef.current, from, query, `/${item.label} `),
        );
        setSlashTrigger(null);
        return;
      }

      if (slashMode === "commands" && slashCommands && isQuickActionItem(item)) {
        const qaid = quickActionIdFromItem(item);
        setSlashPendingId(qaid);
        void (async () => {
          try {
            // The "/query" text is deliberately left in place while the
            // request is in flight — web deletes nothing until the render
            // resolves (slash-command-suggestion.tsx command handler).
            const content = await api.renderQuickAction(
              slashCommands.issueId,
              qaid,
            );
            // Empty body = "insert nothing"; the command text stays put so
            // the user can pick again or edit it by hand.
            if (!content) return;
            // Mid-flight edit guard: replaceSlashTrigger no-ops when the text
            // under `from` no longer equals `/${query}`, mirroring web's doc
            // snapshot check. Menu closes only on a real insert.
            const applied = replaceSlashTrigger(
              textRef.current,
              from,
              query,
              content,
            );
            if (applied === textRef.current) return;
            setText(applied);
            setSlashTrigger(null);
          } catch (err) {
            // The command text is still there, so the user can retry.
            Alert.alert(
              t("composer.slashCommandErrorTitle"),
              err instanceof Error ? err.message : "Unknown error",
            );
          } finally {
            setSlashPendingId(null);
          }
        })();
        return;
      }

      // Built-in `/note` — insert the plain-text prefix with a trailing space
      // so the token stops matching and the menu does not re-open. Hand-typed
      // and menu-picked `/note ` are byte-identical for the backend prefix
      // match (web BUILTIN_COMMANDS).
      setText(replaceSlashTrigger(textRef.current, from, query, "/note "));
      setSlashTrigger(null);
    },
    [slashTrigger, slashMode, slashCommands, setText, t],
  );

  // Drop mention draft on composer unmount so navigating away doesn't
  // leak chips into the next composer's session.
  useEffect(() => {
    return () => {
      clearMentions();
    };
  }, [clearMentions]);

  // Auto-expand + focus when an `expandTrigger` changes. Comment uses
  // this to react to the long-press → reply flow setting a reply target.
  const triggerSeen = useRef<string | null>(null);
  if (
    expandTrigger &&
    triggerSeen.current !== expandTrigger &&
    !disabled
  ) {
    triggerSeen.current = expandTrigger;
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const hasInFlightUpload = attachments.some((a) => a.status === "uploading");
  const canSend =
    !disabled &&
    !isSending &&
    !submitting &&
    !hasInFlightUpload &&
    (text.trim().length > 0 || mentions.length > 0);

  const expand = useCallback(() => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExpanded(true);
    // Tapping the pill = "I want to write a new message". Drop any
    // lingering reply target so a stale chip from a prior long-press →
    // dismiss-without-send cycle doesn't bleed into the fresh draft.
    onClearReplyTarget?.();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled, onClearReplyTarget]);

  const handleSubmit = useCallback(async () => {
    if (!canSend) return;
    const textSnap = text;
    const mentionsSnap = mentions;
    const attachmentsSnap = attachments;

    const mentionMd = serializeMentions(mentionsSnap);
    const trimmed = textSnap.trim();
    const content = mentionMd
      ? trimmed
        ? `${mentionMd} ${trimmed}`
        : mentionMd
      : trimmed;

    const activeIds = attachmentsSnap
      .filter((a) => a.status === "completed")
      .map((a) => a.id)
      .filter((id): id is string => !!id);

    // Optimistic clear: text + chips empty out immediately so the next
    // typing tick doesn't double-include them. Restored on rejection.
    setSlashTrigger(null);
    setText("");
    setAttachments([]);
    clearMentions();
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    try {
      await onSubmit({
        content,
        attachmentIds: activeIds,
        mentions: mentionsSnap,
        suppressAgentIds,
      });
      // Success → fully exit composing mode. Explicit triple-step
      // because a missing blur leaves the keyboard up; missing
      // Keyboard.dismiss races on iOS when focus is in-flight; missing
      // setExpanded(false) leaves the expanded card on screen.
      inputRef.current?.blur();
      Keyboard.dismiss();
      setExpanded(false);
    } catch {
      setText(textSnap);
      setAttachments(attachmentsSnap);
      mentionsSnap.forEach((m) =>
        useMentionDraftStore.getState().toggle(m),
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    canSend,
    text,
    mentions,
    attachments,
    setText,
    clearMentions,
    onSubmit,
    suppressAgentIds,
  ]);

  /** Streams a picked asset to /api/upload-file, updating the matching
   *  thumbnail's status as it goes. Pulled out so retry can call it
   *  again without re-opening the picker. */
  const startUpload = useCallback(
    async (
      localId: string,
      asset: { uri: string; name: string; type: string },
    ) => {
      try {
        const result = await api.uploadFile(asset, uploadContext);
        setAttachments((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? {
                  ...it,
                  status: "completed",
                  id: result.id,
                  url: result.url,
                  downloadUrl: result.download_url,
                }
              : it,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setAttachments((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? { ...it, status: "failed", error: message }
              : it,
          ),
        );
      }
    },
    [uploadContext],
  );

  const onImagePress = useCallback(async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (picker.canceled) return;
    const picked = picker.assets[0];
    if (!picked) return;
    if (picked.fileSize != null && picked.fileSize > MAX_FILE_SIZE) {
      Alert.alert(t("common.fileTooLarge"), t("common.fileTooLargeMessage"));
      return;
    }
    const filename = picked.fileName ?? `image-${Date.now()}.jpg`;
    const mimeType = picked.mimeType ?? "image/jpeg";
    const localId = makeLocalId();
    setAttachments((prev) => [
      ...prev,
      {
        localId,
        localUri: picked.uri,
        filename,
        mimeType,
        status: "uploading",
      },
    ]);
    requestAnimationFrame(() => inputRef.current?.focus());
    await startUpload(localId, {
      uri: picked.uri,
      name: filename,
      type: mimeType,
    });
  }, [startUpload, t]);

  const onFilePress = useCallback(async () => {
    const picker = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picker.canceled) return;
    const picked = picker.assets[0];
    if (!picked) return;
    if (picked.size != null && picked.size > MAX_FILE_SIZE) {
      Alert.alert(t("common.fileTooLarge"), t("common.fileTooLargeMessage"));
      return;
    }
    const mimeType = picked.mimeType ?? "application/octet-stream";
    const localId = makeLocalId();
    setAttachments((prev) => [
      ...prev,
      {
        localId,
        localUri: picked.uri,
        filename: picked.name,
        mimeType,
        status: "uploading",
      },
    ]);
    requestAnimationFrame(() => inputRef.current?.focus());
    await startUpload(localId, {
      uri: picked.uri,
      name: picked.name,
      type: mimeType,
    });
  }, [startUpload, t]);

  const onRemoveAttachment = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((it) => it.localId !== localId));
  }, []);

  const onRetryAttachment = useCallback(
    (localId: string) => {
      const item = attachments.find((it) => it.localId === localId);
      if (!item) return;
      setAttachments((prev) =>
        prev.map((it) =>
          it.localId === localId
            ? { ...it, status: "uploading", error: undefined }
            : it,
        ),
      );
      void startUpload(localId, {
        uri: item.localUri,
        name: item.filename,
        type: item.mimeType,
      });
    },
    [attachments, startUpload],
  );

  const onAtPress = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    // `/` and `@` pickers never co-exist: opening the mention sheet closes
    // any armed slash menu so it can't linger over the returned composer
    // (MYS-682 exclusivity).
    setSlashTrigger(null);
    router.push(mentionPickerPath);
  }, [mentionPickerPath]);

  /** Auto-collapse to pill when input loses focus AND nothing's worth
   *  keeping the composer expanded for. Deferred one tick so a toolbar
   *  IconButton tap (which briefly resigns first responder) doesn't
   *  trigger a collapse before its onPress runs. */
  const onBlur = useCallback(() => {
    setTimeout(() => {
      const empty =
        text.trim().length === 0 &&
        attachments.length === 0 &&
        mentions.length === 0;
      if (empty && !inputRef.current?.isFocused()) {
        setExpanded(false);
        onClearReplyTarget?.();
        setSlashTrigger(null);
      }
    }, 80);
  }, [text, attachments.length, mentions.length, onClearReplyTarget]);

  const pillContent = (
    <View
      className="border-t border-border bg-background px-3 pt-2"
      style={{ paddingBottom: (manageKeyboard ? insets.bottom : 0) + 8 }}
    >
      <Pressable
        onPress={expand}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={pillLabel}
        accessibilityState={{ disabled }}
        className="flex-row items-center gap-2 h-11 px-4 rounded-full bg-secondary active:opacity-80"
      >
        <Ionicons
          name={pillIcon}
          size={18}
          color={theme.mutedForeground}
        />
        <Text className="text-base text-muted-foreground">
          {disabled && disabledReason ? disabledReason : pillLabel}
        </Text>
      </Pressable>
    </View>
  );

  const expandedContent = (
    <View
      className="bg-background px-3 pt-2 gap-2"
      style={{ paddingBottom: (manageKeyboard ? insets.bottom : 0) + 4 }}
    >
      {replyTarget && (
        <View className="px-3 py-1.5 rounded-md bg-secondary/60 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Ionicons
              name="return-up-back"
              size={14}
              color={theme.mutedForeground}
            />
            <Text
              className="flex-1 text-xs font-medium text-muted-foreground"
              numberOfLines={1}
            >
              {t("chat.replyingTo", { name: replyTarget.actorName })}
            </Text>
            <Pressable
              onPress={onClearReplyTarget}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.cancelReply")}
            >
              <Ionicons
                name="close-circle"
                size={16}
                color={theme.mutedForeground}
              />
            </Pressable>
          </View>
          {replyTarget.preview ? (
            <Text
              className="text-xs text-muted-foreground pl-5"
              numberOfLines={2}
            >
              {stripMarkdown(replyTarget.preview)}
            </Text>
          ) : null}
        </View>
      )}

      <View
        className="rounded-3xl border border-border bg-secondary"
        style={{ borderCurve: "continuous" }}
      >
        {(mentions.length > 0 || attachments.length > 0) ? (
          <View className="px-2 pt-2 pb-1">
            <ComposerAttachmentRow
              mentions={mentions}
              attachments={attachments}
              onRemoveMention={removeMention}
              onRemoveAttachment={onRemoveAttachment}
              onRetryAttachment={onRetryAttachment}
            />
          </View>
        ) : null}

        <View className="relative">
          {slashMenuVisible ? (
            <View
              className="absolute left-2 right-2 bottom-full mb-1 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
              style={{ maxHeight: 240, elevation: 6 }}
            >
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {slashMenuItems.map((item) => {
                  const qa = isQuickActionItem(item);
                  const pending =
                    qa && slashPendingId === quickActionIdFromItem(item);
                  const description =
                    item.id === "note"
                      ? t("composer.slashNoteDescription")
                      : item.description;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => pickSlashItem(item)}
                      disabled={pending}
                      accessibilityRole="button"
                      accessibilityLabel={`/${item.label}`}
                      className="flex-row items-center gap-2 px-3 py-2 active:bg-secondary"
                    >
                      {pending ? (
                        <ActivityIndicator
                          size="small"
                          color={theme.primary}
                        />
                      ) : (
                        <Ionicons
                          name={
                            qa
                              ? "flash-outline"
                              : slashMode === "skills"
                                ? "sparkles-outline"
                                : "document-text-outline"
                          }
                          size={16}
                          color={theme.mutedForeground}
                        />
                      )}
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-foreground">
                          /{item.label}
                        </Text>
                        {description ? (
                          <Text
                            className="text-xs text-muted-foreground"
                            numberOfLines={1}
                          >
                            {description}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={onTextChange}
            onBlur={onBlur}
            placeholder={placeholder}
            placeholderTextColor={theme.mutedForeground}
            multiline
            editable={!disabled}
            className="px-4 pt-3 pb-1 text-base text-foreground"
            style={{ minHeight: 28, maxHeight: 140, textAlignVertical: "top" }}
          />
        </View>

        <View className="flex-row items-center px-2 pb-2 pt-1">
          {/* @ leads the toolbar — highest-signal attachment (only one
           *  that drives notifications) and cross-resource (people +
           *  issues), pride-of-place left. */}
          <IconButton
            name="at"
            iconSize={20}
            color={mentions.length > 0 ? theme.primary : undefined}
            onPress={onAtPress}
            accessibilityLabel={t("a11y.mentionSomeone")}
            className="h-8 w-8"
          />
          <IconButton
            name="image-outline"
            iconSize={20}
            onPress={onImagePress}
            accessibilityLabel={t("a11y.uploadImage")}
            className="h-8 w-8"
          />
          <IconButton
            name="attach-outline"
            iconSize={20}
            onPress={onFilePress}
            accessibilityLabel={t("a11y.uploadFile")}
            className="h-8 w-8"
          />
          <View className="flex-1" />
          {isSending && renderStop ? (
            renderStop()
          ) : (
            <IconButton
              name="arrow-up"
              iconSize={18}
              color={theme.primaryForeground}
              variant="default"
              onPress={handleSubmit}
              disabled={!canSend}
              hitSlop={12}
              className="h-8 w-8 rounded-full"
              accessibilityLabel={t("a11y.send")}
              accessibilityState={{ disabled: !canSend }}
            />
          )}
        </View>
      </View>

      {triggerPreviewSlot ? (
        <View className="rounded-lg bg-secondary/40 px-1.5 pb-0.5 pt-1">
          {triggerPreviewSlot({ text, mentions })}
        </View>
      ) : null}
    </View>
  );

  const body = expanded ? expandedContent : pillContent;

  // When a parent owns keyboard handling instead (rare; pass
  // manageKeyboard={false}), skip the KeyboardStickyView — double-stacking
  // causes the composer to jump twice on keyboard show.
  if (!manageKeyboard) return body;

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
      {body}
    </KeyboardStickyView>
  );
}
