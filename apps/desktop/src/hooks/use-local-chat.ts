/**
 * Hook for local direct chat with agent via IPC (no Gateway required).
 *
 * Returns UseChatReturn-compatible shape so it can be plugged directly
 * into the shared <ChatView> component.  All state is local (useState),
 * no Zustand store involved.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { v7 as uuidv7 } from 'uuid'
import type { ContentBlock } from '@multica/sdk'
import type { UseChatReturn, Message, ToolStatus, ChatError } from '@multica/hooks/use-chat'
import type { ApprovalDecision } from '@multica/sdk'

// Stable empty array to avoid re-renders in consumers
const EMPTY_APPROVALS: never[] = []

function toContentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  if (Array.isArray(content)) return content as ContentBlock[]
  return []
}

function extractContent(event: { message?: { content?: unknown } }): ContentBlock[] {
  if (!event.message?.content) return []
  return Array.isArray(event.message.content)
    ? (event.message.content as ContentBlock[])
    : []
}

/**
 * Provides local IPC chat returning the same UseChatReturn shape as
 * the gateway-based useChat hook.
 *
 * Agent ID is fetched internally from hub.getStatus() — no parameters needed.
 */
export function useLocalChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [error, setError] = useState<ChatError | null>(null)

  const agentIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      // 1. Discover agentId from hub
      let agentId: string
      try {
        const status = await window.electronAPI.hub.getStatus()
        if (!status.defaultAgent?.agentId) {
          if (!cancelled) {
            setError({ code: 'NO_AGENT', message: 'No local agent available' })
            setIsLoadingHistory(false)
          }
          return
        }
        agentId = status.defaultAgent.agentId
        agentIdRef.current = agentId
      } catch {
        if (!cancelled) {
          setError({ code: 'HUB_ERROR', message: 'Failed to connect to hub' })
          setIsLoadingHistory(false)
        }
        return
      }

      // 2. Subscribe to agent events
      const subResult = await window.electronAPI.localChat.subscribe(agentId)
      if (cancelled) return
      if (subResult.error) {
        setError({ code: 'SUBSCRIBE_FAILED', message: subResult.error })
        setIsLoadingHistory(false)
        return
      }

      // 3. Load history
      try {
        const result = await window.electronAPI.localChat.getHistory(agentId)
        if (!cancelled && result.messages?.length > 0) {
          setMessages(
            result.messages.map((m) => ({
              id: m.id ?? uuidv7(),
              role: m.role as Message['role'],
              content: toContentBlocks(m.content),
              agentId,
            })),
          )
        }
      } catch {
        // History load is best-effort
      }

      if (!cancelled) setIsLoadingHistory(false)

      // 4. Listen for streaming events
      window.electronAPI.localChat.onEvent((ev) => {
        if (cancelled || ev.agentId !== agentIdRef.current) return

        // Error event
        if (ev.type === 'error') {
          setError({
            code: 'AGENT_ERROR',
            message: ev.content ?? 'Unknown error',
          })
          setIsLoading(false)
          return
        }

        const agentEvent = ev.event
        const streamId = ev.streamId
        if (!agentEvent || !streamId) return

        switch (agentEvent.type) {
          case 'message_start': {
            const content = extractContent(agentEvent)
            const newMsg: Message = {
              id: streamId,
              role: 'assistant',
              content: content.length ? content : [],
              agentId: ev.agentId,
            }
            setMessages((prev) => [...prev, newMsg])
            setStreamingIds((prev) => new Set(prev).add(streamId))
            setIsLoading(true)
            break
          }
          case 'message_update': {
            const content = extractContent(agentEvent)
            setMessages((prev) =>
              prev.map((m) => (m.id === streamId ? { ...m, content } : m)),
            )
            break
          }
          case 'message_end': {
            const content = extractContent(agentEvent)
            const stopReason =
              'message' in agentEvent
                ? (agentEvent.message as { stopReason?: string })?.stopReason
                : undefined

            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === streamId) return { ...m, content, stopReason }
                // Interrupt running tools belonging to the same agent
                if (
                  m.role === 'toolResult' &&
                  m.toolStatus === 'running' &&
                  m.agentId === ev.agentId
                ) {
                  return { ...m, toolStatus: 'interrupted' as ToolStatus }
                }
                return m
              }),
            )
            setStreamingIds((prev) => {
              const next = new Set(prev)
              next.delete(streamId)
              return next
            })
            setIsLoading(false)
            break
          }
          case 'tool_execution_start': {
            const toolEvent = agentEvent as {
              type: 'tool_execution_start'
              toolCallId?: string
              toolName?: string
              args?: Record<string, unknown>
            }
            const toolMsg: Message = {
              id: uuidv7(),
              role: 'toolResult',
              content: [],
              agentId: ev.agentId,
              toolCallId: toolEvent.toolCallId,
              toolName: toolEvent.toolName,
              toolArgs: toolEvent.args,
              toolStatus: 'running',
              isError: false,
            }
            setMessages((prev) => [...prev, toolMsg])
            break
          }
          case 'tool_execution_end': {
            const toolEvent = agentEvent as {
              type: 'tool_execution_end'
              toolCallId?: string
              result?: unknown
              isError?: boolean
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.role === 'toolResult' && m.toolCallId === toolEvent.toolCallId
                  ? {
                      ...m,
                      toolStatus: (toolEvent.isError ? 'error' : 'success') as ToolStatus,
                      isError: toolEvent.isError ?? false,
                      content:
                        toolEvent.result != null
                          ? [
                              {
                                type: 'text' as const,
                                text:
                                  typeof toolEvent.result === 'string'
                                    ? toolEvent.result
                                    : JSON.stringify(toolEvent.result),
                              },
                            ]
                          : [],
                    }
                  : m,
              ),
            )
            break
          }
        }
      })
    }

    init()

    return () => {
      cancelled = true
      window.electronAPI.localChat.offEvent()
      const id = agentIdRef.current
      if (id) window.electronAPI.localChat.unsubscribe(id)
    }
  }, [])

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const agentId = agentIdRef.current
    if (!agentId) return

    // Add user message locally
    setMessages((prev) => [
      ...prev,
      {
        id: uuidv7(),
        role: 'user',
        content: [{ type: 'text', text: trimmed }],
        agentId,
      },
    ])
    setIsLoading(true)
    setError(null)

    // Send via IPC
    window.electronAPI.localChat.send(agentId, trimmed).then((result) => {
      if (result.error) {
        setError({ code: 'SEND_FAILED', message: result.error })
        setIsLoading(false)
      }
    })
  }, [])

  const resolveApproval = useCallback((_approvalId: string, _decision: ApprovalDecision) => {
    // Exec approvals not supported on local IPC yet — no-op
  }, [])

  return {
    messages,
    streamingIds,
    isLoading,
    isLoadingHistory,
    error,
    pendingApprovals: EMPTY_APPROVALS,
    sendMessage,
    resolveApproval,
  }
}
