# Credentials Guide

## Initialize

```bash
pnpm multica credentials init
```

This creates:

- `~/.super-multica/credentials.json5`

## Path Resolution

Credential file lookup order:

1. `SMC_CREDENTIALS_PATH` (explicit override)
2. `SMC_DATA_DIR/credentials.json5` (or default data dir)
3. `~/.super-multica/credentials.json5` fallback

## Minimal Template

```json5
{
  version: 1,
  llm: {
    provider: "kimi-coding",
    providers: {
      "kimi-coding": {
        apiKey: "your-key",
      },
    },
  },
  tools: {
    // tool-specific keys
  },
}
```

## Multi-Key Rotation (Per Provider)

You can define multiple keys under one provider namespace:

```json5
{
  llm: {
    providers: {
      "anthropic": { apiKey: "primary" },
      "anthropic:backup": { apiKey: "backup" },
    },
    order: {
      anthropic: ["anthropic", "anthropic:backup"],
    },
  },
}
```

## OAuth Providers

- `claude-code`: run `claude login`
- `openai-codex`: run `codex login`

API-key providers are configured directly in `credentials.json5`.

## Tool Credentials

Tool credentials are read from:

- `credentials.json5` under `tools`
- skill-level `.env` files under skill directories

## Security

- Keep credentials file mode private (`600` on Unix-like systems).
- Do not commit keys into the repository.
- Prefer isolated data dirs (`SMC_DATA_DIR`) for test/dev environments.
