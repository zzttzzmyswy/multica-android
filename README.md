# Super Multica

A multi-component architecture for distributed agent systems.

## Project Structure

```
src/
├── agent/              # Core agent module
│   ├── context-window/ # Token-aware context management
│   ├── profile/        # Agent profile management
│   ├── session/        # Session persistence with compaction
│   ├── skills/         # Modular skill system
│   └── tools/          # Agent tools
│       └── web/        # Web fetch and search tools
├── gateway/            # WebSocket gateway for remote access
├── hub/                # Agent coordination hub
└── shared/             # Shared types

apps/
├── desktop/            # Electron desktop app (recommended)
└── web/                # Next.js web application

packages/
├── sdk/                # Gateway client SDK
├── store/              # Zustand state management
└── ui/                 # Shared UI components

skills/                 # Bundled skills (commit, code-review)
```

## Getting Started

```bash
pnpm install
```

### Development

```bash
# Desktop app (recommended for local development)
pnpm dev

# Gateway + Web app (for remote/mobile clients)
pnpm dev:gateway     # Start Gateway on :3000
pnpm dev:web         # Start Web app on :3001
pnpm dev:all         # Start both Gateway and Web app
```

The Desktop app runs a standalone Hub with embedded Agent Engine - no Gateway required for local use.

### Credentials

```bash
multica credentials init
```

Creates:
- `~/.super-multica/credentials.json5` — LLM providers + tools
- `~/.super-multica/skills.env.json5` — skill/plugin API keys

Example `credentials.json5`:

```json5
{
  version: 1,
  llm: {
    provider: "openai",
    providers: {
      openai: { apiKey: "sk-xxx", model: "gpt-4o" }
    }
  },
  tools: {
    brave: { apiKey: "brv-..." }
  }
}
```

### LLM Providers

**OAuth Providers** (external CLI login):
- `claude-code` — requires `claude login`
- `openai-codex` — requires `codex login`

**API Key Providers** (configure in `credentials.json5`):
- `anthropic`, `openai`, `kimi-coding`, `google`, `groq`, `mistral`, `xai`, `openrouter`

Check status: `/provider` in interactive mode

## CLI

```bash
multica                              # Interactive mode
multica run "prompt"                 # Single prompt
multica chat --profile my-agent      # Use profile
multica --session abc123             # Continue session
multica session list                 # List sessions
multica profile list                 # List profiles
multica skills list                  # List skills
multica help                         # Show help
```

Short alias: `mu`

## Sessions

Sessions persist to `~/.super-multica/sessions/<id>/` with JSONL message history and JSON metadata. Context windows are automatically managed with token-aware compaction.

## Profiles

Profiles define agent identity, personality, and memory in `~/.super-multica/agent-profiles/<id>/`.

```bash
multica profile new my-agent    # Create profile
multica profile list            # List all
multica profile edit my-agent   # Open in file manager
```

Profile files: `soul.md`, `user.md`, `workspace.md`, `memory.md`, `memory/*.md`

## Skills

Skills extend agent functionality via `SKILL.md` files. See [Skills Documentation](./src/agent/skills/README.md).

```bash
multica skills list              # List skills
multica skills add owner/repo    # Install from GitHub
multica skills status            # Check status
```

Built-in: `commit`, `code-review`, `skill-creator`

## Tools

Available tools: `read`, `write`, `edit`, `glob`, `exec`, `process`, `web_fetch`, `web_search`, `memory_search`, `sessions_spawn`

See [Tools Documentation](./src/agent/tools/README.md) for details.

## Architecture

```
Desktop App (standalone, recommended)
  └─ Hub (embedded)
     └─ Agent Engine

Web/Mobile Clients
  → Gateway (WebSocket, :3000)
    → Hub
      → Agent Engine
```

- **Desktop App**: Electron app with embedded Hub, no Gateway needed
- **Gateway**: WebSocket server for remote clients
- **Hub**: Agent lifecycle and event distribution

## Scripts

```bash
pnpm dev              # Desktop app (recommended)
pnpm dev:gateway      # Gateway only
pnpm dev:web          # Web app only
pnpm dev:all          # Gateway + Web

pnpm build            # Production build
pnpm typecheck        # Type check
pnpm test             # Run tests
```
