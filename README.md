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
├── gateway/            # WebSocket gateway for distributed communication
├── hub/                # Multi-agent coordination hub
├── client/             # Client library
├── console/            # NestJS console application
└── shared/             # Shared types and gateway SDK
    └── gateway-sdk/    # Gateway client SDK

apps/
└── web/                # Next.js web application

packages/
└── sdk/                # SDK package for external use

skills/                 # Bundled skills (commit, code-review)
```

## Getting Started

```bash
pnpm install
```

### Credentials Configuration

The Agent reads credentials from JSON5 files (no `.env` required).

Create empty templates:

```bash
multica credentials init
```

This creates:

- `~/.super-multica/credentials.json5` — core config (LLM providers + built-in tools)
- `~/.super-multica/skills.env.json5` — dynamic keys (skills / plugins / integrations)

Example `credentials.json5` (OpenAI):

```json5
{
  version: 1,
  llm: {
    provider: "openai",
    providers: {
      openai: {
        apiKey: "sk-xxx",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o"
      }
    }
  },
  tools: {
    brave: { apiKey: "brv-..." }
  }
}
```

Example `skills.env.json5` (dynamic keys):

```json5
{
  env: {
    LINEAR_API_KEY: "lin-...",
    SLACK_BOT_TOKEN: "xoxb-..."
  }
}
```

Start services directly (no `source .env`):

```bash
multica dev console
multica run "hello"
multica dev gateway
```

Optional overrides:

- `SMC_CREDENTIALS_PATH` — custom path for `credentials.json5`
- `SMC_SKILLS_ENV_PATH` — custom path for `skills.env.json5`

### Configuration Priority

Each setting is resolved in order (first match wins):

1. **CLI argument** — `--provider`, `--model`, `--api-key`, `--base-url`
2. **Credentials file** — `credentials.json5` (`llm.provider` + `llm.providers[provider]`)
3. **Session metadata** — restored from previous session
4. **Default** — `kimi-coding` provider with `kimi-k2-thinking` model

## Multica CLI

The unified CLI provides access to all agent features through a single command.

```bash
# Interactive mode (default)
multica
multica chat
multica chat --profile my-agent

# Run a single prompt
multica run "hello"
multica run --session demo "remember my name is Alice"

# Session management
multica session list
multica session show abc12345
multica session delete abc12345

# Continue a session
multica --session abc12345
multica run --session abc12345 "what did I say?"

# Override provider/model
multica run --provider openai --model gpt-4o-mini "hi"

# Use an agent profile
multica chat --profile my-agent

# Set thinking level
multica run --thinking high "solve this complex problem"

# Development servers
multica dev                # Start all services
multica dev gateway        # Gateway only (:3000)
multica dev console        # Console only (:4000)
multica dev web            # Web app only (:3001)

# Help
multica help
multica run --help
multica session --help
```

Short alias: `mu` (same as `multica`)

## Sessions

Sessions persist conversation history to `~/.super-multica/sessions/<id>/`. Each session includes:

- `session.jsonl` - Message history in JSONL format
- `meta.json` - Session metadata (provider, model, thinking level)

Sessions use UUIDv7 for IDs by default, providing time-ordered unique identifiers.

### Context Window Management

The agent automatically manages context windows to prevent token overflow:

- **Token-aware compaction** - Tracks token usage and compacts when approaching limits
- **Compaction modes**: `tokens` (default), `count` (legacy), `summary` (LLM-generated)
- **Configurable safety margins** - Ensures space for responses
- **Minimum message preservation** - Keeps recent context intact

## Agent Profiles

Agent profiles define identity, personality, tools, and memory for an agent. Profiles are stored as markdown files in `~/.super-multica/agent-profiles/<id>/`.

### Profile CLI

```bash
# Create a new profile with default templates
multica profile new my-agent

# List all profiles
multica profile list

# Show profile contents
multica profile show my-agent

# Open profile directory in file manager
multica profile edit my-agent

# Delete a profile
multica profile delete my-agent
```

### Profile Structure

Each profile contains:

- `identity.md` - Agent name and role
- `soul.md` - Personality and behavioral constraints
- `tools.md` - Tool usage instructions
- `memory.md` - Persistent knowledge
- `bootstrap.md` - Initial conversation context

## Skills

Skills are modular capabilities that extend agent functionality through `SKILL.md` definition files. For complete documentation, see [Skills System Documentation](./src/agent/skills/README.md).

### Key Features

- **Two-source loading** - Global skills (`~/.super-multica/skills/`) and profile-specific skills
- **GitHub installation** - `pnpm skills:cli add owner/repo` to install from GitHub
- **Slash command invocation** - `/skill-name args` in interactive mode
- **Eligibility filtering** - Auto-filter by platform, binaries, and environment
- **Hot reload** - File watcher for development

### Quick Start

```bash
# List all skills
multica skills list

# Install skills from GitHub
multica skills add anthropics/skills

# Check skill status with diagnostics
multica skills status
multica skills status pdf -v

# Install skill dependencies
multica skills install nano-pdf

# Remove installed skills
multica skills remove skills
```

### Built-in Skills

Located in `/skills/`:

- **commit** - Git commit helper following conventional commits
- **code-review** - Code review assistance
- **skill-creator** - Create and manage custom skills (meta-skill for self-extension)

### Creating Custom Skills

The agent can create new skills to extend its own capabilities. Simply ask the agent to create a skill:

```
User: Create a skill that helps me format JSON
Agent: [Creates ~/.super-multica/skills/json-formatter/SKILL.md]
```

Skills are automatically loaded via hot-reload. See the [skill-creator SKILL.md](./skills/skill-creator/SKILL.md) for the complete guide.

## Agent Tools

### exec

Execute short-lived shell commands and return output. Commands running longer than the timeout are automatically backgrounded.

```
exec({ command: "ls -la", cwd: "/path/to/dir", timeoutMs: 30000 })
```

### process

Manage long-running background processes (servers, watchers, daemons). Output is buffered (up to 64KB) and terminated processes are automatically cleaned up after 1 hour.

```
# Start a background process (returns immediately with process ID)
process({ action: "start", command: "npm run dev" })

# Check process status
process({ action: "status", id: "<process-id>" })

# Read process output
process({ action: "output", id: "<process-id>" })

# Stop a process
process({ action: "stop", id: "<process-id>" })

# Clean up terminated processes
process({ action: "cleanup" })
```

### glob

Pattern-based file discovery using fast-glob.

```
glob({ pattern: "**/*.ts", cwd: "/path/to/dir" })
```

### web_fetch

Fetch and extract content from URLs with intelligent content extraction.

```
# Basic fetch (returns markdown)
web_fetch({ url: "https://example.com" })

# With options
web_fetch({
  url: "https://example.com",
  outputFormat: "markdown",  # or "text"
  extractor: "readability"   # or "turndown" for full page
})
```

Features: SSRF protection, response caching, max 50KB output.

### web_search

Search the web using Brave or Perplexity AI.

```
# Basic search
web_search({ query: "typescript best practices" })

# With provider options
web_search({
  query: "latest AI news",
  provider: "brave",     # or "perplexity"
  count: 5,
  freshness: "pw"        # past week (Brave: pd/pw/pm/py)
})
```

## Distributed Architecture

### Gateway

The WebSocket gateway enables distributed multi-agent communication:

- Real-time message passing between agents
- Streaming support for long-running operations
- RPC-style request/response patterns

### Hub

The Hub manages multiple agents and gateway connections:

- Agent lifecycle management
- Communication channel coordination
- Device identification and tracking

## Scripts

### Multica CLI Commands

- `multica` / `mu` - Unified CLI entry point
- `multica run <prompt>` - Run a single prompt
- `multica chat` - Interactive REPL mode
- `multica session <cmd>` - Session management
- `multica profile <cmd>` - Profile management
- `multica skills <cmd>` - Skills management
- `multica tools <cmd>` - Tool policy inspection
- `multica credentials <cmd>` - Credentials management
- `multica dev [service]` - Development servers
- `multica help` - Show help

### Development (shortcuts)

- `pnpm dev` - Run full stack (gateway + console + web)
- `pnpm dev:gateway` - Run gateway only
- `pnpm dev:console` - Run console only
- `pnpm dev:web` - Run web app only
- `pnpm dev:desktop` - Run desktop app

### Build & Test

- `pnpm build` - Build for production
- `pnpm build:sdk` - Build SDK package
- `pnpm build:cli` - Build CLI binary
- `pnpm start` - Run production build
- `pnpm typecheck` - Type check without emitting
