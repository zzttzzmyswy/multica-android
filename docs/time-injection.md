# Time Injection Design

Super Multica uses **message-level timestamp injection** for time awareness.
Instead of placing dynamic time text in the system prompt, user turns are stamped at runtime.

```mermaid
flowchart TD
  A[Incoming turn] --> B{Entry point}
  B -->|Desktop/Gateway/Cron/Subagent| C[AsyncAgent.write]
  B -->|Heartbeat poll| D[AsyncAgent.write injectTimestamp=false]
  C --> E{Already stamped or has 'Current time:'?}
  E -->|Yes| F[Keep original message]
  E -->|No| G[Prefix: [DOW YYYY-MM-DD HH:mm TZ]]
  D --> H[Keep original heartbeat prompt]
  F --> I[Agent.run]
  G --> I
  H --> I
  I --> J[LLM receives final turn text]
```

## Injection Matrix

| Path | Runtime call | Timestamp injected? | Notes |
| --- | --- | --- | --- |
| Desktop direct chat | `agent.write(content)` | Yes | Default behavior |
| Gateway/remote chat | `agent.write(content)` | Yes | Same entry path as desktop |
| `sessions_spawn` child task | `childAgent.write(task)` | Yes | Child turn gets current time context |
| Cron `agent-turn` payload | `agent.write(cronMessage)` | Yes (guarded) | Skips if message already carries `Current time:` |
| Heartbeat runner | `agent.write(prompt, { injectTimestamp: false })` | No | Prevents heartbeat prompt matching from breaking |
| Internal orchestration | `writeInternal(...)` | No | Uses separate internal run path |

## Why This Design

- Keeps system prompt cache-stable (no per-turn date churn in system prompt text)
- Gives the model an explicit "now" reference on each user turn
- Uses guardrails to avoid double-stamping and heartbeat regressions
