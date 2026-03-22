# CLAUDE.md

This file gives coding agents high-signal guidance for this repository.

## 1. Project Context

Multica is an AI-native task management platform — like Linear, but with AI agents as first-class citizens.

- Agents can be assigned issues, create issues, comment, and change status
- Supports local (daemon) and cloud agent runtimes
- Built for 2-10 person AI-native teams

## 2. Architecture

**Polyglot monorepo** — Go backend + TypeScript frontend.

- `server/` — Go backend (Chi + sqlc + gorilla/websocket)
- `apps/web/` — Next.js 16 frontend
- `packages/` — Shared TypeScript packages (ui, types, sdk, store, hooks, utils)

## 3. Core Workflow Commands

```bash
# One-click setup & run
make setup            # First-time: install deps, start DB, migrate, seed
make start            # Start backend + frontend together
make stop             # Stop everything

# Frontend
pnpm install
pnpm dev:web          # Next.js dev server (port 3000)
pnpm build            # Build all TS packages
pnpm typecheck        # TypeScript check
pnpm test             # TS tests (Vitest)

# Backend (Go)
make dev              # Run Go server (port 8080)
make daemon           # Run local daemon
make test             # Go tests
make sqlc             # Regenerate sqlc code
make migrate-up       # Run database migrations
make migrate-down     # Rollback migrations
make seed             # Seed sample data

# Infrastructure
docker compose up -d  # Start PostgreSQL
docker compose down   # Stop PostgreSQL
```

## 4. Coding Rules

- TypeScript strict mode is enabled; keep types explicit.
- Go code follows standard Go conventions (gofmt, go vet).
- Keep comments in code **English only**.
- Prefer existing patterns/components over introducing parallel abstractions.
- Avoid broad refactors unless required by the task.

## 5. Testing Rules

- **TypeScript**: Vitest. Mock external/third-party dependencies only.
- **Go**: Standard `go test`. Use testcontainers or test database for DB tests.

## 6. Commit Rules

- Use atomic commits grouped by logical intent.
- Conventional format:
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `refactor(scope): ...`
  - `docs: ...`
  - `test(scope): ...`
  - `chore(scope): ...`

## 7. Minimum Pre-Push Checks

```bash
pnpm typecheck
pnpm test
make test
```
