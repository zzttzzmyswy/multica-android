import { create } from "zustand";
import type { InboxItem } from "@multica/types";

interface InboxState {
  items: InboxItem[];
  setItems: (items: InboxItem[]) => void;
  addItem: (item: InboxItem) => void;
  markRead: (id: string) => void;
  archive: (id: string) => void;
  unreadCount: () => number;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  setItems: (items) => set({ items }),
  addItem: (item) =>
    set((s) => ({
      items: s.items.some((i) => i.id === item.id)
        ? s.items
        : [item, ...s.items],
    })),
  markRead: (id) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)),
    })),
  archive: (id) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, archived: true } : i)),
    })),
  unreadCount: () => get().items.filter((i) => !i.read && !i.archived).length,
}));
