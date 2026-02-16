# CLAUDE.md

This file gives coding agents high-signal guidance for this repository.

## 1. Project Snapshot

Super Multica is a pnpm monorepo for a distributed AI agent system:

- Agent engine + Hub: `packages/core`
- Desktop app (primary local runtime): `apps/desktop`
- CLI: `apps/cli`
- Remote access gateway: `apps/gateway`
- Web client: `apps/web`

## 2. Monorepo Map

```text
apps/
  cli desktop gateway server web mobile

packages/
  core sdk ui store hooks types utils

skills/
  skill assets and runtime helper scripts
```

## 3. Core Commands

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

## 4. Architecture Notes

- Desktop app embeds Hub + Agent runtime.
- Gateway is optional for local desktop usage, required for remote/web-style access.
- Web app depends on gateway/API setup.
- Sessions are directory-based: `~/.super-multica/sessions/<session-id>/`.

## 5. Data and Credentials

- Default data dir: `~/.super-multica` (override with `SMC_DATA_DIR`)
- Credentials: `~/.super-multica/credentials.json5` (override with `SMC_CREDENTIALS_PATH`)
- Initialize credentials via `pnpm multica credentials init`

## 6. Coding Rules

- TypeScript strict mode is enabled; keep types explicit.
- Keep comments in code **English only**.
- Prefer existing patterns/components over introducing parallel abstractions.
- Avoid broad refactors unless required by the task.
- Keep docs concise and aligned with current code behavior.

## 7. Testing Rules

- Test runner: Vitest.
- Mock policy: mock external/third-party dependencies only.
- Do not mock internal modules when real integration can be tested.
- Prefer temp directories and real file I/O for storage-related tests.

## 8. Commit Rules

- Use atomic commits grouped by logical intent.
- Conventional format:
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `refactor(scope): ...`
  - `docs: ...`
  - `test(scope): ...`
  - `chore(scope): ...`

## 9. Minimum Pre-Push Checks

```bash
pnpm typecheck
pnpm test
```

## 10. E2E Docs

- `docs/e2e-testing-guide.md`
- `docs/e2e-finance-benchmark.md`
