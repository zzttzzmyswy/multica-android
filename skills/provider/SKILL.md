---
name: Provider Manager
description: View and switch LLM providers (Claude Code, Kimi, OpenAI, etc.)
version: 1.0.0
metadata:
  emoji: "🔌"
  tags:
    - provider
    - settings
    - oauth
---

## Instructions

When the user invokes `/provider`, help them manage their LLM provider settings.

### Available Providers

Display the current provider status using this format:

```
Current Provider: [provider-name]

Available Providers:
✓ Kimi Code [API Key] (current)
✓ Claude Code [OAuth] - logged in
✗ Anthropic [API Key] - not configured
✗ OpenAI [API Key] - not configured
✗ Codex [OAuth] - not logged in
...
```

### Provider Types

**API Key Providers** (require manual configuration):
- `anthropic` - Anthropic (console.anthropic.com)
- `openai` - OpenAI (platform.openai.com)
- `kimi-coding` - Kimi Code (kimi.moonshot.cn)
- `google` - Google AI (aistudio.google.com)
- `groq` - Groq (console.groq.com)
- `mistral` - Mistral (console.mistral.ai)
- `xai` - xAI/Grok (console.x.ai)
- `openrouter` - OpenRouter (openrouter.ai)

**OAuth Providers** (login via CLI):
- `claude-code` - Uses credentials from Claude Code CLI (`claude login`)
- `openai-codex` - Uses credentials from Codex CLI (`codex login`)

### Switching Providers

When user wants to switch provider:

1. **For OAuth providers** (claude-code, openai-codex):
   - Check if credentials exist in `~/.claude/.credentials.json` or `~/.codex/auth.json`
   - If not logged in, instruct user to run the appropriate login command:
     - Claude Code: `claude login`
     - Codex: `codex login`
   - After login, user needs to restart the session

2. **For API Key providers**:
   - Check if API key is configured in `~/.super-multica/credentials.json5`
   - If not configured, show the URL where they can get an API key
   - Instruct them to add the key to credentials.json5

### Example Session

User: `/provider`

Response:
```
🔌 Provider Status

Current: kimi-coding (Kimi Code)
Model: kimi-k2-thinking

Available Providers:
✓ kimi-coding    Kimi Code         [API Key]  (current)
✓ claude-code    Claude Code       [OAuth]    ready
✗ anthropic      Anthropic         [API Key]  not configured
✗ openai         OpenAI            [API Key]  not configured
✗ openai-codex   Codex             [OAuth]    not logged in

To switch provider:
- OAuth: Run login command, then restart session
- API Key: Add key to ~/.super-multica/credentials.json5

Which provider would you like to use?
```

User: "Switch to Claude Code"

Response:
```
Switching to Claude Code...

✓ Found valid OAuth credentials from Claude Code CLI
  Expires in: 23h 45m

To use Claude Code as your default provider, update ~/.super-multica/credentials.json5:

{
  llm: {
    provider: "claude-code",
    // No API key needed - uses OAuth from Claude Code CLI
  }
}

Or restart with: multica chat --provider claude-code
```

### Important Notes

- OAuth credentials are read-only (we read from Claude Code/Codex, don't write)
- Session provider can be changed with `--provider` flag
- Default provider is set in `~/.super-multica/credentials.json5`
- OAuth tokens may expire and require re-login
