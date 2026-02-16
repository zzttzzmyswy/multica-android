# CLAUDE.md

This file gives coding agents high-signal guidance for this repository.

## 1. Project Context

Super Multica is a distributed AI agent framework/product monorepo.
It is used to run local-first agent workflows and support CLI/Desktop/Web/Gateway-based usage.

Core purpose:

- execute agent tasks with tools and skills
- persist sessions/profiles/credentials across runs
- support development, testing, and operational automation workflows

## 2. Documentation Scope

Documentation in this repo should prioritize:

1. Development workflow
2. Testing methods
3. Operational process

Architecture explanations should stay minimal in docs.
Treat source code as the architecture source of truth.

## 3. Core Workflow Commands

```bash
pnpm install
pnpm multica
pnpm multica run "<prompt>"
pnpm dev
pnpm dev:gateway
pnpm dev:web
pnpm dev:local
pnpm build
pnpm typecheck
pnpm test
```

## 4. Data and Credentials Workflow

- Default data dir: `~/.super-multica` (override with `SMC_DATA_DIR`)
- Credentials: `~/.super-multica/credentials.json5` (override with `SMC_CREDENTIALS_PATH`)
- Initialize credentials via `pnpm multica credentials init`

## 5. Coding Rules

- TypeScript strict mode is enabled; keep types explicit.
- Keep comments in code **English only**.
- Prefer existing patterns/components over introducing parallel abstractions.
- Avoid broad refactors unless required by the task.
- Keep docs concise and aligned with current code behavior.

## 6. Testing Rules

- Test runner: Vitest.
- Mock policy: mock external/third-party dependencies only.
- Do not mock internal modules when real integration can be tested.
- Prefer temp directories and real file I/O for storage-related tests.

## 7. Commit Rules

- Use atomic commits grouped by logical intent.
- Conventional format:
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `refactor(scope): ...`
  - `docs: ...`
  - `test(scope): ...`
  - `chore(scope): ...`

## 8. Minimum Pre-Push Checks

```bash
pnpm typecheck
pnpm test
```

## 9. E2E Process Docs

- `docs/e2e-testing-guide.md`
- `docs/e2e-finance-benchmark.md`
