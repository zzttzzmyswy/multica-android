/**
 * Confirm surface for "create a sub-issue from this comment" (MYS-2137).
 *
 * The whole point of this screen is that the member SEES WHAT WILL BE CARRIED
 * before the write happens. Web reaches the same goal with a two-pane modal; a
 * phone has neither the width nor the room for that, so the tradeoff this
 * screen makes is:
 *
 *  - ONE scrollable page instead of web's two panes. The frozen context (source
 *    task, thread size, byte/attachment caps) is a short summary block at the
 *    TOP, so "what am I carrying" is answered before the title field, never
 *    behind a tab.
 *  - The context block is READ-ONLY. There is nothing to edit about a captured
 *    thread; the only decision here is what the new task says.
 *  - `manual` / `agent` is a segmented control rather than two modal modes. It
 *    changes what the form below collects — a title, or a prompt — which is the
 *    one thing that actually differs between them.
 *
 * ## Why the create button is gated on `previewIsUsable`
 *
 * `capture_token` is the server's proof of what the member was shown. The write
 * is refused without one, and `parseWithFallback` yields an empty preview with
 * `capture_token: ""` when the response drifts — so a create button that stayed
 * enabled would fail on every tap with no way for the member to tell why. The
 * gate turns that into a visible "could not load the preview" state instead.
 *
 * ## Why the stale-token refusal needs no branch here
 *
 * It is the one outcome the member can act on (refreshing the preview mints a
 * new token and the same create then succeeds). `isSourceContextChangedError`
 * classifies it in `lib/source-context.ts`, and `useCreateCommentSubIssue`
 * pins the substitution to the server's own code — so the alert arrives through
 * the shared write-failure channel with the right sentence and this surface only
 * has to stay open with the draft intact for the retry.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommentSubIssueMode } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { commentSubIssuePreviewOptions } from "@/data/queries/issues";
import { useCreateCommentSubIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { ActorNameText } from "@/components/ui/actor-name";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  commentSubIssueModes,
  formatCaptureBytes,
  previewIsUsable,
  previewThreadSize,
} from "@/lib/source-context";

export function SourceContextCreateBody({
  commentId,
  sourceIssueId,
  sourceIssueIdentifier,
}: {
  commentId: string;
  /** The issue the comment lives on. The created child is parented to it
   *  server-side, so it is what the settle invalidation has to refresh — the
   *  mutation cannot derive it from a comment id. */
  sourceIssueId: string;
  sourceIssueIdentifier?: string;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const create = useCreateCommentSubIssue();
  const { resolveActorName } = useActorLookup();

  const [mode, setMode] = useState<CommentSubIssueMode>("manual");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");

  // `isError` is deliberately not destructured: the load-failed state is driven
  // by `previewIsUsable` below, which covers BOTH a rejected request and a
  // response that parsed into the empty fallback. Keying any part of the UI off
  // `isError` would leave the drifted-response half of that pair unhandled.
  const { data: preview, isLoading } = useQuery(
    commentSubIssuePreviewOptions(wsId, commentId),
  );
  const usable = previewIsUsable(preview);
  const threadSize = previewThreadSize(preview);
  const identifier = sourceIssueIdentifier ?? preview?.source_issue.identifier ?? "";

  const modes = useMemo(
    () =>
      commentSubIssueModes().map((m) => ({
        value: m.mode,
        label: t(m.labelKey),
      })),
    [t],
  );

  const busy = create.isPending;
  const canSubmit =
    usable &&
    !busy &&
    (mode === "manual" ? title.trim().length > 0 : prompt.trim().length > 0);

  const submit = useCallback(async () => {
    if (!preview || !usable) return;
    try {
      const result = await create.mutateAsync(
        mode === "manual"
          ? {
              mode: "manual",
              commentId,
              captureToken: preview.capture_token,
              sourceIssueId,
              issue: {
                title: title.trim(),
                ...(description.trim() ? { description: description.trim() } : {}),
              },
            }
          : {
              mode: "agent",
              commentId,
              captureToken: preview.capture_token,
              sourceIssueId,
              quickCreate: { prompt: prompt.trim() },
            },
      );
      const wsSlug = useWorkspaceStore.getState().currentWorkspaceSlug;
      if (result.mode === "manual") {
        // The child exists the moment this returns, so the dismiss carries the
        // member to it. `replace` rather than `push`: the confirm surface has
        // done its job, and going "back" to a spent preview would be a dead end.
        if (wsSlug) router.replace(`/${wsSlug}/issue/${result.issue.id}`);
        else router.back();
        return;
      }
      // `agent` mode has no issue yet — the server enqueued a quick-create task
      // and the issue arrives later as an inbox notification. There is nowhere
      // to navigate, so the member is told what happens next and dismissed.
      Alert.alert(t("sourceContext.createTitle"), t("sourceContext.queued"));
      router.back();
    } catch {
      // Every failure is already reported by the mutation's own channel —
      // including the stale-token refusal, which the hook pins to the server's
      // code. This surface only has to stay open with the draft intact so the
      // retry after a refresh is one tap.
    }
  }, [create, commentId, description, mode, preview, prompt, sourceIssueId, t, title, usable]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center py-16">
        <ActivityIndicator />
      </View>
    );
  }

  // Resolved once, past the `usable` guard, so the JSX below reads `data`
  // rather than re-narrowing `preview` at every use. `usable` is the same test
  // `previewIsUsable` makes, so this pairing cannot drift from the gate above.
  if (!usable || !preview) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-8 py-16">
        <Ionicons name="cloud-offline-outline" size={28} color={theme.mutedForeground} />
        <Text className="text-center text-body text-muted-foreground">
          {t("sourceContext.loadFailed")}
        </Text>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <Text>{t("common.close")}</Text>
        </Button>
      </View>
    );
  }
  const data = preview;
  const limits = data.limits;

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-4"
        keyboardShouldPersistTaps="handled"
      >
        {/* What will be carried — first on the page on purpose. The member has
            to know what leaves the comment's thread with this task BEFORE they
            choose a title for it. */}
        <Text className="pt-3 text-caption font-medium uppercase text-muted-foreground">
          {t("sourceContext.captureContents")}
        </Text>
        <View className="mt-2 gap-1.5 rounded-md border border-border bg-secondary/40 p-3">
          <CaptureRow
            icon="git-branch-outline"
            label={t("sourceContext.captureIssue")}
            value={data.source_issue.identifier}
            muted={theme.mutedForeground}
          />
          {/* The frozen count AND the cap it was taken under, so a long thread
              is visibly truncated rather than silently. */}
          <CaptureRow
            icon="chatbubble-outline"
            label={t("sourceContext.captureComments")}
            value={
              limits.comment_count > 0
                ? `${threadSize} / ${limits.comment_count}`
                : String(threadSize)
            }
            muted={theme.mutedForeground}
          />
          <CaptureRow
            icon="document-text-outline"
            label={t("sourceContext.captureSize")}
            value={formatCaptureBytes(limits.text_bytes, "")}
            muted={theme.mutedForeground}
          />
          {limits.attachment_count > 0 ? (
            <CaptureRow
              icon="attach-outline"
              label={t("sourceContext.captureAttachments")}
              value={`${limits.attachment_count} · ${formatCaptureBytes(limits.attachment_bytes, "")}`}
              muted={theme.mutedForeground}
            />
          ) : null}
          {/* The one property of a capture the numbers cannot show: it is
              FROZEN. Saying it here is what stops "I edited the source, why did
              this not update" from becoming a bug report. */}
          <Text className="pt-0.5 text-caption text-muted-foreground">
            {t("sourceContext.captureLimitNote")}
          </Text>
        </View>

        {/* Frozen thread preview: the first couple of comments, so the member can
            confirm this is the thread they meant. The full history stays on the
            source issue — the strip on its page links back here. */}
        {data.comment_thread.length > 0 ? (
          <View className="mt-3 gap-1.5">
            {data.comment_thread.slice(0, 2).map((c) => (
              <View key={c.id} className="flex-row gap-2 rounded-md bg-secondary/30 p-2">
                {/* `author.type` is `string` on the wire (the server sends the
                 *  same three-value vocabulary as everywhere else, but the
                 *  schema cannot enumerate a set that has grown twice already).
                 *  The cast is the same one `comment-card.tsx` makes for the
                 *  identical value, and `ActorAvatar` falls back to a generic
                 *  glyph for anything it does not recognise — so an actor kind
                 *  invented later draws a generic face rather than crashing. */}
                <ActorAvatar
                  type={c.author.type as "member" | "agent" | "system" | "squad"}
                  id={c.author.id}
                  size={16}
                />
                <View className="flex-1">
                  {c.author.name ? (
                    /* The snapshot's own name is a FACT, not a read: the server
                     * resolved it at capture time and froze it with the rest of
                     * the context. Re-resolving a live directory could even
                     * disagree with the frozen copy — the very thing the
                     * 「已冻结」 note above warns about (MYS-2227). */
                    <Text
                      className="text-caption font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {c.author.name}
                    </Text>
                  ) : (
                    /* The capture carried no name, so this is a live lookup and
                     * it follows the read-state rule. Empty → the line drops;
                     * the comment's own text below already identifies the row,
                     * and the avatar beside it is an empty disc until the
                     * directory answers. */
                    <ActorNameText
                      state={resolveActorName(
                        c.author.type as "member" | "agent",
                        c.author.id,
                      )}
                      className="text-caption font-medium text-foreground"
                    />
                  )}
                  <Text className="text-caption text-muted-foreground" numberOfLines={3}>
                    {c.content}
                  </Text>
                </View>
              </View>
            ))}
            {data.comment_thread.length > 2 ? (
              <Text className="text-caption text-muted-foreground">
                {`+${data.comment_thread.length - 2}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Mode. Changes only what the form below collects: `manual` creates the
            issue synchronously from a title, `agent` enqueues a quick-create
            task from a prompt. */}
        <View className="pt-4">
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v)}
            options={modes}
          />
        </View>

        {mode === "manual" ? (
          <View className="gap-3 pt-3">
            <FieldLabel text={t("sourceContext.titleLabel")} />
            <BodyInput
              value={title}
              onChangeText={setTitle}
              placeholder={t("sourceContext.titleLabel")}
              autoFocus
            />
            <FieldLabel text={t("sourceContext.descriptionLabel")} />
            <BodyInput
              value={description}
              onChangeText={setDescription}
              placeholder={t("sourceContext.descriptionLabel")}
              minHeight={96}
            />
          </View>
        ) : (
          <View className="gap-3 pt-3">
            <FieldLabel text={t("sourceContext.modeAgent")} />
            <BodyInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder={t("sourceContext.modeAgent")}
              minHeight={120}
              autoFocus
            />
          </View>
        )}

        {/* Where the child lands. Stated rather than offered as a field: the
            parent is the comment's own issue and is not the member's to change
            here — the write endpoint takes no parent at all. */}
        {identifier ? (
          <Text className="pt-3 text-caption text-muted-foreground">
            {t("sourceContext.parentNote", { identifier })}
          </Text>
        ) : null}
      </ScrollView>

      <View className="border-t border-border px-4 py-3">
        <Button onPress={submit} disabled={!canSubmit}>
          {busy ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text>{t("sourceContext.confirm")}</Text>
          )}
        </Button>
      </View>
    </View>
  );
}

/** One read-only "what will be carried" line. */
function CaptureRow({
  icon,
  label,
  value,
  muted,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  muted: string;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={14} color={muted} />
      <Text className="shrink-0 text-caption text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-caption font-medium tabular-nums text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function FieldLabel({ text }: { text: string }) {
  return (
    <Text className="text-caption font-medium text-muted-foreground">{text}</Text>
  );
}

/**
 * Body text input.
 *
 * Deliberately a plain `TextInput` rather than `components/ui/text-field.tsx`:
 * that component is single-line by construction (`h-10`, `includeFontPadding`
 * off, `textAlignVertical: center`), and every field on this surface is
 * multi-line. Shaping it with `multiline` on top would fight the fixed height.
 * Same choice, and the same reasoning, as the feedback form's message box.
 */
function BodyInput({
  value,
  onChangeText,
  placeholder,
  minHeight = 44,
  autoFocus,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  minHeight?: number;
  autoFocus?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
      multiline
      autoFocus={autoFocus}
      textAlignVertical="top"
      accessibilityLabel={placeholder}
      className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-body text-foreground"
      style={{ minHeight }}
    />
  );
}
