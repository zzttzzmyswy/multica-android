# CLI

```bash
multica                              # Interactive mode
multica run "prompt"                 # Single prompt
multica chat --profile my-agent      # Use profile
multica --session abc123             # Continue session
multica session list                 # List sessions
multica profile list                 # List profiles
multica skills list                  # List skills
multica help                         # Show help
```

Short alias: `mu`

## Sessions

Sessions persist to `~/.super-multica/sessions/<id>/` with JSONL message history and JSON metadata. Context windows are automatically managed with token-aware compaction.

## Profiles

Profiles define agent identity, personality, and memory in `~/.super-multica/agent-profiles/<id>/`.

```bash
multica profile new my-agent    # Create profile
multica profile list            # List all
multica profile edit my-agent   # Open in file manager
```

Profile files: `soul.md`, `user.md`, `workspace.md`, `memory.md`, `memory/*.md`
