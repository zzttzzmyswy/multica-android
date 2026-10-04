/**
 * Which actor's profile card is open (iteration 179, G14).
 *
 * Why a store and not local state per avatar: the avatar is the trigger, but
 * the card has to render above everything — including the board's scroll
 * views and the issue timeline's own overlays. Mounting one `<Modal>` per
 * avatar would put ~70 modals in the tree (one per `ActorAvatar` call site)
 * and each of them would need its own open/close state. A single sheet
 * mounted once in the workspace layout, driven by one target, is both cheaper
 * and the only way the card can outlive the surface that opened it (e.g. a
 * comment card that scrolls out of the window mid-read).
 *
 * Shape mirrors `reply-target-store.ts` and `comment-select-store.ts`: one
 * singleton, cleared by its host screen. Here the host is the workspace
 * layout, so the target is cleared on close rather than on navigation — a
 * sheet left open across a push would otherwise reappear on the way back.
 */
import { create } from "zustand";

/** Actors that have a profile card. `system` does not (web has no card for it). */
export type ActorProfileType = "member" | "agent" | "squad";

export interface ActorProfileTarget {
  type: ActorProfileType;
  /**
   * User id for a member (matches `member.user_id`), agent id for an agent,
   * squad id for a squad — the same ids web's hover cards take.
   */
  id: string;
}

interface State {
  target: ActorProfileTarget | null;
  open: (type: ActorProfileType, id: string) => void;
  close: () => void;
}

export const useActorProfileStore = create<State>((set) => ({
  target: null,
  open: (type, id) => set({ target: { type, id } }),
  close: () => set({ target: null }),
}));
