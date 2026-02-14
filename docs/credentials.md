# Credentials & LLM Providers

## Setup

```bash
multica credentials init
```

Creates:
- `~/.super-multica/credentials.json5` — LLM providers + tools
- `~/.super-multica/skills.env.json5` — skill/plugin API keys

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

## LLM Providers

**OAuth Providers** (external CLI login):
- `claude-code` — requires `claude login`
- `openai-codex` — requires `codex login`

**API Key Providers** (configure in `credentials.json5`):
- `anthropic`, `openai`, `kimi-coding`, `google`, `groq`, `mistral`, `xai`, `openrouter`

Check status: `/provider` in interactive mode
