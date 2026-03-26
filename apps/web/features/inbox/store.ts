"use client";

import { create } from "zustand";
import type { InboxItem, IssueStatus } from "@/shared/types";
import { api } from "@/shared/api";
import { createLogger } from "@/shared/logger";

const logger = createLogger("inbox-store");

interface InboxState {
  items: InboxItem[];
  loading: boolean;
  fetch: () => Promise<void>;
  setItems: (items: InboxItem[]) => void;
  addItem: (item: InboxItem) => void;
  markRead: (id: string) => void;
  archive: (id: string) => void;
  markAllRead: () => void;
  archiveAll: () => void;
  archiveAllRead: () => void;
  updateIssueStatus: (issueId: string, status: IssueStatus) => void;
  unreadCount: () => number;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  loading: true,

  fetch: async () => {
    logger.debug("fetch start");
    set({ loading: true });
    try {
      const data = await api.listInbox();
      logger.info("fetched", data.length, "items");
      set({ items: data, loading: false });
    } catch (err) {
      logger.error("fetch failed", err);
      set({ loading: false });
    }
  },

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
  markAllRead: () =>
    set((s) => ({
      items: s.items.map((i) => (!i.archived ? { ...i, read: true } : i)),
    })),
  archiveAll: () =>
    set((s) => ({
      items: s.items.map((i) => (!i.archived ? { ...i, archived: true } : i)),
    })),
  archiveAllRead: () =>
    set((s) => ({
      items: s.items.map((i) =>
        i.read && !i.archived ? { ...i, archived: true } : i
      ),
    })),
  updateIssueStatus: (issueId, status) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.issue_id === issueId ? { ...i, issue_status: status } : i
      ),
    })),
  unreadCount: () => get().items.filter((i) => !i.read && !i.archived).length,
}));
