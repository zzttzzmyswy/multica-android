import { create } from "zustand";

interface ChatState {
  isOpen: boolean;
  activeSessionId: string | null;
  pendingTaskId: string | null;
  streamingContent: string;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveSession: (id: string | null) => void;
  setPendingTask: (taskId: string | null) => void;
  appendStreamingContent: (text: string) => void;
  clearStreamingContent: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  activeSessionId: null,
  pendingTaskId: null,
  streamingContent: "",
  setOpen: (open) => set({ isOpen: open }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setPendingTask: (taskId) => set({ pendingTaskId: taskId }),
  appendStreamingContent: (text) =>
    set((s) => ({ streamingContent: s.streamingContent + text })),
  clearStreamingContent: () => set({ streamingContent: "" }),
}));
