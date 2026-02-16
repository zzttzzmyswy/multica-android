# Super Multica

Super Multica is a monorepo for a distributed AI agent framework.
It includes a local-first Desktop app, CLI, Gateway/Web access, and reusable core packages.

## Current Documentation Strategy

The docs set is intentionally **small and high-signal**.
For current status and priorities, see:

- `docs/README.md`

## Monorepo Layout

```text
apps/
  cli/      @multica/cli       Command-line interface
  desktop/  @multica/desktop   Electron desktop app (primary local runtime)
  gateway/  @multica/gateway   NestJS WebSocket gateway
  server/   @multica/server    NestJS REST server
  web/      @multica/web       Next.js web app
  mobile/   @multica/mobile    React Native app

packages/
  core/     @multica/core      Agent, Hub, tools, channels, cron, heartbeat
  sdk/      @multica/sdk       Gateway client SDK
  ui/       @multica/ui        Shared React UI components
  store/    @multica/store     Zustand stores
  hooks/    @multica/hooks     Shared hooks
  types/    @multica/types     Shared types
  utils/    @multica/utils     Shared utilities
```

## Quick Start

```bash
pnpm install
pnpm multica credentials init
pnpm multica
```

Run desktop app in dev mode:

```bash
pnpm dev
```

## Local Full-Stack Development (`pnpm dev:local`)

Use this when you need **Gateway + Web + Desktop** together for end-to-end dev.

Setup:

1. Copy `.env.example` to `.env` in repo root
2. Set `TELEGRAM_BOT_TOKEN` in `.env` (from `@BotFather`)
3. Run:

```bash
pnpm dev:local
```

What starts:

| Service | Address | Notes |
|---------|---------|-------|
| Gateway | `http://localhost:4000` | Telegram long-polling mode |
| Web | `http://localhost:3000` | OAuth login flow |
| Desktop | — | Connects to local Gateway + Web |

Data isolation:

- runtime data: `~/.super-multica-dev`
- workspace data: `~/Documents/Multica-dev`

Related:

```bash
pnpm dev:local:archive
```

## Common Commands

```bash
# CLI
pnpm multica
pnpm multica run "Hello"
pnpm multica chat
pnpm multica help

# Development
pnpm dev
pnpm dev:desktop
pnpm dev:gateway
pnpm dev:web
pnpm dev:local
pnpm dev:local:archive

# Build / quality
pnpm build
pnpm typecheck
pnpm test
```

## Runtime Data

By default, runtime data is stored under:

- `~/.super-multica`

You can isolate environments with:

- `SMC_DATA_DIR=~/.super-multica-dev` (or other path)

## Core Docs

- `CLAUDE.md` (AI coding guidance in this repo)
- `docs/development.md`
- `docs/cli.md`
- `docs/credentials.md`
- `docs/skills-and-tools.md`
- `docs/e2e-testing-guide.md`
- `docs/e2e-finance-benchmark.md`
