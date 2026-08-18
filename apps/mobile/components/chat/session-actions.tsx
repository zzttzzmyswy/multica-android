/**
 * Chat session management actions — the ⋯ / long-press menu shared by the
 * chat tab header and the session-switch sheet.
 *
 * One action sheet per session, mirroring web's `chat-session-header.tsx`
 * (rename / delete) + `chat-thread-list.tsx` (pin / unpin / archive /
 * unarchive): Rename · (Un)pin · (Un)archive · Delete. Rename needs text
 * entry, which iOS's ActionSheetIOS can't do — the hook pairs the sheet with
 * the `RenameChatDialog` sibling and returns the element the caller mounts.
 *
 * `session_updated` WS events patch the sessions cache in place (pin re-sorts
 * the list), so these mutations only need optimistic local flips + settle
 * invalidate — see data/mutations/chat.ts.
 */
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import type { ChatSession } from "@multica/core/types";
import { ActionSheet } from "@/lib/action-sheet";
import {
  useDeleteChatSession,
  useRenameChatSession,
  useSetChatSessionArchived,
  useSetChatSessionPinned,
} from "@/data/mutations/chat";
import { RenameChatDialog } from "@/components/chat/rename-chat-dialog";
import { useTranslation } from "@/lib/i18n/react";

interface ShowOptions {
  /** Called right after the user confirms deletion of `session` (before the
   *  delete mutation lands) so screens can drop local state for the row. */
  onDeleted?: (session: ChatSession) => void;
  /** True when the menu is opened from the session sheet's archived view.
   *  Restricted menu matching web's `chat-thread-list.tsx` archived view:
   *  Unarchive · Delete — no rename / pin (and no delete anywhere else). */
  archivedView?: boolean;
}

export function useChatSessionActions() {
  const { t } = useTranslation();
  const renameSession = useRenameChatSession();
  const setPinned = useSetChatSessionPinned();
  const setArchived = useSetChatSessionArchived();
  const deleteSession = useDeleteChatSession();
  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null);

  const showActions = useCallback(
    (session: ChatSession, opts?: ShowOptions) => {
      Haptics.selectionAsync().catch(() => {});

      type Action =
        | { kind: "rename" }
        | { kind: "pin" }
        | { kind: "archive" }
        | { kind: "delete" }
        | { kind: "cancel" };

      const options: string[] = [];
      const actions: Action[] = [];
      const push = (label: string, action: Action) => {
        options.push(label);
        actions.push(action);
      };

      if (opts?.archivedView) {
        // Web chat-thread-list archived view: unarchive · delete (red).
        push(t("chat.unarchive"), { kind: "archive" });
        push(t("chat.deleteChat"), { kind: "delete" });
      } else if (session.status === "archived") {
        // Archived session opened from elsewhere (e.g. the chat header):
        // hard delete is offered only once a chat is archived — web
        // chat-session-header.tsx keeps delete for archived sessions too.
        push(t("chat.rename"), { kind: "rename" });
        push(t("chat.unarchive"), { kind: "archive" });
        push(t("chat.deleteChat"), { kind: "delete" });
      } else {
        // Active session: rename · pin · archive — no hard delete. Web offers
        // delete only once a chat is archived (chat-session-header.tsx:172
        // "Hard delete is offered only once a chat is archived." / thread
        // list history view: pin + archive only).
        push(t("chat.rename"), { kind: "rename" });
        push(session.pinned ? t("chat.unpin") : t("chat.pin"), { kind: "pin" });
        push(t("common.archive"), { kind: "archive" });
      }
      push(t("menu.cancel"), { kind: "cancel" });

      const cancelButtonIndex = options.length - 1;
      // Red "delete" only when the menu actually offers it (active sessions
      // never reach the destructive slot).
      const destructiveButtonIndex =
        actions[actions.length - 2]?.kind === "delete" ? cancelButtonIndex - 1 : undefined;

      ActionSheet.showActionSheetWithOptions(
        { options, cancelButtonIndex, destructiveButtonIndex },
        (i) => {
          const action = actions[i];
          if (!action) return;
          switch (action.kind) {
            case "rename":
              setRenameTarget(session);
              break;
            case "pin":
              setPinned.mutate({
                id: session.id,
                pinned: !(session.pinned ?? false),
              });
              break;
            case "archive":
              setArchived.mutate({
                id: session.id,
                archived: session.status !== "archived",
              });
              break;
            case "delete":
              Alert.alert(
                t("chat.deleteTitle"),
                session.title || t("chat.untitled"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("chat.deleteChat"),
                    style: "destructive",
                    onPress: () => {
                      opts?.onDeleted?.(session);
                      deleteSession.mutate(session.id);
                    },
                  },
                ],
                { cancelable: true },
              );
              break;
            case "cancel":
              break;
          }
        },
      );
    },
    [t, setPinned, setArchived, deleteSession],
  );

  // The rename dialog is a controlled sibling of the action sheet — render
  // wherever the caller renders the rest of the screen.
  const renameDialog = renameTarget ? (
    <RenameChatDialog
      visible
      initialTitle={renameTarget.title}
      onCancel={() => setRenameTarget(null)}
      onSubmit={(title) => {
        renameSession.mutate({ id: renameTarget.id, title });
        setRenameTarget(null);
      }}
    />
  ) : null;

  return { showActions, renameDialog };
}