/**
 * Chat composer — thin wrapper around the shared `<MessageComposer>` with
 * chat-specific wiring:
 *
 *   - **Controlled text**: parent (chat.tsx) owns the draft via
 *     `useChatDraftsStore` so switching sessions rehydrates the right
 *     draft. Pass `value` + `onChangeText` through.
 *   - **Stop button**: while an agent task is running for the active
 *     session, `sending` flips true and we replace the Send button slot
 *     with a Stop affordance (filled foreground bg + stop glyph). Tap →
 *     `onStop()` cancels the in-flight task.
 *   - **Mention picker mode=chat**: chat is user ↔ single agent so
 *     @member / @agent / @squad / @all are noise + would notify the
 *     wrong people. Picker route honors `?mode=chat` and surfaces only
 *     Issues (useful for "reference this ticket for context").
 *   - **No reply target**: chat is a flat conversation; passes no
 *     reply chip.
 *   - **No upload context**: chat attachments are session-scoped; the
 *     server back-fills `chat_message_id` on each row when the message
 *     persists (server-side). `MessageComposer` calls `api.uploadFile`
 *     without `{ issueId, commentId }`.
 *   - **Parent owns keyboard**: chat.tsx wraps the composer in a
 *     `KeyboardStickyView` (react-native-keyboard-controller), so
 *     `manageKeyboard={false}` stops the composer from stacking its own
 *     keyboard handling on top. The Chat screen also sets
 *     `tabBarHideOnKeyboard` ((tabs)/_layout.tsx) so the full-keyboard-
 *     height lift lands flush against the IME — with the tab bar visible
 *     the composer would float above the keyboard by the bar's height.
 *
 * Previously a hand-written 400-LOC twin of inline-comment-composer.tsx;
 * now ~50 LOC plus the StopButton subcomponent.
 */
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { ChatSkillInput } from "@/lib/slash-command";
import { MessageComposer } from "@/components/composer/message-composer";
import { ChatProjectContextRow } from "@/components/chat/chat-project-context-row";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  /** Current draft text (controlled). Empty string = no draft. */
  value: string;
  /** Fired on every keystroke. The caller writes to the drafts store. */
  onChangeText: (next: string) => void;
  /** Send the serialised markdown content + the completed attachments'
   *  server ids. Caller resets the input by setting `value=""` after a
   *  successful send. */
  onSend: (content: string, attachmentIds: string[]) => Promise<void> | void;
  /** Cancel the in-flight agent task. Only callable while `sending===true`. */
  onStop: () => void;
  /** True while an agent task is running for the active session. The
   *  composer swaps Send for Stop. */
  sending: boolean;
  /** Queued tasks remain busy, but do not expose Stop without draft restore. */
  allowStop?: boolean;
  /** `pendingTask.supports_queue === true` — the running turn accepts
   *  follow-ups, so the trailing slot becomes "Queue message" once the
   *  composer holds content (web chat-input's `allowSubmitWhileRunning`).
   *  Without it a follow-up could only ever be typed after the turn ended,
   *  which left the queue UI unreachable — nothing on the phone could
   *  enqueue. */
  queueSendEnabled?: boolean;
  /** The active agent's embedded skills (`Agent.skills`). Drives the `/`
   *  skill picker (MYS-682): typing a trailing `/` lists them; picking one
   *  inserts `/{name} ` verbatim. Empty when the agent has no skills — the
   *  slash menu then stays quiet. */
  activeAgentSkills?: ChatSkillInput[];
  /** Hard-disable typing + send. Used when there's no usable agent in the
   *  workspace or the session is archived (legacy). */
  disabled?: boolean;
  /** When `disabled`, replaces the pill label with the reason. */
  disabledReason?: string;
  /** Active chat session id — the PATCH target for project-context edits.
   *  Undefined for a brand-new chat (no session yet), which hides the row. */
  sessionId?: string | null;
  /** `ChatSession.project_id`. When set, a clearable project-context row
   *  renders above the composer (web chat-input parity). */
  projectId?: string | null;
  /** `chatProjectContextUnsupported(runtime)` — renders the "runtime does not
   *  support project context" warning in the same row. */
  projectContextUnsupported?: boolean;
  /** True while a turn is in flight — locks the project chip (web
   *  `projectSelectionEnabled`). */
  projectContextDisabled?: boolean;
}

const IS_IOS = process.env.EXPO_OS === "ios";

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  sending,
  allowStop = true,
  queueSendEnabled = false,
  disabled = false,
  disabledReason,
  activeAgentSkills,
  sessionId,
  projectId,
  projectContextUnsupported = false,
  projectContextDisabled = false,
}: Props) {
  const { t } = useTranslation();
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const onSubmit = useCallback(
    async ({
      content,
      attachmentIds,
    }: {
      content: string;
      attachmentIds: string[];
    }) => {
      // `onSend` may be sync or async; await is safe in both cases. If it
      // throws, MessageComposer's catch restores text + chips.
      await onSend(content, attachmentIds);
    },
    [onSend],
  );

  const handleStop = useCallback(() => {
    if (IS_IOS) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onStop();
  }, [onStop]);

  return (
    <>
      {/* Web renders the clearable project pill inside the composer surface;
          on mobile the collapsed/expanded composer owns that chrome, so the
          row sits just above it (parent wraps both in a KeyboardStickyView so
          they lift as one). No session id yet → a brand-new chat, no binding
          to show. */}
      {sessionId ? (
        <ChatProjectContextRow
          sessionId={sessionId}
          projectId={projectId}
          projectContextUnsupported={projectContextUnsupported}
          disabled={projectContextDisabled}
        />
      ) : null}
      <MessageComposer
        value={value}
        onChangeText={onChangeText}
        onSubmit={onSubmit}
        mentionPickerPath={{
          pathname: "/[workspace]/mention-picker",
          params: { workspace: wsSlug ?? "", mode: "chat" },
        }}
        placeholder={sending ? t("chat.agentWorking") : t("chat.placeholder")}
        pillLabel={
          sending
            ? t("chat.agentWorking")
            : disabled
              ? (disabledReason ?? t("chat.unavailable"))
              : t("chat.placeholder")
        }
        pillIcon="chatbubble-ellipses-outline"
        disabled={disabled}
        disabledReason={disabledReason}
        isSending={sending}
        allowSubmitWhileRunning={queueSendEnabled}
        slashSkills={activeAgentSkills}
        renderStop={allowStop ? () => <StopButton onPress={handleStop} /> : undefined}
        manageKeyboard={false}
      />
    </>
  );
}

function StopButton({ onPress }: { onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const theme = THEME[colorScheme];
  return (
    <Animated.View
      key="stop"
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(120)}
    >
      <Pressable
        onPress={onPress}
        className="h-8 w-8 items-center justify-center rounded-full bg-foreground active:opacity-80"
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t("chat.stopAgent")}
      >
        <View
          style={{
            width: 10,
            height: 10,
            backgroundColor: theme.background,
            borderRadius: 1.5,
          }}
        />
      </Pressable>
    </Animated.View>
  );
}
