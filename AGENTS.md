# Repository Guidelines

## Project Structure & Module Organization
`apps/web/` contains the Next.js 16 frontend: routes live in `app/`, reusable UI in `components/`, feature code in `features/`, test utilities in `test/`, and static assets in `public/`. `server/` contains the Go backend: entry points are in `cmd/{server,multica,migrate}`, application logic lives in `internal/`, migrations are in `migrations/`, and SQL lives under `pkg/db/queries/` with generated sqlc output in `pkg/db/generated/`. `e2e/` holds Playwright coverage. `scripts/` and the root `Makefile` drive local setup and verification.

## Build, Test, and Development Commands
Use `make setup` for first-time setup: it installs dependencies, ensures PostgreSQL is running, and applies migrations. Use `make start` to run backend and frontend together with `.env` or `.env.worktree`. For single-surface work, use `pnpm dev:web` for the frontend and `make dev` for the Go server. Run `pnpm test` for Vitest, `make test` for Go tests, and `make check` for the full pipeline: typecheck, frontend unit tests, Go tests, then Playwright. After changing SQL in `server/pkg/db/queries/*.sql`, run `make sqlc`.

## Coding Style & Naming Conventions
TypeScript in `apps/web` uses 2-space indentation, double quotes, and semicolons. Prefer PascalCase for React components, camelCase for hooks and helpers, and colocated test files such as `page.test.tsx`. Go code should stay `gofmt`-clean and use domain-oriented filenames like `issue.go` or `cmd_issue.go`. Do not hand-edit generated code in `server/pkg/db/generated/`.

## Testing Guidelines
Frontend unit tests use Vitest with Testing Library and shared setup from `apps/web/test/`. End-to-end tests live in `e2e/*.spec.ts`; `make check` will start missing services automatically, while direct Playwright runs expect the app to already be running. Backend tests use Go’s standard `*_test.go` pattern. Add or update tests whenever you change handlers, CLI commands, daemon behavior, or SQL-backed flows.

## Commit & Pull Request Guidelines
Recent history follows conventional commits with scopes, for example `feat(web): ...`, `fix(cli): ...`, `refactor(daemon): ...`, `test(cli): ...`, and `docs: ...`. Keep PRs focused and include a short description, linked issue or PR number when relevant, screenshots for UI work, and notes for migrations, env changes, or CLI surface changes. Before opening a PR, run `make check` or the relevant frontend/backend subset.
