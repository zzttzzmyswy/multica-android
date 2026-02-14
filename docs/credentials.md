# Credentials & LLM Providers

## Setup

```bash
multica credentials init
```

Creates:
- `~/.super-multica/credentials.json5` — LLM providers + tools

Example `credentials.json5`:

```json5
{
  version: 1,
  llm: {
    provider: "openai",
    providers: {
      openai: { apiKey: "sk-xxx", model: "gpt-4o" }
    }
  },
  tools: {
    brave: { apiKey: "brv-..." }
  }
}
```

## Skill API Keys

Skill-specific API keys are stored in `.env` files within each skill's directory:

```
~/.super-multica/skills/<skill-id>/.env
```

Example for the `earnings-analysis` skill:

```bash
# ~/.super-multica/skills/earnings-analysis/.env
FINANCIAL_DATASETS_API_KEY=your-key-here
```

Skills declare their required environment variables in `SKILL.md` frontmatter:

```yaml
metadata:
  requires:
    env:
      - FINANCIAL_DATASETS_API_KEY
```

The `.env` file is preserved across skill upgrades and is never committed to version control.

## LLM Providers

**OAuth Providers** (external CLI login):
- `claude-code` — requires `claude login`
- `openai-codex` — requires `codex login`

**API Key Providers** (configure in `credentials.json5`):
- `anthropic`, `openai`, `kimi-coding`, `google`, `groq`, `mistral`, `xai`, `openrouter`

Check status: `/provider` in interactive mode
