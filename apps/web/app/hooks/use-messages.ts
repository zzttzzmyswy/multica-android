import { useState, useCallback } from "react"
import { v7 as uuidv7 } from "uuid"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  agentId: string
}

export function useMessages() {
  const [messages, setMessages] = useState<Message[]>([])

  const addUserMessage = useCallback((content: string, agentId: string) => {
    setMessages(prev => [...prev, { id: uuidv7(), role: "user", content, agentId }])
  }, [])

  const addAssistantMessage = useCallback((content: string, agentId: string) => {
    setMessages(prev => [...prev, { id: uuidv7(), role: "assistant", content, agentId }])
  }, [])

  const clearMessages = useCallback(() => setMessages([]), [])

  return { messages, addUserMessage, addAssistantMessage, clearMessages }
}
