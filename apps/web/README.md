# @multica/web

Next.js web client for Super Multica. This app is a **thin shell** — it contains only layout and page entry points. All business logic, state management, UI components, and network requests live in shared packages.

## Architecture

```
apps/web/app/
├── layout.tsx   — Root layout, setConfig(), providers
├── page.tsx     — Page entry, renders <Chat />
└── icon.png     — Favicon
```

Everything else comes from packages:

| Package | Responsibility | Examples |
|---------|---------------|----------|
| `@multica/store` | Global state (Zustand) | Hub, Messages, Gateway, DeviceId |
| `@multica/ui` | Components & UI hooks | Chat, HubSidebar, Skeleton, useScrollFade |
| `@multica/fetch` | HTTP client & URL config | `consoleApi`, `setConfig()` |
| `@multica/sdk` | WebSocket client | `GatewayClient` |

### Where does new code go?

- **Page-scoped UI hook** (e.g. form toggle, scroll position) → `@multica/ui/hooks/`
- **Cross-component state** (e.g. user preferences, notifications) → `@multica/store`
- **Reusable component** → `@multica/ui/components/`
- **HTTP request helper** → `@multica/fetch`
- **This app** → Only if it's Next.js-specific (middleware, route handlers, `next.config`)

> Principle: desktop also consumes these packages, so anything reusable must NOT live in `apps/web`.

## Network Requests

Two communication channels, two packages:

```
HTTP  → @multica/fetch (consoleApi)  → Console :4000  (Hub, Agent CRUD)
WS    → @multica/store (gateway)     → Gateway :3000  (Chat messages)
```

Rules:

1. **Never hardcode URLs.** Use `consoleApi` for HTTP, `useGatewayStore` for WS. Both read from `setConfig()` in `layout.tsx`.
2. **HTTP for management, WS for real-time.** Creating/deleting agents is HTTP. Sending/receiving chat messages is WS.
3. **Future: gateway may proxy HTTP.** The current two-endpoint setup may merge into one. Because all requests go through `@multica/fetch` and `@multica/store`, business code won't need changes.

## State Management

We use Zustand. Follow these rules:

### Subscribe only to what you render

```tsx
// Good — component re-renders only when status changes
const status = useHubStore((s) => s.status)

// Bad — re-renders on ANY store change
const { status } = useHubStore()
```

### Use getState() in callbacks

Don't subscribe to state that's only used inside event handlers. Read it at call time instead.

```tsx
// Good — no subscription, no re-render
const handleSend = useCallback((text: string) => {
  const hub = useHubStore.getState().hub
  const agentId = useHubStore.getState().activeAgentId
  if (!hub?.hubId || !agentId) return
  useMessagesStore.getState().addUserMessage(text, agentId)
  useGatewayStore.getState().send(hub.hubId, "message", { agentId, content: text })
}, [])

// Bad — subscribes to hub and activeAgentId just to use them in onClick
const hub = useHubStore((s) => s.hub)
const activeAgentId = useHubStore((s) => s.activeAgentId)
```

### Subscribe to derived values, not raw objects

```tsx
// Good — re-renders only when the boolean flips
const isConnected = useHubStore((s) => s.status === "connected")

// Bad — re-renders when any field of hub changes
const hub = useHubStore((s) => s.hub)
const isConnected = hub !== null
```

### Filter/derive with useMemo, not inside selectors

Selectors that return new references (`.filter()`, `.map()`) cause infinite re-renders. Derive outside the selector.

```tsx
// Good
const messages = useMessagesStore((s) => s.messages)
const filtered = useMemo(
  () => messages.filter((m) => m.agentId === activeAgentId),
  [messages, activeAgentId]
)

// Bad — .filter() returns a new array every time, triggers infinite loop
const filtered = useMessagesStore((s) => s.messages.filter(...))
```

### Initialize once

Side-effectful operations (WS connection, SDK init) must have guards to prevent double execution.

```tsx
// Inside store
connect: (deviceId) => {
  if (client) return  // Already connected, skip
  client = new GatewayClient(...)
  client.connect()
}
```

## Imports

### Use direct paths for @multica/ui

```tsx
// Good
import { Chat } from "@multica/ui/components/chat"
import { Button } from "@multica/ui/components/ui/button"
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade"

// Bad — barrel import pulls in everything
import { Chat, Button, useScrollFade } from "@multica/ui"
```

`@multica/store` barrel import is fine — it has few exports and all are lightweight Zustand stores.

### Heavy components: use dynamic import

For large dependencies (code editors, chart libraries, PDF viewers), lazy-load to keep the initial bundle small.

```tsx
import dynamic from "next/dynamic"

const CodeEditor = dynamic(
  () => import("@multica/ui/components/code-editor"),
  { ssr: false }
)
```

## Conditional Rendering

Use ternary expressions, not `&&`, to avoid rendering `0` or `""` as visible content.

```tsx
// Good
{status === "connected" ? <AgentList /> : null}

// Bad — if agents is 0, renders "0" on screen
{agents.length && <AgentList />}
```

## Development

```bash
# Start web dev server (port 3001)
multica dev web

# Or start all services
multica dev

# Typecheck
cd apps/web && npx tsc --noEmit
```

## Adding a New Feature — Checklist

1. Does it need global state? → Create a store in `@multica/store`
2. Does it need HTTP calls? → Use `consoleApi` from `@multica/fetch`
3. Does it need a UI component? → Add to `@multica/ui/components/`
4. Does it need a UI hook? → Add to `@multica/ui/hooks/`
5. Is it Next.js-specific? → Only then add to `apps/web`
6. Is the component heavy (>50KB)? → Use `next/dynamic` with `{ ssr: false }`
