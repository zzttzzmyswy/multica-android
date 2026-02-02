import { create } from "zustand"
import { v7 as uuidv7 } from "uuid"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  agentId: string
}

interface MessagesState {
  messages: Message[]
}

interface MessagesActions {
  addUserMessage: (content: string, agentId: string) => void
  addAssistantMessage: (content: string, agentId: string) => void
  updateMessage: (id: string, content: string) => void
  loadMessages: (agentId: string, msgs: Message[]) => void
  getMessagesByAgent: (agentId: string) => Message[]
  clearMessages: (agentId?: string) => void
}

export type MessagesStore = MessagesState & MessagesActions

export const useMessagesStore = create<MessagesStore>()((set, get) => ({
  messages: [],

  addUserMessage: (content, agentId) => {
    set((s) => ({
      messages: [...s.messages, { id: uuidv7(), role: "user", content, agentId }],
    }))
  },

  addAssistantMessage: (content, agentId) => {
    set((s) => ({
      messages: [...s.messages, { id: uuidv7(), role: "assistant", content, agentId }],
    }))
  },

  updateMessage: (id, content) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    }))
  },

  loadMessages: (agentId, msgs) => {
    set((s) => ({
      messages: [...s.messages.filter((m) => m.agentId !== agentId), ...msgs],
    }))
  },

  getMessagesByAgent: (agentId) => {
    return get().messages.filter((m) => m.agentId === agentId)
  },

  clearMessages: (agentId?) => {
    set((s) => ({
      messages: agentId ? s.messages.filter((m) => m.agentId !== agentId) : [],
    }))
  },
}))
