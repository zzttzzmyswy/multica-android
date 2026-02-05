# Super Multica Product Capabilities

> This document is the single source of truth for all product capabilities. It describes **what exists**, not how to design or how to use it. All subsequent documents (user journeys, UI design, copywriting, design systems) should reference this document.

---

## 1. Product Definition

**Super Multica** is a distributed AI Agent framework. Users can create, customize, and deploy AI Agents with persistent memory, fine-grained capability control, and multi-provider LLM support. Agents run locally on the user's machine; remote access is optional.

**Core architecture**:

```
Desktop App (standalone, recommended)
  └─ Hub (embedded, manages agents)
     └─ Agent Engine (LLM execution, sessions, skills, tools)
        └─ (Optional) Gateway connection → remote clients (web/mobile)
```

---

## 2. User Roles

| Role | Definition | Platform | Authority |
|------|-----------|----------|-----------|
| **Owner** | Runs the Desktop app, owns Hub and Agents | Desktop (Electron) | Full: create/delete agents, approve devices, configure providers, manage profiles/skills |
| **Collaborator** | Connects to Owner's Agent via Gateway | Web / Mobile | Limited: chat with agent, view message history. No agent management. |

There is no formal role/permission system. The Owner is implicit admin by virtue of running the Hub.

---

## 3. Functional Modules

### 3.1 Agent Engine

The core execution unit. An Agent receives user messages, calls an LLM, executes tools, and returns responses.

#### 3.1.1 Agent Lifecycle

| State | Description |
|-------|-------------|
| Created | AsyncAgent instantiated, assigned UUIDv7 session ID |
| Idle | Awaiting `write()` call (user message) |
| Running | Processing message: LLM call → tool execution → response |
| Closed | Agent terminated, no further messages accepted |

Each `write()` call is queued. Messages are processed sequentially (one at a time).

#### 3.1.2 Agent Execution Loop

1. Receive user message via `write(content)`
2. Resolve API credentials (with auth profile rotation)
3. Build/update system prompt from profile
4. Call LLM provider with message history
5. If LLM requests tool calls → execute tools → feed results back to LLM → repeat
6. Save all messages to session storage
7. Check context window utilization → compact if needed
8. Emit events to subscribers (streaming to UI)

#### 3.1.3 Auth Profile Rotation

When an API call fails, the system classifies the error and may rotate to a different API key:

| Error Type | Examples | Rotates? |
|-----------|----------|----------|
| `auth` | 401, 403, invalid key | Yes |
| `rate_limit` | 429, rate limit exceeded | Yes |
| `billing` | Out of credits, quota exceeded | Yes |
| `timeout` | Connection timeout | Yes |
| `format` | 400, malformed request | No |
| `unknown` | Other errors | No |

Failed profiles enter cooldown. Rotation continues until success or all profiles exhausted.

Tracking file: `~/.super-multica/.auth-profiles/usage-stats.json`

#### 3.1.4 Subagent Spawning

Agents can spawn child agents via the `sessions_spawn` tool:

- Subagents get isolated sessions
- Tool restrictions: `sessions_spawn` denied (no nested spawning)
- System prompt mode: `minimal` or `none`
- Parameters: task (required), label, model override, cleanup policy (`delete` or `keep`), timeout
- Results announced back to parent automatically

#### 3.1.5 Agent Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `profileId` | string | none | Agent profile to load |
| `provider` | string | `kimi-coding` | LLM provider |
| `model` | string | provider default | Model within provider |
| `reasoningMode` | `off` / `on` / `stream` | `off` | Display thinking/reasoning |
| `compactionMode` | `count` / `tokens` / `summary` | `tokens` | Context compaction strategy |
| `contextWindowTokens` | number | 200,000 | Override model's context window |
| `enableSkills` | boolean | `true` | Enable skills system |

---

### 3.2 LLM Providers

Ten providers supported. Two auth methods: OAuth (CLI login) and API Key.

| ID | Display Name | Auth | Default Model | Available Models |
|----|-------------|------|---------------|------------------|
| `claude-code` | Claude Code | OAuth | claude-opus-4-5 | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5 |
| `openai-codex` | Codex | OAuth | gpt-5.2 | gpt-5.2, gpt-5.2-codex, gpt-5.1-codex, gpt-5.1-codex-mini, gpt-5.1-codex-max |
| `anthropic` | Anthropic | API Key | claude-sonnet-4-5 | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5 |
| `openai` | OpenAI | API Key | gpt-4o | gpt-4o, gpt-4o-mini, o1, o1-mini |
| `kimi-coding` | Kimi Code | API Key | kimi-k2-thinking | kimi-k2-thinking, k2p5 |
| `google` | Google AI | API Key | gemini-2.0-flash | gemini-2.0-flash, gemini-1.5-pro |
| `groq` | Groq | API Key | llama-3.3-70b-versatile | llama-3.3-70b-versatile, mixtral-8x7b-32768 |
| `mistral` | Mistral | API Key | mistral-large-latest | mistral-large-latest, codestral-latest |
| `xai` | xAI (Grok) | API Key | grok-beta | grok-beta, grok-vision-beta |
| `openrouter` | OpenRouter | API Key | anthropic/claude-3.5-sonnet | anthropic/claude-3.5-sonnet, openai/gpt-4o |

**Default provider fallback**: config > credentials.json5 > `kimi-coding`

**OAuth providers** require external CLI login (`claude login` / `codex login`).

**API Key providers** are configured in `~/.super-multica/credentials.json5`.

**Multiple API keys per provider** are supported via auth profiles (e.g., `openai`, `openai:backup`). The system rotates between them on failure.

---

### 3.3 Tools

Tools are capabilities the Agent can invoke during execution.

#### 3.3.1 Built-in Tools

| Tool | Category | Description |
|------|----------|-------------|
| `read` | File | Read file contents (with optional offset/limit) |
| `write` | File | Create or overwrite files |
| `edit` | File | Make precise edits to existing files |
| `glob` | File | Find files by pattern (default limit: 100, max: 1000) |
| `exec` | Runtime | Run shell commands (auto-backgrounds after 10s) |
| `process` | Runtime | Manage background processes (start, stop, list, output) |
| `web_search` | Web | Search the web (Brave or Perplexity provider) |
| `web_fetch` | Web | Fetch and extract URL content (markdown/text, max 50k chars, 15min cache) |
| `memory_get` | Memory | Read from agent's persistent memory |
| `memory_set` | Memory | Write to agent's persistent memory (max 1MB per value) |
| `memory_list` | Memory | List memory entries (default limit: 100, max: 1000) |
| `memory_delete` | Memory | Delete memory entries |
| `sessions_spawn` | Subagent | Spawn a child agent for a specific task |

#### 3.3.2 Tool Groups (shortcuts for policy)

| Group | Tools Included |
|-------|---------------|
| `group:fs` | read, write, edit, glob |
| `group:runtime` | exec, process |
| `group:web` | web_search, web_fetch |
| `group:memory` | memory_get, memory_set, memory_delete, memory_list |
| `group:subagent` | sessions_spawn |
| `group:core` | read, write, edit, glob, exec, process, web_search, web_fetch |

#### 3.3.3 Tool Policy System (3 layers)

| Layer | Scope | Description |
|-------|-------|-------------|
| 1. Global | All agents | `allow` / `deny` lists (wildcard supported: `mem*`, `*`) |
| 2. Provider | Per LLM provider | Narrower restrictions per provider (e.g., deny `exec` for Google) |
| 3. Subagent | Child agents only | `sessions_spawn` denied by default |

**Priority**: Deny always overrides Allow. Empty allow list = deny all.

#### 3.3.4 Exec Tool Details

- Default yield timeout: 10,000ms (auto-backgrounds if not complete)
- Supports `timeoutMs` for hard kill (SIGTERM)
- Output includes: stdout+stderr, exitCode, truncation flag, process ID if backgrounded

#### 3.3.5 Web Search Details

- Brave provider: up to 10 results, country filtering, freshness filters (`pd`/`pw`/`pm`/`py`)
- Perplexity provider: AI-synthesized answers
- Default count: 5 results, 1 hour cache

---

### 3.4 Profile System

A Profile defines an Agent's identity, personality, knowledge, and configuration.

#### 3.4.1 Profile File Structure

```
~/.super-multica/agent-profiles/{profileId}/
├── soul.md           # Identity: name, role, personality, behavior boundaries
├── user.md           # User information: name, preferences, context
├── workspace.md      # Workspace conventions, coding standards, project rules
├── memory.md         # Long-term knowledge base (read by agent at startup)
├── config.json       # Optional: provider, model, thinking level, tool policy
├── memory/           # Key-value persistent memory storage
│   ├── key1.json
│   └── key2.json
└── skills/           # Profile-specific skills (override global)
    └── {skill-name}/
        └── SKILL.md
```

#### 3.4.2 Profile Config (config.json)

```json
{
  "name": "Jarvis",
  "style": "concise and direct",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "thinkingLevel": "medium",
  "tools": {
    "allow": ["group:fs", "web_fetch"],
    "deny": ["exec"]
  }
}
```

#### 3.4.3 Profile Operations

| Operation | CLI | Desktop |
|-----------|-----|---------|
| List profiles | `multica profile list` | Via Hub info |
| Create profile | `multica profile new <id>` | - |
| Interactive setup | `multica profile setup <id>` | - |
| View profile | `multica profile show <id>` | - |
| Edit in file manager | `multica profile edit <id>` | - |
| Delete profile | `multica profile delete <id>` | - |

**Profile ID rules**: alphanumeric, hyphens, underscores only.

#### 3.4.4 System Prompt Composition

The system prompt is built dynamically from profile files:

| Section | Source | Mode: full | Mode: minimal | Mode: none |
|---------|--------|-----------|--------------|-----------|
| Identity | soul.md + config | Yes | Partial | Single line |
| User | user.md | On-demand | No | No |
| Workspace | workspace.md | Yes | No | No |
| Memory | memory.md | On-demand | No | No |
| Safety | Built-in constitution | Yes | Yes | Yes |
| Tools | Active tool list | Yes | Core only | No |
| Skills | Skill instructions | Yes | No | No |
| Runtime | OS, model, hostname | Yes | Essential | No |
| Subagent | Task context | If applicable | Yes | Yes |

**Progressive disclosure**: soul.md, user.md, memory.md are loaded on-demand (not injected in full at startup) to save tokens.

---

### 3.5 Memory System

Agents can persistently store and recall information across sessions.

#### 3.5.1 Storage

- Location: `~/.super-multica/agent-profiles/{profileId}/memory/`
- Format: One JSON file per key
- Key rules: alphanumeric, underscore, dot, hyphen. Max 128 chars.
- Dots in keys are escaped as `__DOT__` in filenames
- Max value size: 1MB

#### 3.5.2 Entry Format

```json
{
  "value": "any JSON value",
  "description": "optional human-readable description",
  "createdAt": 1717689600000,
  "updatedAt": 1717689600000
}
```

#### 3.5.3 Memory Tools

| Tool | Input | Output |
|------|-------|--------|
| `memory_get` | `{ key }` | `{ found, value?, description?, updatedAt? }` |
| `memory_set` | `{ key, value, description? }` | `{ success, error? }` |
| `memory_delete` | `{ key }` | `{ success, existed, error? }` |
| `memory_list` | `{ prefix?, limit? }` | `{ keys[], total, truncated }` |

**Design principle**: Agents cannot "remember" mentally. All persistence must be file-based ("TEXT > BRAIN").

---

### 3.6 Skills System

Skills are modular, self-contained capabilities defined via `SKILL.md` files. They extend what an Agent can do.

#### 3.6.1 Skill File Format (SKILL.md)

```yaml
---
name: Skill Name
description: What this skill does
version: 1.0.0
metadata:
  emoji: "📝"
  os: [darwin, linux]           # Platform restriction (optional)
  always: false                 # Skip eligibility checks (optional)
  tags: [productivity, coding]
  requires:
    bins: [node, npm]           # ALL must exist in PATH
    anyBins: [python3, python]  # At least ONE must exist
    env: [OPENAI_API_KEY]       # ALL must be set
    config: [custom.setting]    # Config paths must be truthy
---
# Full markdown instructions follow...
```

#### 3.6.2 Skill Sources & Precedence

| Source | Location | Precedence |
|--------|----------|-----------|
| Bundled | `skills/` in project | Lowest |
| Global (user-installed) | `~/.super-multica/skills/` | Medium |
| Profile-specific | `~/.super-multica/agent-profiles/{id}/skills/` | Highest (overrides) |

Profile skills with the same ID completely replace global/bundled versions.

#### 3.6.3 Bundled Skills

| Skill | ID | Description | Requirements |
|-------|----|-------------|-------------|
| Git Commit Helper | `commit` | Create well-formatted conventional commits | `git` binary |
| Code Review | `code-review` | Structured code review with security focus | None |
| Profile Setup | `profile-setup` | Interactive wizard to personalize agent profile | None |
| Skill Creator | `skill-creator` | Create, edit, manage custom skills | None (always eligible) |

#### 3.6.4 Eligibility Check Sequence

1. Explicit disable in config → ineligible
2. Bundled + not in allowlist → ineligible
3. Platform mismatch (OS) → ineligible
4. `always: true` flag → eligible (skip remaining)
5. Missing required binary → ineligible
6. No alternative binary found → ineligible
7. Missing env var → ineligible
8. Missing config path → ineligible
9. All checks pass → eligible

Returns human-readable failure reasons (e.g., "Required binary not found: git").

#### 3.6.5 Skill Invocation

- **User invocation**: `/skillname args` in interactive CLI
- **Model invocation**: Agent reads skill instructions from system prompt and follows them
- **Hot reload**: File watcher detects SKILL.md changes, reloads automatically (250ms debounce)

#### 3.6.6 Skill Installation

```bash
multica skills add owner/repo              # Clone entire repository
multica skills add owner/repo/skill-name   # Clone single skill
multica skills add owner/repo@branch       # Specific branch/tag
multica skills add owner/repo -p my-agent  # Install to profile
```

---

### 3.7 Session Management

Sessions persist conversation history across interactions.

#### 3.7.1 Session Storage

- Location: `~/.super-multica/sessions/{sessionId}/session.jsonl`
- Format: JSON Lines (one JSON object per line)
- Session IDs: UUIDv7 (time-ordered)
- Each line is either a message entry, meta entry, or compaction entry

#### 3.7.2 Message Format

Messages follow the LLM API format:

```json
{"type": "message", "role": "user", "content": [{"type": "text", "text": "Hello"}]}
{"type": "message", "role": "assistant", "content": [{"type": "text", "text": "Hi!"}, {"type": "tool_use", "id": "...", "name": "read", "input": {"path": "/foo"}}]}
{"type": "message", "role": "user", "content": [{"type": "tool_result", "tool_use_id": "...", "content": "file contents"}]}
```

#### 3.7.3 Session Metadata

```json
{"type": "meta", "provider": "anthropic", "model": "claude-sonnet-4-5", "reasoningMode": "off", "contextWindowTokens": 200000}
```

#### 3.7.4 Context Window Management

| Parameter | Value | Description |
|-----------|-------|-------------|
| Hard minimum | 16,000 tokens | Block execution below this |
| Warning threshold | 32,000 tokens | Warn if context window smaller |
| Default context | 200,000 tokens | Fallback if model unknown |
| Safety margin | 20% | Buffer for estimation inaccuracy |
| Compaction trigger | 80% utilization | Start compacting |
| Compaction target | 50% utilization | Target after compaction |
| Min keep messages | 10 | Never remove below this |
| Reserve tokens | 1,024 | Reserved for response generation |

#### 3.7.5 Compaction Modes

| Mode | Strategy | Speed | Quality |
|------|----------|-------|---------|
| `tokens` (default) | Remove oldest messages until reaching 50% target | Fast | Good (preserves recent context) |
| `count` | Remove oldest when count > 80, keep last 60 | Fastest | Adequate |
| `summary` | LLM generates incremental summary of removed messages | Slow (API call) | Best (preserves meaning) |

#### 3.7.6 Session Operations

| Operation | CLI Command |
|-----------|-------------|
| List sessions | `multica session list` |
| View session | `multica session show <id>` (supports partial ID) |
| Delete session | `multica session delete <id>` |
| Resume session | `multica --session <id> "continue..."` |

---

### 3.8 Hub

The Hub is the central coordinator. It manages agent lifecycle, routes messages, and handles device verification.

#### 3.8.1 Responsibilities

- Create, list, restore, close agents
- Persist agent metadata to disk (`~/.super-multica/agents/agents.json`)
- Route messages between local IPC and remote Gateway
- Handle device verification and whitelisting
- Process RPC requests from connected clients

#### 3.8.2 Hub RPC Methods

| Method | Description | Error Codes |
|--------|-------------|-------------|
| `verify` | Verify device with token | UNAUTHORIZED, REJECTED |
| `getAgentMessages` | Fetch message history (default: 50, offset: 0) | INVALID_PARAMS, AGENT_NOT_FOUND |
| `getHubInfo` | Get Hub ID and status | - |
| `listAgents` | List all agents | - |
| `createAgent` | Create new agent | - |
| `deleteAgent` | Delete agent | - |
| `updateGateway` | Update Gateway connection | - |

#### 3.8.3 Hub Singleton

One Hub per ecosystem. In Desktop mode, it's embedded in the Electron main process. It generates a persistent Hub ID stored at `~/.super-multica/hub-id`.

---

### 3.9 Gateway

NestJS WebSocket server that enables remote client access to the Hub.

#### 3.9.1 Purpose

Bridges remote clients (web/mobile) to the Hub. Not needed for local Desktop use.

#### 3.9.2 Connection Protocol

- Transport: Socket.io
- Path: `/ws`
- Port: 3000 (default)

#### 3.9.3 Timeouts

| Parameter | Value |
|-----------|-------|
| Ping interval | 25 seconds |
| Ping timeout | 20 seconds |
| RPC default timeout | 10 seconds |
| Verify timeout | 30 seconds |
| Reconnect delay | 1 second |

#### 3.9.4 Message Routing

- Each message has `from` (sender device ID) and `to` (target device ID)
- Gateway validates: sender is registered, `from` matches socket, target exists
- Supports streaming via `StreamAction` (message_start, message_update, message_end, tool events)

#### 3.9.5 Error Codes

| Code | Meaning |
|------|---------|
| NOT_REGISTERED | Sender not registered |
| INVALID_MESSAGE | `from` field mismatch |
| DEVICE_NOT_FOUND | Target device not online |

---

### 3.10 Device Pairing & Verification

How remote devices (web/mobile) connect to the Owner's Hub.

#### 3.10.1 QR Code Generation (Desktop)

The Desktop app generates a QR code containing:

```json
{
  "type": "multica-connect",
  "gateway": "http://localhost:3000",
  "hubId": "uuid",
  "agentId": "uuid",
  "token": "random-uuid",
  "expires": 1694000000000
}
```

- Token: one-time use, random UUID
- Expiry: 30 seconds from generation
- Auto-refresh: new token generated when expired
- Also available as URL: `multica://connect?gateway=...&hub=...&agent=...&token=...&exp=...`

#### 3.10.2 Connection Code Formats (accepted by client)

| Format | Example |
|--------|---------|
| JSON | `{"type":"multica-connect","gateway":"..."}` |
| Base64 JSON | Base64-encoded JSON string |
| URL | `multica://connect?gateway=...&hub=...&agent=...&token=...&exp=...` |

#### 3.10.3 Verification Flow

```
1. Mobile scans QR / pastes code
2. Client parses code, validates expiry
3. Client connects to Gateway via Socket.io
4. Gateway sends "registered" event
5. Client auto-sends "verify" RPC with token + device metadata
6. Hub validates token (one-time, checks expiry)
7. Hub triggers confirmation dialog on Desktop
   - Shows: device name (parsed from User-Agent), device ID
   - Options: "Allow" or "Reject"
   - Timeout: 60 seconds (auto-reject)
8. If allowed: device added to whitelist, persisted to disk
9. If rejected: connection closed
```

#### 3.10.4 Device Whitelist

- Location: `~/.super-multica/client-devices/whitelist.json`
- Format:

```json
{
  "version": 1,
  "devices": [{
    "deviceId": "uuid",
    "agentId": "uuid",
    "addedAt": 1694000000000,
    "meta": {
      "userAgent": "Mozilla/5.0...",
      "platform": "Linux",
      "language": "en-US"
    }
  }]
}
```

#### 3.10.5 Reconnection (whitelisted device)

Whitelisted devices reconnect without needing a new token or user confirmation. Hub checks `isAllowed(deviceId)` and returns immediately.

#### 3.10.6 Device Management (Desktop)

- View verified devices list with metadata
- Revoke individual devices (remove from whitelist)
- No fine-grained permissions (all-or-nothing access)

#### 3.10.7 Security Model

| Aspect | Detail |
|--------|--------|
| Token lifetime | 30 seconds |
| Token usage | One-time (deleted after consumption) |
| Token storage | In-memory only (lost on Hub restart) |
| Device ID | Browser: UUID in localStorage. Persistent until cleared. |
| Whitelist | Persisted to disk. Survives restarts. |
| Authorization | All verified devices have equal access |
| Message auth | Hub checks whitelist on every non-verify message |

---

### 3.11 Credentials System

#### 3.11.1 Files

| File | Purpose | Permissions |
|------|---------|-------------|
| `~/.super-multica/credentials.json5` | LLM providers + tool API keys | 0o600 |
| `~/.super-multica/skills.env.json5` | Skill/plugin environment variables | 0o600 |

Format: JSON5 (supports comments, trailing commas, unquoted keys).

#### 3.11.2 credentials.json5 Structure

```json5
{
  version: 1,
  llm: {
    provider: "openai",           // Default provider
    providers: {
      openai: { apiKey: "sk-...", model: "gpt-4o" },
      anthropic: { apiKey: "sk-ant-...", model: "claude-sonnet-4-5" },
      "openai:backup": { apiKey: "sk-..." },  // Auth profile for rotation
    },
    order: {
      openai: ["openai", "openai:backup"],  // Rotation order
    },
  },
  tools: {
    brave: { apiKey: "brv-..." },
    perplexity: { apiKey: "pplx-...", model: "perplexity/sonar-pro" },
  },
}
```

#### 3.11.3 skills.env.json5 Structure

```json5
{
  env: {
    LINEAR_API_KEY: "lin-...",
    GITHUB_TOKEN: "ghp_...",
  },
}
```

#### 3.11.4 Environment Variable Overrides

| Variable | Purpose |
|----------|---------|
| `SMC_CREDENTIALS_PATH` | Override credentials.json5 path |
| `SMC_SKILLS_ENV_PATH` | Override skills.env.json5 path |
| `SMC_CREDENTIALS_DISABLE=1` | Disable credentials loading |

---

## 4. Platform Details

### 4.1 Desktop App (Primary)

**Technology**: Electron + Vite + React 19

**Window**: 1200x800, context isolation enabled, node integration disabled

#### 4.1.1 Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Home | Hub status, QR code, provider selector, agent settings, device list |
| `/chat` | Chat | Message history, chat input, mode switcher (local/remote) |
| `/tools` | Tools | Tool listing and inspection |
| `/skills` | Skills | Skill listing and management |

**Navigation**: Tab bar at top (Home, Chat, Tools, Skills)

#### 4.1.2 Home Page Components

| Component | Description |
|-----------|-------------|
| QR Code | Left side. Shows connection code with 30s countdown. Refresh/copy link buttons. |
| Hub Status | Right side. Hub ID, connection state indicator (green/yellow/red). |
| Agent Settings | Agent name (editable). |
| Provider Selector | Dropdown showing all providers with availability status. API Key dialog or OAuth dialog based on provider type. |
| Device List | Verified devices with name, platform, revoke button. |
| Open Chat | Button. Disabled if Hub not connected. |
| Connect to Remote Agent | Button. Navigate to remote agent connection. |

#### 4.1.3 Chat Page Modes

| Mode | Transport | When Used |
|------|-----------|-----------|
| Local Agent | IPC (Electron) | Desktop user talks directly to embedded agent |
| Remote Agent | WebSocket via Gateway | Desktop user connects to another Hub's agent |

Mode switcher available at top of chat page.

#### 4.1.4 Desktop IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `localChat:send` | Renderer → Main | Send message to agent |
| `localChat:subscribe` | Renderer → Main | Subscribe to agent events |
| `hub:device-confirm-request` | Main → Renderer | Show device confirmation dialog |
| `hub:device-confirm-response` | Renderer → Main | User's allow/reject decision |

---

### 4.2 Web App

**Technology**: Next.js 16 + App Router

**Port**: 3001

**Features**:
- Always requires Gateway connection (no local agent)
- Uses shared `@multica/ui` Chat component
- PWA-capable (service worker, offline page)
- Responsive layout (mobile-first)
- Light/dark theme toggle

**Page**: Single page rendering `<Chat />` component with `ConnectPrompt` for initial connection.

---

### 4.3 Mobile App

**Technology**: Expo + React Native

**Status**: Demo/prototype (hardcoded mock messages)

**Features**:
- QR code scanner for device pairing
- Keyboard-avoiding input bar
- Auto-expanding text input (max 120px)
- Auto-scroll to bottom on new messages

---

### 4.4 CLI

**Entry point**: `multica` (alias: `mu`)

#### 4.4.1 Commands

| Command | Description |
|---------|-------------|
| `multica` | Interactive chat mode (default) |
| `multica run "<prompt>"` | Non-interactive single prompt |
| `multica chat` | Explicit interactive mode |
| `multica session list/show/delete` | Session management |
| `multica profile list/new/setup/show/edit/delete` | Profile management |
| `multica skills list/status/install/add/remove` | Skill management |
| `multica tools list/groups/profiles` | Tool inspection |
| `multica credentials init/show/edit` | Credentials management |
| `multica dev [service]` | Development servers |

#### 4.4.2 Interactive Mode Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/exit` `/quit` `/q` | Exit |
| `/clear` | Clear session |
| `/session` | Show current session ID |
| `/new` | Start new session |
| `/multiline` | Toggle multi-line input mode |
| `/provider` | Show provider status |
| `/model [name]` | Switch model |
| `/{skillName} [args]` | Execute skill |

**Features**: Autocomplete (Shift+Tab), status bar (session/provider/model), multi-line mode (end with `.`).

#### 4.4.3 Development Servers

| Service | Command | Port |
|---------|---------|------|
| Desktop (default) | `multica dev` | Electron window |
| Gateway | `multica dev gateway` | 3000 |
| Web | `multica dev web` | 3001 |
| All | `multica dev all` | 3000 + 3001 |

---

## 5. UI Component Library

Shared package: `@multica/ui`. Used by Desktop, Web, and Mobile.

### 5.1 Chat Components

| Component | Props | Description |
|-----------|-------|-------------|
| `Chat` | (none, uses stores) | Full chat view: connect prompt + message list + input |
| `ChatInput` | `onSubmit`, `disabled`, `placeholder` | Tiptap editor. Enter=send, Shift+Enter=newline, IME-safe |
| `ChatInputRef` | (imperative) | `getText()`, `setText()`, `focus()`, `clear()` |
| `MessageList` | `messages`, `streamingIds` | Renders messages with markdown, tool calls, streaming |
| `ConnectPrompt` | (none, uses stores) | QR scan + paste code UI for remote connection |
| `ChatSkeleton` | (none) | Loading skeleton |
| `ToolCallItem` | `message` | Tool execution display: status dot, label, subtitle, expandable results |

### 5.2 Markdown Components

| Component | Props | Description |
|-----------|-------|-------------|
| `Markdown` | `children`, `mode` (`minimal`/`full`) | Rendered markdown with syntax highlighting |
| `StreamingMarkdown` | `content`, `isStreaming`, `mode` | Incremental markdown with animated cursor |
| `CodeBlock` | (internal) | Syntax-highlighted code block with copy button |

### 5.3 Base UI Components (Shadcn/UI)

button, input, textarea, card, dialog, alert-dialog, dropdown-menu, select, combobox, badge, label, field, input-group, switch, skeleton, separator, sheet, sidebar, tooltip, sonner (toasts)

### 5.4 Utility Components

| Component | Description |
|-----------|-------------|
| `QRScannerView` | Camera-based QR scanner |
| `QRScannerSheet` | Sheet variant of QR scanner |
| `Spinner` | Animated loading spinner |
| `ThemeProvider` | Light/dark theme context |
| `ThemeToggle` | Theme switch button |

---

## 6. Data Persistence Locations

| Data | Location | Format | Lifetime |
|------|----------|--------|----------|
| Credentials | `~/.super-multica/credentials.json5` | JSON5 | User-managed |
| Skills env | `~/.super-multica/skills.env.json5` | JSON5 | User-managed |
| Agent profiles | `~/.super-multica/agent-profiles/{id}/` | MD + JSON | User-managed |
| Agent memory | `~/.super-multica/agent-profiles/{id}/memory/` | JSON per key | Agent-managed |
| Sessions | `~/.super-multica/sessions/{id}/session.jsonl` | JSONL | Until deleted |
| Agent records | `~/.super-multica/agents/agents.json` | JSON | Persistent |
| Hub ID | `~/.super-multica/hub-id` | Plain text UUID | Generated once |
| Device whitelist | `~/.super-multica/client-devices/whitelist.json` | JSON | Until revoked |
| Auth profile stats | `~/.super-multica/.auth-profiles/usage-stats.json` | JSON | Runtime tracking |
| Verification tokens | In-memory | Map | Lost on restart |
| Browser device ID | localStorage: `multica-device` | UUID string | Until cleared |
| Saved connection | localStorage: `multica-connection` | JSON | Until disconnected |

---

## 7. Current Limitations

| Area | Limitation | Notes |
|------|-----------|-------|
| Agent count | Desktop creates 1 primary agent on startup | Hub API supports multi-agent (`createAgent`/`listAgents`), but UI only shows one |
| Device permissions | All-or-nothing access | No per-device capability restrictions |
| Role system | No formal RBAC | Owner is implicit admin |
| Mobile app | Demo/prototype | Hardcoded mock data, no real agent connection |
| Offline web | PWA shell only | Cannot function without Gateway |
| Skill marketplace | No registry | Install via GitHub URL only |
| Real-time collaboration | Single agent, sequential messages | No concurrent message processing |
| File upload | Not supported | Agent can only read files on Owner's filesystem |

---

*Document generated: 2026-02-05*
*Source: codebase analysis at commit fc6c3e3 on branch feat/mobile-pwa-optimization*
