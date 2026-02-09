# Message Paths — Desktop / Web / Channel

Three independent paths deliver messages to and from the Hub's agent.
All three share the same `AsyncAgent` instance — they are just different I/O surfaces.

---

## Overview

```
Desktop (Electron IPC)          Web (WebSocket via Gateway)        Channel (Bot API, e.g. Telegram)
        │                                │                                  │
        ▼                                ▼                                  ▼
  localChat:send IPC            client.send → Gateway WS           plugin.gateway (polling/webhook)
        │                                │                                  │
        ▼                                ▼                                  ▼
  hub.ts / ipc/hub.ts           hub.ts / onMessage                  manager.ts / routeIncoming
  clearLastRoute()              clearLastRoute()                    set lastRoute
        │                                │                                  │
        └────────────────► agent.write(text) ◄──────────────────────────────┘
                                     │
                                     ▼
                              AsyncAgent.run()
                                     │
                        ┌────────────┴────────────────┐
                        ▼                              ▼
                  agent.subscribe()              agent.read()
                  (multi-consumer)            (single-consumer iterable)
                        │                              │
               ┌────────┴────────┐                     ▼
               ▼                 ▼              hub.ts / consumeAgent()
        Desktop IPC        Channel Manager             │
     (ipc/hub.ts)       (manager.ts)                   ▼
               │                 │              Gateway WS → Web client
               ▼                 ▼
         localChat:event   Bot API reply
         → renderer        (via lastRoute)
```

---

## Path 1: Desktop (Electron IPC)

### Send (User → Agent)

```
Renderer: sendMessage(text)
  → IPC: localChat:send
    → ipc/hub.ts handler
      → hub.channelManager.clearLastRoute()   // reply stays in desktop
      → agent.write(text)
```

**File**: `apps/desktop/electron/ipc/hub.ts` — `localChat:send` handler (line ~373)

### Receive (Agent → User)

```
Agent runs LLM
  → pi-agent-core fires AgentEvent
    → Agent.subscribeAll() → AsyncAgent channel + subscribers
      → agent.subscribe() callback in ipc/hub.ts
        → Filter: assistant messages + tool_execution + passthrough (compaction, agent_error)
        → IPC: mainWindow.webContents.send('localChat:event', { agentId, streamId, event })
          → Renderer: use-local-chat.ts onEvent callback
            → chat.handleStream(payload)
```

**Files**:
- `apps/desktop/electron/ipc/hub.ts` — `localChat:subscribe` handler (line ~248)
- `apps/desktop/src/hooks/use-local-chat.ts` — `onEvent` listener (line ~54)
- `packages/hooks/src/use-chat.ts` — `handleStream()` (line ~133)

### Error Handling

```
Agent.run() throws / returns error
  → AsyncAgent.write() catch block
    → channel.send(legacy Message)           // for read() consumers (Web)
    → agent.emitMulticaEvent({ type: "agent_error", error })  // for subscribe() consumers
      → ipc/hub.ts subscriber → passthrough event → localChat:event
        → use-local-chat.ts → chat.setError() + setIsLoading(false)
```

---

## Path 2: Web (WebSocket via Gateway)

### Send (User → Agent)

```
Web app: sendMessage(text)
  → GatewayClient.send(hubId, "message", { agentId, content })
    → Socket.io → Gateway server → routes to Hub device
      → hub.ts / onMessage handler
        → channelManager.clearLastRoute()    // reply stays in gateway
        → agentSenders.set(agentId, deviceId)
        → agent.write(content)
```

**File**: `src/hub/hub.ts` — `onMessage` handler (line ~154)

### Receive (Agent → User)

```
Agent runs LLM
  → pi-agent-core fires AgentEvent
    → Agent.subscribeAll() → AsyncAgent channel + subscribers
      → agent.read() consumed by hub.ts / consumeAgent()
        → Filter: assistant messages + tool_execution + passthrough (compaction, agent_error)
        → client.send(targetDeviceId, StreamAction, { streamId, agentId, event })
          → Socket.io → Gateway → routes to Web client device
            → GatewayClient.onMessage callback
              → use-gateway-chat.ts → chat.handleStream(payload)
```

**Files**:
- `src/hub/hub.ts` — `consumeAgent()` (line ~314)
- `packages/hooks/src/use-gateway-chat.ts` — `onMessage` listener (line ~50)
- `packages/hooks/src/use-chat.ts` — `handleStream()` (line ~133)

### Error Handling

```
Agent.run() throws / returns error
  → AsyncAgent.write() catch block
    → channel.send(legacy Message)           // consumed by consumeAgent() → sent as "message" action
    → agent.emitMulticaEvent({ type: "agent_error", error })
      → read() → consumeAgent() → passthrough event → StreamAction
        → GatewayClient → use-gateway-chat.ts → chat.setError() + setIsLoading(false)
```

**Note**: Legacy error Messages also reach the Web client as `"message"` action (a plain text fallback). The `agent_error` event provides structured error info for proper UI rendering.

---

## Path 3: Channel (Bot API, e.g. Telegram)

### Send (User → Agent)

```
User sends message in Telegram
  → grammy long-polling receives Update
    → plugin.gateway.start() callback: onMessage(channelMessage)
      → ChannelManager.routeIncoming()
        → Set lastRoute = { plugin, deliveryCtx }   // reply goes back to Telegram
        → agent.write(text)                          // same as desktop/web
```

**File**: `src/channels/manager.ts` — `routeIncoming()` (line ~233)

### Receive (Agent → User)

```
Agent runs LLM
  → pi-agent-core fires AgentEvent
    → Agent.subscribeAll() → AsyncAgent channel + subscribers
      → agent.subscribe() callback in ChannelManager.subscribeToAgent()
        → Check: if (!lastRoute) return         // no active channel route, skip
        → Filter: only assistant messages
        → message_start → createAggregator()    // MessageAggregator buffers/chunks text
        → message_update → aggregator.handleEvent()
        → message_end → aggregator.handleEvent() → null aggregator
          → Aggregator emits text blocks
            → Block 0: plugin.outbound.replyText(deliveryCtx, text)   // Telegram reply
            → Block N: plugin.outbound.sendText(deliveryCtx, text)    // follow-up messages
```

**Files**:
- `src/channels/manager.ts` — `subscribeToAgent()` (line ~151), `createAggregator()` (line ~205)
- `src/hub/message-aggregator.ts` — text chunking/buffering logic

### Error Handling

```
Agent.run() throws / returns error
  → AsyncAgent.write() catch block
    → agent.emitMulticaEvent({ type: "agent_error", error })
      → subscribe() → ChannelManager subscriber
        → if lastRoute exists:
          → plugin.outbound.sendText(deliveryCtx, "[Error] ${errorMsg}")
```

---

## Comparison Table

| Aspect              | Desktop (IPC)          | Web (WebSocket)           | Channel (Bot API)        |
|---------------------|------------------------|---------------------------|--------------------------|
| **Transport**       | Electron IPC           | Socket.io via Gateway     | Bot API (HTTP)           |
| **Send entry**      | `localChat:send`       | `client.send` → Gateway   | `routeIncoming`          |
| **Receive method**  | `agent.subscribe()`    | `agent.read()` (iterable) | `agent.subscribe()`      |
| **Consumer**        | ipc/hub.ts subscriber  | hub.ts `consumeAgent()`   | manager.ts subscriber    |
| **Frontend hook**   | `use-local-chat.ts`    | `use-gateway-chat.ts`     | N/A (Bot API)            |
| **State hook**      | `use-chat.ts`          | `use-chat.ts`             | N/A                      |
| **Reply routing**   | Always (IPC channel)   | `agentSenders` Map        | `lastRoute` pattern      |
| **clearLastRoute**  | Yes (on send)          | Yes (on send)             | No (sets lastRoute)      |
| **Error display**   | `agent_error` → UI     | `agent_error` → UI        | `agent_error` → Bot text |
| **Tool results**    | Rendered in UI         | Rendered in UI            | Skipped (text only)      |
| **Text chunking**   | No (full stream)       | No (full stream)          | Yes (MessageAggregator)  |

---

## lastRoute Pattern

The `lastRoute` tracks which channel last sent a message. When the agent replies:
- If `lastRoute` is set → reply goes to that channel (e.g. Telegram)
- If `lastRoute` is null → reply goes to Desktop/Web only (via their own mechanisms)

**Clearing**: Desktop and Web both call `channelManager.clearLastRoute()` before `agent.write()`, so channel replies stop when the user switches to desktop/web.

**Setting**: `routeIncoming()` sets `lastRoute` when a channel message arrives.

Desktop and Web always receive agent events regardless of `lastRoute` — they use their own independent delivery mechanisms (IPC subscribe / Gateway read).

---

## Event Filtering

All three paths filter raw agent events. Only these are forwarded to consumers:

| Event Type              | Desktop | Web | Channel |
|-------------------------|---------|-----|---------|
| `message_start`         | assistant only | assistant only | assistant only |
| `message_update`        | assistant only | assistant only | assistant only |
| `message_end`           | assistant only | assistant only | assistant only |
| `tool_execution_start`  | Yes     | Yes | No      |
| `tool_execution_end`    | Yes     | Yes | No      |
| `compaction_start`      | Yes (passthrough) | Yes (passthrough) | No |
| `compaction_end`        | Yes (passthrough) | Yes (passthrough) | No |
| `agent_error`           | Yes (passthrough) | Yes (passthrough) | Yes (→ text) |
| User message events     | Filtered out | Filtered out | Filtered out |
