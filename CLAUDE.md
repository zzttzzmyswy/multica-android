# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

Multica is an AI-native task management platform — like Linear, but with AI agents as first-class citizens.

- Agents can be assigned issues, create issues, comment, and change status
- Supports local (daemon) and cloud agent runtimes
- Built for 2-10 person AI-native teams

## Architecture

**Polyglot monorepo** — Go backend + TypeScript frontend.

- `server/` — Go backend (Chi router, sqlc for DB, gorilla/websocket for real-time)
- `apps/web/` — Next.js 16 frontend (App Router)
- `packages/` — Shared TypeScript packages (ui, types, sdk, store, hooks, utils)

### Data Flow

```
Browser → ApiClient (SDK) → REST API (Chi handlers) → sqlc queries → PostgreSQL
Browser ← WSClient (SDK) ← WebSocket ← Hub.Broadcast() ← Handlers/TaskService
```

### Backend Structure (`server/`)

- **Entry points** (`cmd/`): `server` (HTTP API), `daemon` (local agent runtime), `migrate`, `seed`
- **Handlers** (`internal/handler/`): One file per domain (issue, comment, agent, auth, daemon, etc.). Each handler holds `Queries`, `DB`, `Hub`, and `TaskService`.
- **Real-time** (`internal/realtime/`): Hub manages WebSocket clients. Server broadcasts events; inbound WS message routing is still TODO.
- **Auth** (`internal/auth/` + `internal/middleware/`): JWT (HS256). Middleware sets `X-User-ID` and `X-User-Email` headers. Login creates user on-the-fly if not found.
- **Task lifecycle** (`internal/service/task.go`): Orchestrates agent work — enqueue → claim → start → complete/fail. Syncs issue status automatically and broadcasts WS events at each transition.
- **Database**: sqlc generates Go code from SQL in `pkg/db/queries/` → `pkg/db/generated/`. Migrations in `migrations/`.
- **Routes** (`cmd/server/router.go`): Public routes (auth, health, ws) + protected routes (require JWT) + daemon routes (unauthenticated, separate auth model).

### Frontend Structure (`apps/web/`)

- **App Router layout groups**: `(auth)/` for login, `(dashboard)/` for protected routes
- **Auth context** (`lib/auth-context.tsx`): Global provider for user, workspace, members, agents. Hydrates from localStorage. Provides actor lookup helpers (`getMemberName`, `getAgentName`, `getActorName`).
- **WebSocket context** (`lib/ws-context.tsx`): Wraps `WSClient` from SDK. `useWSEvent()` hook auto-subscribes/unsubscribes.
- **API client** (`lib/api.ts`): Singleton `ApiClient` from `@multica/sdk`, initialized from localStorage.
- **State**: Zustand stores (`@multica/store`) for issues, agents, inbox. WebSocket events keep stores in sync without re-fetching.

### Key Packages

- **`@multica/sdk`**: `ApiClient` (REST) and `WSClient` (WebSocket) classes. All backend communication goes through here.
- **`@multica/types`**: Shared domain types + WebSocket event types (issue:created/updated/deleted, task:*, agent:status, comment:*, inbox:new, daemon:*).
- **`@multica/store`**: Zustand stores — simple arrays with add/update/remove. No persistence; memory only.
- **`@multica/ui`**: shadcn/ui component library with Radix primitives, Tailwind CSS 4, Shiki syntax highlighting for markdown.
- **`@multica/hooks`**: `useRealtime()` (WS → store sync), `useIssues()`, `useAgents()`, `useInbox()` (fetch + cache).

### Multi-tenancy

All queries filter by `workspace_id`. Membership checks gate access. `X-Workspace-ID` header routes requests to the correct workspace.

### Agent Assignees

Assignees are polymorphic — can be a member or an agent. `assignee_type` + `assignee_id` on issues. Agents render with distinct styling (purple background, robot icon).

## Commands

```bash
# One-click setup & run
make setup            # First-time: install deps, start DB, migrate
make seed             # Optional: load example data
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
make sqlc             # Regenerate sqlc code after editing SQL in server/pkg/db/queries/
make migrate-up       # Run database migrations
make migrate-down     # Rollback migrations

# Run a single Go test
cd server && go test ./internal/handler/ -run TestName

# Run a single TS test
pnpm --filter @multica/web exec vitest run src/path/to/file.test.ts

# Run a single E2E test (requires backend + frontend running)
pnpm exec playwright test e2e/tests/specific-test.spec.ts

# Infrastructure
docker compose up -d  # Start PostgreSQL
docker compose down   # Stop PostgreSQL
```

### Worktree Support

For isolated feature testing with a separate database:
```bash
make worktree-env       # Generate .env.worktree with unique DB/ports
make setup-worktree     # Setup using .env.worktree
make start-worktree     # Start using .env.worktree
```

## Coding Rules

- TypeScript strict mode is enabled; keep types explicit.
- Go code follows standard Go conventions (gofmt, go vet).
- Keep comments in code **English only**.
- Prefer existing patterns/components over introducing parallel abstractions.
- Unless the user explicitly asks for backwards compatibility, do **not** add compatibility layers, fallback paths, dual-write logic, legacy adapters, or temporary shims.
- If a flow or API is being replaced and the product is not yet live, prefer removing the old path instead of preserving both old and new behavior.
- Treat compatibility code as a maintenance cost, not a default safety mechanism. Avoid "just in case" branches that make the codebase harder to reason about.
- Avoid broad refactors unless required by the task.

## UI/UX Rules

- Prefer `packages/ui` shadcn components over custom implementations.
- Do not introduce extra state (useState, context, reducers) unless explicitly required by the design.
- Pay close attention to **overflow** (truncate long text, scrollable containers), **alignment**, and **spacing** consistency.
- When unsure about interaction or state design, ask — the user will provide direction.

## Testing Rules

- **TypeScript**: Vitest. Mock external/third-party dependencies only.
- **Go**: Standard `go test`. Use testcontainers or test database for DB tests.

## Commit Rules

- Use atomic commits grouped by logical intent.
- Conventional format:
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `refactor(scope): ...`
  - `docs: ...`
  - `test(scope): ...`
  - `chore(scope): ...`

## Minimum Pre-Push Checks

```bash
make check    # Runs all checks: typecheck, unit tests, Go tests, E2E
```

For individual checks during development:
```bash
pnpm typecheck        # TypeScript type errors only
pnpm test             # TS unit tests only (Vitest)
make test             # Go tests only
pnpm exec playwright test   # E2E only (requires backend + frontend running)
```

## AI Agent Verification Loop

After writing or modifying code, always run the full verification pipeline:

```bash
make check
```

This runs all checks in sequence:
1. TypeScript typecheck (`pnpm typecheck`)
2. TypeScript unit tests (`pnpm test`)
3. Go tests (`go test ./...`)
4. E2E tests (auto-starts backend + frontend if needed, runs Playwright)

**Workflow:**
- Write code to satisfy the requirement
- Run `make check`
- If any step fails, read the error output, fix the code, and re-run `make check`
- Repeat until all checks pass
- Only then consider the task complete

**Quick iteration:** If you know only TypeScript or Go is affected, run individual checks first for faster feedback, then finish with a full `make check` before marking work complete.

## E2E Test Patterns

E2E tests should be self-contained. Use the `TestApiClient` fixture for data setup/teardown:

```typescript
import { loginAsDefault, createTestApi } from "./helpers";
import type { TestApiClient } from "./fixtures";

let api: TestApiClient;

test.beforeEach(async ({ page }) => {
  api = await createTestApi();       // logged-in API client
  await loginAsDefault(page);        // browser session
});

test.afterEach(async () => {
  await api.cleanup();               // delete any data created during the test
});

test("example", async ({ page }) => {
  const issue = await api.createIssue("Test Issue");  // create via API
  await page.goto(`/issues/${issue.id}`);             // test via UI
  // api.cleanup() in afterEach removes the issue
});
```
