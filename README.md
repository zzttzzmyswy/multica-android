# Super Multica

Super Multica is a distributed AI agent framework and product monorepo.
It provides a local-first agent runtime plus CLI, gateway, web, and mobile integration surfaces.

What this project does:

- runs AI agent sessions with tools, skills, and persistent session state
- supports scheduled/automated execution workflows
- supports both standalone local usage and remote-access client workflows

This repository keeps docs focused on:

1. Development workflow
2. Testing workflow
3. Operational process

Architecture details are still source-of-truth in code, but docs keep minimal project context for onboarding.

## Quick Start (Workflow)

```bash
pnpm install
pnpm multica credentials init
pnpm multica
```

Run local desktop workflow:

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

## Workflow Commands

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

## Testing Workflow

```bash
# Unit/integration
pnpm test
pnpm test:watch
pnpm test:coverage

# Type safety gate
pnpm typecheck

# Agent E2E
pnpm multica run --run-log "your test prompt"
```

E2E process docs:

- `docs/e2e-testing-guide.md`
- `docs/e2e-finance-benchmark.md`

## Runtime Paths

By default, runtime data is stored under:

- `~/.super-multica`

You can isolate environments with:

- `SMC_DATA_DIR=~/.super-multica-dev` (or other path)

## Process Docs

- `CLAUDE.md`
- `docs/development.md`
- `docs/cli.md`
- `docs/credentials.md`
- `docs/skills-and-tools.md`
- `docs/package-management.md`
- `docs/e2e-testing-guide.md`
- `docs/e2e-finance-benchmark.md`
