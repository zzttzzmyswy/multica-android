# CLI Guide (`multica`)

## Entry

```bash
pnpm multica
```

Equivalent command names:

- `multica`
- `mu`

## Core Commands

```bash
multica                       # interactive chat (default)
multica run "<prompt>"        # one-shot run
multica chat                  # explicit interactive mode
multica session <command>     # session management
multica profile <command>     # profile management
multica skills <command>      # skill management
multica tools <command>       # tool policy inspection
multica credentials <command> # credentials management
multica cron <command>        # scheduled tasks
multica dev [service]         # start dev services
multica help
```

## Run Mode

```bash
multica run [options] <prompt>
echo "prompt" | multica run
```

Common options:

- `--profile <id>`
- `--provider <name>`
- `--model <name>`
- `--session <id>`
- `--cwd <dir>`
- `--run-log`
- `--tools-allow a,b,c`
- `--tools-deny a,b,c`
- `--context-window <tokens>`

## Chat Mode

```bash
multica chat [options]
multica [options]
```

In-chat commands:

- `/help`
- `/exit`
- `/clear`
- `/session`
- `/new`
- `/multiline`
- `/provider`
- `/model`

## Sessions

```bash
multica session list
multica session show <id>
multica session delete <id>
```

Session data root:

- `~/.super-multica/sessions/`
- or `SMC_DATA_DIR/sessions/`

## Profiles

```bash
multica profile list
multica profile new <id>
multica profile setup <id>
multica profile show <id>
multica profile edit <id>
multica profile delete <id>
```

## Skills

```bash
multica skills list
multica skills status [id]
multica skills install <id>
multica skills add <owner/repo[/skill]>
multica skills remove <name>
```

## Tools

```bash
multica tools list
multica tools list --allow group:fs,web_fetch
multica tools list --deny exec
multica tools groups
```

## Credentials

```bash
multica credentials init
multica credentials show
multica credentials edit
```

## Cron

```bash
multica cron status
multica cron list
multica cron add -n "name" --every "30m" --message "..."
multica cron run <id>
multica cron enable <id>
multica cron disable <id>
multica cron remove <id>
multica cron logs <id>
```
