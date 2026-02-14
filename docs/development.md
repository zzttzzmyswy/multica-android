# Development Guide

## Dev Commands

```bash
pnpm dev              # Desktop app (recommended)
pnpm dev:desktop      # Same as above
pnpm dev:gateway      # Gateway only
pnpm dev:web          # Web app only
pnpm dev:all          # Gateway + Web

pnpm build            # Production build (turbo-orchestrated)
pnpm typecheck        # Type check all packages
pnpm test             # Run tests
pnpm test:watch       # Watch mode
pnpm test:coverage    # With v8 coverage
```

## Local Full-Stack Development

`pnpm dev:local` starts Gateway + Desktop + Web together with isolated data directories.

**Setup:**

1. Copy `.env.example` to `.env` at the repo root
2. Fill in `TELEGRAM_BOT_TOKEN` (get from [@BotFather](https://t.me/BotFather))
3. Run `pnpm dev:local`

| Service | Address | Notes |
|---------|---------|-------|
| Gateway | `http://localhost:4000` | Telegram long-polling mode |
| Web | `http://localhost:3000` | OAuth login flow |
| Desktop | — | Connects to local Gateway + Web |

Data is stored in `~/.super-multica-dev` and `~/Documents/Multica-dev`, isolated from production.

```bash
pnpm dev:local:archive    # Archive dev data and start fresh
```

## Environment Configuration

**Desktop** (`apps/desktop/.env.*`):

| Variable | Description |
|----------|-------------|
| `MAIN_VITE_GATEWAY_URL` | WebSocket Gateway URL for remote device pairing |
| `MAIN_VITE_WEB_URL` | Web app URL for OAuth login redirect |

**Web** (`apps/web/next.config.ts`):

| Variable | Description |
|----------|-------------|
| `MULTICA_API_URL` | Backend API URL (required, no default) |

**Build for different environments:**

```bash
# Desktop
pnpm --filter @multica/desktop build              # Production (.env.production)
pnpm --filter @multica/desktop build:staging      # Staging (.env.staging)

# Web (Vercel)
# Set MULTICA_API_URL in Vercel Dashboard → Settings → Environment Variables
```

See `apps/desktop/.env.example` for the full variable reference.

## Monorepo Workflow

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Full dev mode — watches `core`, `types`, `utils` packages |
| `pnpm dev:desktop` | Desktop only — skip package watching |

**When modifying packages:**

1. Edit code in `packages/core`, `packages/types`, or `packages/utils`
2. Terminal shows `[core] ESM ⚡️ Build success` (~100ms)
3. Restart Desktop to apply changes (Ctrl+C, then `pnpm dev`)

> **Why restart?** Electron main process does not support hot reload — this is an Electron limitation, not ours.
