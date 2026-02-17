import { useState, useEffect, useCallback, useRef } from 'react'
import { useChat, type MessageSource } from '@multica/hooks/use-chat'
import type {
  StreamPayload,
  ExecApprovalRequestPayload,
  ApprovalDecision,
  AgentMessageItem,
  AgentErrorEvent,
} from '@multica/sdk'
import { DEFAULT_MESSAGES_LIMIT } from '@multica/sdk'

export interface QueuedLocalMessage {
  id: string
  text: string
  createdAt: number
}

interface QueuedInboundMessage {
  content: string
  agentId: string
  conversationId: string
  source: MessageSource
}

interface UseLocalChatOptions {
  conversationId?: string
}

interface LocalChatSubscribeResult {
  ok?: boolean
  error?: string
  alreadySubscribed?: boolean
  token?: number
  isRunning?: boolean
}

interface LocalChatHistoryResult {
  messages?: AgentMessageItem[]
  total: number
  offset: number
  limit: number
  contextWindowTokens?: number
  isRunning?: boolean
}

function makeQueueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `queued-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function useLocalChat(options: UseLocalChatOptions = {}) {
  const requestedConversationId = options.conversationId
  const chat = useChat()
  const chatRef = useRef(chat)
  chatRef.current = chat
  const [agentId, setAgentId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const isLoadingRef = useRef(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const isLoadingMoreRef = useRef(false)
  const [queuedMessages, setQueuedMessages] = useState<QueuedLocalMessage[]>([])
  const [queuedInboundMessages, setQueuedInboundMessages] = useState<QueuedInboundMessage[]>([])
  const [initError, setInitError] = useState<string | null>(null)
  const initRef = useRef(false)
  const offsetRef = useRef<number | null>(null)
  const activeConversationId = requestedConversationId ?? agentId

  // Initialize hub and get default agent ID
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    window.electronAPI.hub.init()
      .then((result) => {
        const r = result as { defaultConversationId?: string }
        const defaultConversationId = r.defaultConversationId
        console.log('[LocalChat] hub.init → defaultConversationId:', defaultConversationId)
        if (defaultConversationId) {
          setAgentId(defaultConversationId)
        } else if (requestedConversationId) {
          setAgentId(requestedConversationId)
        } else {
          setInitError('No default agent available')
          setIsLoadingHistory(false)
        }
      })
      .catch((err: Error) => {
        setInitError(err.message)
        setIsLoadingHistory(false)
      })
  }, [requestedConversationId])

  // Subscribe to events + fetch history once conversation is available
  useEffect(() => {
    if (!activeConversationId) return
    let disposed = false
    setQueuedMessages([])
    setQueuedInboundMessages([])
    offsetRef.current = null
    setIsLoading(false)
    setIsLoadingHistory(true)
    chatRef.current.reset()

    // Subscribe to agent events
    const subscribePromise = window.electronAPI.localChat.subscribe(activeConversationId)
      .then((result) => {
        const typed = result as LocalChatSubscribeResult
        if (!disposed && typed.isRunning) {
          setIsLoading(true)
        }
        return typed
      })
      .catch(() => null)

    // Listen for stream events
    const unsubscribeEvent = window.electronAPI.localChat.onEvent((data) => {
      // Cast IPC event to StreamPayload (same shape: { agentId, streamId, event })
      const payload = data as unknown as StreamPayload
      if (!payload.event) return
      if (payload.conversationId !== activeConversationId) return

      // Handle agent error events
      if (payload.event.type === 'agent_error') {
        const errorEvent = payload.event as AgentErrorEvent
        chatRef.current.setError({ code: 'AGENT_ERROR', message: errorEvent.message })
        setIsLoading(false)
        return
      }

      chatRef.current.handleStream(payload)
      if (payload.event.type === 'message_start') setIsLoading(true)
      if (payload.event.type === 'tool_execution_start') setIsLoading(true)
      if (payload.event.type === 'message_end') {
        const stopReason =
          'message' in payload.event
            ? (payload.event.message as { stopReason?: string } | undefined)?.stopReason
            : undefined

        // message_end with stopReason=toolUse is an intermediate step in the same run.
        // Keep loading=true so queued user messages are not dispatched mid-run.
        if (stopReason === 'toolUse') {
          setIsLoading(true)
        } else {
          setIsLoading(false)
        }
      }
    })

    // Listen for exec approval requests
    const unsubscribeApproval = window.electronAPI.localChat.onApproval((approval) => {
      if (approval.conversationId !== activeConversationId) return
      chatRef.current.addApproval(approval as ExecApprovalRequestPayload)
    })

    // Listen for inbound messages from all sources (gateway, channel)
    // This allows the local UI to display messages from other sources
    const unsubscribeInbound = window.electronAPI.hub.onInboundMessage((event: InboundMessageEvent) => {
      const eventConversationId = event.conversationId
      // Only add non-local messages (local messages are added by sendMessage)
      if (event.source.type !== 'local' && eventConversationId === activeConversationId) {
        const queuedInbound: QueuedInboundMessage = {
          content: event.content,
          agentId: event.agentId,
          conversationId: eventConversationId,
          source: event.source as MessageSource,
        }
        if (isLoadingRef.current) {
          setQueuedInboundMessages((prev) => [...prev, queuedInbound])
          return
        }

        chatRef.current.addUserMessage(
          queuedInbound.content,
          queuedInbound.agentId,
          queuedInbound.conversationId,
          queuedInbound.source,
        )
        setIsLoading(true)
      }
    })

    // Fetch history with pagination
    window.electronAPI.localChat.getHistory(activeConversationId, {
      limit: DEFAULT_MESSAGES_LIMIT,
    })
      .then((result) => {
        if (disposed) return
        const typed = result as LocalChatHistoryResult
        if (typed.isRunning) {
          setIsLoading(true)
        }
        console.log('[LocalChat] getHistory result:', result.messages?.length, 'messages, total:', result.total)
        if (result.messages?.length) {
          chatRef.current.setHistory(result.messages as AgentMessageItem[], activeConversationId, activeConversationId, {
            total: result.total,
            offset: result.offset,
            contextWindowTokens: result.contextWindowTokens,
          })
          offsetRef.current = result.offset
        } else {
          chatRef.current.setHistory([], activeConversationId, activeConversationId, {
            total: 0,
            offset: 0,
            contextWindowTokens: result.contextWindowTokens,
          })
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) {
          setIsLoadingHistory(false)
        }
      })

    return () => {
      disposed = true
      unsubscribeEvent?.()
      unsubscribeApproval?.()
      unsubscribeInbound?.()
      void subscribePromise
        .then((result) => {
          if (typeof result?.token !== 'number') return
          return window.electronAPI.localChat.unsubscribe(activeConversationId, result.token)
        })
        .catch(() => {})
    }
  }, [activeConversationId])

  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  const dispatchMessageNow = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed || !activeConversationId) return
    chatRef.current.addUserMessage(trimmed, activeConversationId, activeConversationId, { type: 'local' })
    chatRef.current.setError(null)
    setIsLoading(true)
    window.electronAPI.localChat.send(activeConversationId, trimmed)
      .then((result) => {
        const response = result as { ok?: boolean; error?: string } | undefined
        if (response?.error) {
          setIsLoading(false)
        }
      })
      .catch(() => {
        setIsLoading(false)
      })
  }, [activeConversationId])

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed || !activeConversationId) return

    if (isLoadingRef.current) {
      setQueuedMessages((prev) => [
        ...prev,
        {
          id: makeQueueId(),
          text: trimmed,
          createdAt: Date.now(),
        },
      ])
      return
    }

    dispatchMessageNow(trimmed)
  }, [activeConversationId, dispatchMessageNow])

  const removeQueuedMessage = useCallback((id: string) => {
    setQueuedMessages((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const clearQueuedMessages = useCallback(() => {
    setQueuedMessages([])
  }, [])

  useEffect(() => {
    if (!activeConversationId || isLoading) return

    // Inbound channel/gateway messages are already queued in backend.
    // Render them first to keep frontend ordering aligned with agent run order.
    const nextInbound = queuedInboundMessages[0]
    if (nextInbound) {
      setQueuedInboundMessages((prev) => prev.slice(1))
      chatRef.current.addUserMessage(
        nextInbound.content,
        nextInbound.agentId,
        nextInbound.conversationId,
        nextInbound.source,
      )
      setIsLoading(true)
      return
    }

    const nextLocal = queuedMessages[0]
    if (!nextLocal) return
    setQueuedMessages((prev) => prev.slice(1))
    dispatchMessageNow(nextLocal.text)
  }, [activeConversationId, isLoading, queuedInboundMessages, queuedMessages, dispatchMessageNow])

  const abortGeneration = useCallback(() => {
    if (!activeConversationId) return
    window.electronAPI.localChat.abort(activeConversationId).catch(() => {})
    setIsLoading(false)
  }, [activeConversationId])

  const loadMore = useCallback(async () => {
    const currentOffset = offsetRef.current
    if (!activeConversationId || currentOffset == null || currentOffset <= 0 || isLoadingMoreRef.current) return

    isLoadingMoreRef.current = true
    setIsLoadingMore(true)
    try {
      const newOffset = Math.max(0, currentOffset - DEFAULT_MESSAGES_LIMIT)
      const limit = currentOffset - newOffset
      const result = await window.electronAPI.localChat.getHistory(activeConversationId, {
        offset: newOffset,
        limit,
      })
      if (result.messages?.length) {
        chatRef.current.prependHistory(result.messages as AgentMessageItem[], activeConversationId, activeConversationId, {
          total: result.total,
          offset: result.offset,
          contextWindowTokens: result.contextWindowTokens,
        })
        offsetRef.current = result.offset
      }
    } catch {
      // Best-effort — pagination failure does not block chat
    } finally {
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
    }
  }, [activeConversationId])

  const resolveApproval = useCallback(
    (approvalId: string, decision: ApprovalDecision) => {
      chatRef.current.removeApproval(approvalId)
      window.electronAPI.localChat.resolveExecApproval(approvalId, decision).catch(() => {})
    },
    [],
  )

  const clearError = useCallback(() => {
    chatRef.current.setError(null)
  }, [])

  return {
    agentId,
    conversationId: activeConversationId,
    initError,
    messages: chat.messages,
    streamingIds: chat.streamingIds,
    isLoading,
    isLoadingHistory,
    isLoadingMore,
    hasMore: chat.hasMore,
    contextWindowTokens: chat.contextWindowTokens,
    error: chat.error,
    pendingApprovals: chat.pendingApprovals,
    queuedMessages,
    sendMessage,
    abortGeneration,
    removeQueuedMessage,
    clearQueuedMessages,
    loadMore,
    resolveApproval,
    clearError,
  }
}
