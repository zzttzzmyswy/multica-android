# Skills and Tools

## Skills Loading Model

Skills are loaded from two sources with precedence:

1. Managed skills: `~/.super-multica/skills/`
2. Profile skills: `~/.super-multica/agent-profiles/<profile-id>/skills/`

Profile skills override managed skills when IDs conflict.

## Skill File Contract

A valid skill directory must include:

- `SKILL.md`

Optional runtime files:

- `.env`
- helper scripts/assets

## Current Repo Note

This repository intentionally keeps docs and bundled skill metadata minimal.
If a directory under `skills/` does not contain `SKILL.md`, it will not be loaded as a skill.

## Skills CLI

```bash
multica skills list
multica skills status [id]
multica skills install <id>
multica skills add <owner/repo[/skill]>
multica skills remove <name>
```

## Tool System

`@multica/core` composes:

- base coding tools (`read/write/edit/...`)
- extended tools (`exec`, `process`, `glob`, `web_fetch`, `web_search`, `data`, `cron`, `delegate`)
- conditional tools (`memory_search`, `send_file`)

Tool errors are wrapped into structured tool results instead of crashing runs.

## Tool Groups

Supported group aliases:

- `group:fs` -> `read, write, edit, glob`
- `group:runtime` -> `exec, process`
- `group:web` -> `web_search, web_fetch`
- `group:memory` -> `memory_search`
- `group:subagent` -> `delegate`
- `group:cron` -> `cron`
- `group:data` -> `data`
- `group:core` -> core local/web/data set

## Tool Policy Example

```json5
{
  tools: {
    allow: ["group:fs", "web_search", "web_fetch"],
    deny: ["exec"],
    byProvider: {
      "openai": {
        deny: ["data"],
      },
    },
  },
}
```

`deny` always has priority over `allow`.

## Inspect Effective Tools

```bash
multica tools list
multica tools list --allow group:fs,web_fetch
multica tools list --deny exec
multica tools groups
```
