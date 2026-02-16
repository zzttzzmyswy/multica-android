# Package Management

## Workspace

- Package manager: `pnpm` (workspace mode)
- Build orchestrator: `turbo`

## Required `.npmrc`

Keep this in repo root:

```ini
shamefully-hoist=true
```

This is required for Electron packaging compatibility in this monorepo.

## Install

```bash
pnpm install
```

## Clean Reinstall (When Needed)

Use this when lockfile/hoist state is corrupted or after major package-manager config changes:

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm -f pnpm-lock.yaml
pnpm install
```

## Build / Check

```bash
pnpm build
pnpm typecheck
pnpm test
```

## Targeted Commands

```bash
pnpm --filter @multica/desktop build
pnpm --filter @multica/core build
pnpm --filter @multica/web dev
```
