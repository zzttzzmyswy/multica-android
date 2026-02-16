# CLAUDE.md

This file gives coding agents high-signal guidance for this repository.

## 1. Documentation Scope

Documentation in this repo should prioritize:

1. Development workflow
2. Testing methods
3. Operational process

Project-intro and architecture explanations are intentionally minimized.
Treat source code as the architecture source of truth.

## 2. Core Workflow Commands

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

## 3. Data and Credentials Workflow

- Default data dir: `~/.super-multica` (override with `SMC_DATA_DIR`)
- Credentials: `~/.super-multica/credentials.json5` (override with `SMC_CREDENTIALS_PATH`)
- Initialize credentials via `pnpm multica credentials init`

## 4. Coding Rules

- TypeScript strict mode is enabled; keep types explicit.
- Keep comments in code **English only**.
- Prefer existing patterns/components over introducing parallel abstractions.
- Avoid broad refactors unless required by the task.
- Keep docs concise and aligned with current code behavior.

## 5. Testing Rules

- Test runner: Vitest.
- Mock policy: mock external/third-party dependencies only.
- Do not mock internal modules when real integration can be tested.
- Prefer temp directories and real file I/O for storage-related tests.

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
```

## 8. E2E Process Docs

- `docs/e2e-testing-guide.md`
- `docs/e2e-finance-benchmark.md`
